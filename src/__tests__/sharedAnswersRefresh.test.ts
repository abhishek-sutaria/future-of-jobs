/**
 * Saved shared answers never go stale (api/_lib/sharedAnswers.ts, gateway):
 *   - reused only for the same role, feature, prompt version, model,
 *     max_tokens, exact request and DATA_VERSION;
 *   - older than the max age (90 days, FOJ_SHARED_MAX_AGE_DAYS, or the
 *     feature's own maxAgeDays) counts as missing, and the new answer
 *     REPLACES the row with a new created_at;
 *   - two visitors at once both get an answer;
 *   - DATA_VERSION is built in one place from the vintages the app shows;
 *   - the one-paste setup SQL holds everything, safe to run twice;
 *   - no service key, or its name, in src/ or dist/.
 * Claude and Supabase are the in-memory mock: no real call.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createClaudeHandler, type ApiRequest } from '../../api/_lib/gateway';
import { requestHash, sharedMaxAgeDays, SHARED_ANSWER_MAX_AGE_DAYS } from '../../api/_lib/sharedAnswers';
import type { ServerEnv } from '../../api/_lib/supabaseRest';
import { createMockBackend, MOCK_SUPABASE_URL, type MockBackend } from '../../scripts/lib/mockAiBackend';
import { AI_FEATURES, AI_MODEL } from '../shared/aiFeatures';
import { DATA_SOURCES } from '../config/constants';
import { DATA_VERSION, DATA_VINTAGES, SCORES_VINTAGE } from '../shared/dataVersion';
import scoresBls from '../data/ai_scores_bls.json';

const ROOT = path.resolve(__dirname, '../..');
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-22T12:00:00Z');

let mock: MockBackend;
let clock: number;
let env: ServerEnv;

function fakeRes() {
    const c = { status: 200, body: '' };
    const res = {
        status(code: number) { c.status = code; return res; },
        setHeader() {},
        json(b: unknown) { c.body = JSON.stringify(b); },
        send(b: string) { c.body = b; },
        write() {},
        end() {},
    };
    return { res, c };
}

type Handler = ReturnType<typeof createClaudeHandler>;
const handler = (opts: { dataVersion?: string; fetch?: MockBackend['fetch'] } = {}) =>
    createClaudeHandler({ fetch: opts.fetch ?? mock.fetch, env: () => env, now: () => clock, ...(opts.dataVersion ? { dataVersion: opts.dataVersion } : {}) });

async function call(h: Handler, body: unknown, ip = '203.0.113.9') {
    const { res, c } = fakeRes();
    const req: ApiRequest = { method: 'POST', headers: { 'x-forwarded-for': ip }, body };
    await h(req, res);
    return { status: c.status, json: c.body ? JSON.parse(c.body) : null };
}

const SCENARIO = { feature: 'scenario', input: { roleKey: 'soc:13-2011', title: 'Accountants and Auditors', risk: 0.5, tasks: [{ name: 'Prepare tax returns', aiCapabilityScore: 0.7 }] } };
const claudeCalls = () => mock.calls.length;
const rows = () => [...mock.answers.values()].map((a) => a.row);

beforeEach(() => {
    clock = T0;
    mock = createMockBackend({ now: () => clock });
    env = { ANTHROPIC_API_KEY: 'sk-test', SUPABASE_URL: MOCK_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' };
});

describe('a saved answer is reused only for the same request and data', () => {
    it('a DATA_VERSION change is a miss (a data refresh replaces every saved answer)', async () => {
        const before = handler({ dataVersion: 'oews=2025' });
        expect((await call(before, SCENARIO)).json.shared).toMatchObject({ hit: false, saved: true });
        expect((await call(before, SCENARIO)).json.shared).toMatchObject({ hit: true });
        expect(claudeCalls()).toBe(1);
        const after = handler({ dataVersion: 'oews=2026' });
        expect((await call(after, SCENARIO)).json.shared).toMatchObject({ hit: false, saved: true });
        expect(claudeCalls()).toBe(2);
        expect(rows().map((r) => r.data_version).sort()).toEqual(['oews=2025', 'oews=2026']);
    });

    it('the gateway uses DATA_VERSION by default and stores it on the row', async () => {
        await call(handler(), SCENARIO);
        expect(rows()[0].data_version).toBe(DATA_VERSION);
    });

    it('a promptVersion change is a miss', async () => {
        const spec = AI_FEATURES.scenario as { promptVersion: string };
        const was = spec.promptVersion;
        try {
            await call(handler(), SCENARIO);
            spec.promptVersion = `${was}-next`;
            expect((await call(handler(), SCENARIO)).json.shared).toMatchObject({ hit: false, saved: true });
            expect(claudeCalls()).toBe(2);
        } finally {
            spec.promptVersion = was;
        }
        expect((await call(handler(), SCENARIO)).json.shared).toMatchObject({ hit: true });
    });

    it('a model change is a miss', async () => {
        await call(handler(), SCENARIO);
        vi.resetModules();
        vi.doMock('../shared/aiFeatures', async (orig) => ({ ...(await orig<object>()), AI_MODEL: 'claude-next-model' }));
        try {
            const { createClaudeHandler: next } = await import('../../api/_lib/gateway');
            const h = next({ fetch: mock.fetch, env: () => env, now: () => clock });
            const r = await call(h, SCENARIO);
            expect(r.json.shared).toMatchObject({ hit: false, saved: true });
            expect(claudeCalls()).toBe(2);
            expect(rows().map((x) => x.model).sort()).toEqual([AI_MODEL, 'claude-next-model'].sort());
        } finally {
            vi.doUnmock('../shared/aiFeatures');
            vi.resetModules();
        }
    });

    it('the hash covers data version, model, max_tokens, thinking and the prompt', () => {
        const body = { model: 'claude-sonnet-5', max_tokens: 4096, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'x' }] };
        const base = requestHash(body, 'dv1');
        expect(base).toMatch(/^[0-9a-f]{64}$/);
        expect(requestHash(body, 'dv1')).toBe(base);
        expect(requestHash(body, 'dv2')).not.toBe(base);
        expect(requestHash({ ...body, model: 'claude-other' }, 'dv1')).not.toBe(base);
        expect(requestHash({ ...body, max_tokens: 2048 }, 'dv1')).not.toBe(base);
        expect(requestHash({ ...body, thinking: undefined }, 'dv1')).not.toBe(base);
        expect(requestHash({ ...body, messages: [{ role: 'user', content: 'y' }] }, 'dv1')).not.toBe(base);
    });
});

describe('max age: an old answer is made again and replaces the row', () => {
    it('an answer 89 days old is a hit', async () => {
        const first = await call(handler(), SCENARIO);
        clock = T0 + 89 * DAY;
        const again = await call(handler(), SCENARIO);
        expect(again.json.shared).toEqual({ hit: true, saved: true, savedAt: first.json.shared.savedAt });
        expect(claudeCalls()).toBe(1);
    });

    it('an answer 91 days old is replaced: a new Claude answer, the same row, a new created_at', async () => {
        const first = await call(handler(), SCENARIO);
        expect(first.json.shared.savedAt).toBe(new Date(T0).toISOString());
        clock = T0 + 91 * DAY;
        const fresh = await call(handler(), SCENARIO);
        expect(fresh.status).toBe(200);
        expect(fresh.json.shared).toEqual({ hit: false, saved: true, savedAt: new Date(T0 + 91 * DAY).toISOString() });
        expect(fresh.json.result.story).toContain('[mock #2]');
        expect(claudeCalls()).toBe(2);
        expect(mock.answers.size).toBe(1);
        expect(rows()[0].created_at).toBe(new Date(T0 + 91 * DAY).toISOString());
        expect((rows()[0].payload as { story: string }).story).toContain('[mock #2]');
        // ...and the replacement is the saved answer from then on.
        const later = await call(handler(), SCENARIO);
        expect(later.json.shared).toMatchObject({ hit: true, savedAt: new Date(T0 + 91 * DAY).toISOString() });
        expect(claudeCalls()).toBe(2);
    });

    it('the mock expiry knob ages saved answers the same way', async () => {
        await call(handler(), SCENARIO);
        mock.age(91);
        expect((await call(handler(), SCENARIO)).json.shared).toMatchObject({ hit: false, saved: true, savedAt: new Date(T0).toISOString() });
        expect(claudeCalls()).toBe(2);
    });

    it('FOJ_SHARED_MAX_AGE_DAYS sets the max age; a feature’s own maxAgeDays wins', async () => {
        expect(SHARED_ANSWER_MAX_AGE_DAYS).toBe(90);
        expect(sharedMaxAgeDays({}, {})).toBe(90);
        expect(sharedMaxAgeDays({}, { FOJ_SHARED_MAX_AGE_DAYS: '30' })).toBe(30);
        expect(sharedMaxAgeDays({}, { FOJ_SHARED_MAX_AGE_DAYS: 'soon' })).toBe(90);
        expect(sharedMaxAgeDays({}, { FOJ_SHARED_MAX_AGE_DAYS: '0' })).toBe(90);
        expect(sharedMaxAgeDays({ maxAgeDays: 7 }, { FOJ_SHARED_MAX_AGE_DAYS: '30' })).toBe(7);

        env = { ...env, FOJ_SHARED_MAX_AGE_DAYS: '30' };
        await call(handler(), SCENARIO);
        clock = T0 + 31 * DAY;
        expect((await call(handler(), SCENARIO)).json.shared).toMatchObject({ hit: false, saved: true });

        const spec = AI_FEATURES.scenario as { maxAgeDays?: number };
        try {
            spec.maxAgeDays = 365;
            clock = T0 + 300 * DAY;
            expect((await call(handler(), SCENARIO)).json.shared).toMatchObject({ hit: true });
        } finally {
            delete spec.maxAgeDays;
        }
    });

    it('every shared feature keeps the 90-day default today (course links included)', () => {
        for (const [name, f] of Object.entries(AI_FEATURES)) {
            if (f.shared) expect(sharedMaxAgeDays(f as { maxAgeDays?: number }, {}), name).toBe(90);
        }
    });

    it('the status check says the max age and data version', async () => {
        const { res, c } = fakeRes();
        await handler()({ method: 'GET', headers: {} }, res);
        expect(JSON.parse(c.body)).toMatchObject({ sharedAnswers: true, sharedMaxAgeDays: 90, dataVersion: DATA_VERSION });
    });
});

describe('two visitors at once', () => {
    it('two simultaneous misses both get an answer; the first saved is the one kept', async () => {
        const h = handler();
        const [a, b] = await Promise.all([call(h, SCENARIO, '198.51.100.1'), call(h, SCENARIO, '198.51.100.2')]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(a.json.shared.saved && b.json.shared.saved).toBe(true);
        expect(b.json.result).toEqual(a.json.result);
        expect(mock.answers.size).toBe(1);
    });

    it('two simultaneous misses on an expired answer both succeed and leave one fresh row', async () => {
        await call(handler(), SCENARIO);
        clock = T0 + 91 * DAY;
        const h = handler();
        const [a, b] = await Promise.all([call(h, SCENARIO, '198.51.100.1'), call(h, SCENARIO, '198.51.100.2')]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(b.json.result).toEqual(a.json.result);
        expect(mock.answers.size).toBe(1);
        expect(rows()[0].created_at).toBe(new Date(T0 + 91 * DAY).toISOString());
    });

    it('a failed save still answers the visitor (saved: false), never an error', async () => {
        const broken: MockBackend['fetch'] = (input, init) =>
            input.includes('/rpc/ai_shared_answer_put') ? Promise.resolve(new Response('{}', { status: 500 })) : mock.fetch(input, init);
        const r = await call(handler({ fetch: broken }), SCENARIO);
        expect(r.status).toBe(200);
        expect(r.json.shared).toEqual({ hit: false, saved: false, savedAt: null });
    });
});

describe('DATA_VERSION: one place, built from the data the app shows', () => {
    it('is built from DATA_SOURCES and the scores file header', () => {
        expect(DATA_VINTAGES).toMatchObject({
            oews: DATA_SOURCES.BLS_OES,
            oewsWages: DATA_SOURCES.BLS_OES_WAGES,
            ep: DATA_SOURCES.BLS_EP,
            ooh: DATA_SOURCES.BLS_OOH,
            onet: DATA_SOURCES.ONET,
        });
        expect(DATA_VERSION).toBe(Object.entries(DATA_VINTAGES).map(([k, v]) => `${k}=${v}`).join(';'));
        expect(DATA_VERSION).toBe('oews=BLS-OES-2025;oewsWages=BLS-OES-Wages-2025;ep=BLS-EP-2025-35;ooh=BLS-OOH-2024-34;onet=O*NET-30.1;scores=scores-v5@2026-11-09T05:34:00.988Z');
    });

    it('its scores part matches src/data/ai_scores_bls.json (a re-score must update it)', () => {
        const meta = scoresBls as unknown as { version: number; generatedAt: string };
        expect(SCORES_VINTAGE).toEqual({ version: meta.version, generatedAt: meta.generatedAt });
    });

    it('is defined only in src/shared/dataVersion.ts', () => {
        const defs: string[] = [];
        const walk = (dir: string) => {
            for (const name of fs.readdirSync(dir)) {
                const p = path.join(dir, name);
                if (fs.statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'data') walk(p); continue; }
                if (/\.(ts|tsx|mjs)$/.test(name) && /\bDATA_VERSION\s*(:[^=]+)?=/.test(fs.readFileSync(p, 'utf-8'))) defs.push(path.relative(ROOT, p));
            }
        };
        for (const d of ['src', 'api', 'scripts']) walk(path.join(ROOT, d));
        expect(defs).toEqual(['src/shared/dataVersion.ts']);
    });
});

describe('the one-paste setup SQL', () => {
    const setup = fs.readFileSync(path.join(ROOT, 'supabase/setup_shared_answers.sql'), 'utf-8');
    const migration = (f: string) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf-8');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const statements = (sql: string) => sql.replace(/^\s*--.*$/gm, '').split(/;\s*$/m).map(norm).filter(Boolean);

    it('holds every statement of migrations 0003, 0004 and 0005', () => {
        const all = norm(setup.replace(/^\s*--.*$/gm, ''));
        for (const f of ['0003_shared_ai_answers.sql', '0004_rate_give.sql', '0005_shared_answer_refresh.sql']) {
            for (const st of statements(migration(f))) {
                if (st.startsWith('create table if not exists public.ai_shared_answers')) continue; // checked below
                if (/^grant select, insert, delete on public\.ai_shared_answers/.test(st)) continue; // widened to update below
                expect(all, `${f}: ${st.slice(0, 80)}`).toContain(st);
            }
        }
        expect(setup).toMatch(/create table if not exists public\.ai_shared_answers \([\s\S]*data_version\s+text,[\s\S]*primary key \(role_key, feature, prompt_version, input_hash\)/);
        expect(setup).toMatch(/grant select, insert, update, delete on public\.ai_shared_answers to service_role/);
        expect(setup).toMatch(/create or replace function public\.ai_shared_answer_put\(/);
    });

    it('is safe to run twice and deletes nothing', () => {
        const code = setup.replace(/^\s*--.*$/gm, '');
        expect(code).not.toMatch(/\bdrop\b|\btruncate\b|create policy/i);
        for (const m of code.matchAll(/create\s+(?:unique\s+)?(table|index)\s+(\S+)/gi)) expect(m[2], m[0]).toBe('if');
        for (const m of code.matchAll(/create\s+(?!or replace)(function)/gi)) throw new Error(`not "or replace": ${m[0]}`);
        expect(code).toMatch(/add column if not exists data_version/);
    });

    it('is server only: RLS on, nothing for anon or authenticated, every function revoked from them', () => {
        expect(setup).toMatch(/alter table public\.ai_shared_answers enable row level security/);
        expect(setup).toMatch(/alter table public\.ai_rate_limits\s+enable row level security/);
        expect(setup).toMatch(/revoke all on public\.ai_shared_answers from anon, authenticated/);
        expect(setup).toMatch(/revoke all on public\.ai_rate_limits\s+from anon, authenticated/);
        for (const fn of ['ai_rate_take', 'ai_rate_give', 'ai_shared_answer_put']) {
            expect(setup).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
            expect(setup).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
        }
    });

    it('replaces only a row saved before p_stale_before, never "on conflict do nothing"', () => {
        const fn = setup.slice(setup.indexOf('create or replace function public.ai_shared_answer_put'));
        expect(norm(fn)).toMatch(/on conflict \(role_key, feature, prompt_version, input_hash\) do update set .*created_at = now\(\) where a\.created_at < p_stale_before;/);
        expect(norm(fn)).not.toMatch(/do nothing/);
    });
});

describe('no service key in the browser bundle or the repo', () => {
    // The names, or a new-style secret key VALUE: supabase-js itself carries the
    // bare prefix "sb_secret_" (it checks key formats), never a key.
    const KEY_WORDS = /service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_[\w-]{16,}/i;
    /** A legacy JWT in the text whose payload names the service_role. */
    const serviceRoleJwt = (text: string) => [...text.matchAll(/eyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]{10,}/g)]
        .some((m) => Buffer.from(m[1], 'base64url').toString('utf8').includes('service_role'));
    const scan = (dir: string, skip: (rel: string) => boolean, exts: RegExp) => {
        const hits: string[] = [];
        const walk = (d: string) => {
            for (const name of fs.readdirSync(d)) {
                const p = path.join(d, name);
                const rel = path.relative(ROOT, p);
                if (skip(rel)) continue;
                if (fs.statSync(p).isDirectory()) { walk(p); continue; }
                if (!exts.test(name)) continue;
                const text = fs.readFileSync(p, 'utf-8');
                if (KEY_WORDS.test(text) || serviceRoleJwt(text)) hits.push(rel);
            }
        };
        if (fs.existsSync(dir)) walk(dir);
        return hits;
    };

    it('nothing under src/ names it (tests aside; the server files are under api/)', () => {
        expect(scan(path.join(ROOT, 'src'), (rel) => rel.startsWith('src/__tests__'), /\.(ts|tsx|js|jsx|json|css|html)$/)).toEqual([]);
    });

    it.skipIf(!fs.existsSync(path.join(ROOT, 'dist')))('nothing under dist/ names it (audit T69 checks it after every CI build)', () => {
        expect(scan(path.join(ROOT, 'dist'), () => false, /\.(js|html|css|json|map|txt|webmanifest)$/)).toEqual([]);
    });

    it('the check itself catches a key: names, a secret value, a service_role JWT; not the bare prefix', () => {
        const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2lnbmF0dXJlc2lnbmF0dXJl`;
        expect(KEY_WORDS.test('env.SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
        expect(KEY_WORDS.test('"service_role"')).toBe(true);
        expect(KEY_WORDS.test('sb_secret_AbCdEf0123456789xyz')).toBe(true);
        expect(KEY_WORDS.test('n.startsWith("sb_secret_")')).toBe(false);
        expect(serviceRoleJwt(`k="${jwt({ iss: 'supabase', role: 'service_role', ref: 'abcdefghij' })}"`)).toBe(true);
        expect(serviceRoleJwt(`k="${jwt({ iss: 'supabase', role: 'anon', ref: 'abcdefghij' })}"`)).toBe(false);
    });

    it('no real key is committed: only placeholders and test fakes', () => {
        const jwt = /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
        const secret = /sb_secret_[A-Za-z0-9_-]{20,}/;
        const files = ['README.md', 'AGENTS.md', 'docs/shared-answers-setup.md', 'supabase/setup_shared_answers.sql', '.env.example']
            .map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
        for (const f of files) {
            const text = fs.readFileSync(f, 'utf-8');
            expect(jwt.test(text), f).toBe(false);
            expect(secret.test(text), f).toBe(false);
        }
    });
});
