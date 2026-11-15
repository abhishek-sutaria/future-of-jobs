/**
 * Every new answer: one request to Claude with no tools (no web search), a
 * 100 s stop inside the function's 120 s limit that gives the visitor's slot
 * back, and one log line with tokens and time. Claude is a fake here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createClaudeHandler, TURN_TIMEOUT_MS, type ApiRequest } from '../../api/_lib/gateway';
import { createMockBackend, MOCK_SUPABASE_URL, type MockBackend } from '../../scripts/lib/mockAiBackend';
import { AI_FEATURES } from '../shared/aiFeatures';

const ROOT = path.resolve(__dirname, '../..');
const UPSKILL = { roleKey: 'soc:13-2011', title: 'Accountants and Auditors', taskName: 'Prepare tax returns', mode: 'defend', riskPercent: 70 };
const ROADMAP = { roleKey: 'soc:13-1161', title: 'Market Research Analysts', riskTask: 'r', targetTask: 't' };
const env = () => ({ ANTHROPIC_API_KEY: 'sk-test-never-logged', SUPABASE_URL: MOCK_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'sb' });

let mock: MockBackend;
let sent: Record<string, unknown>[];

beforeEach(() => {
    mock = createMockBackend();
    sent = [];
});

async function call(h: ReturnType<typeof createClaudeHandler>, body: unknown) {
    let status = 200;
    let text = '';
    const res = {
        status(c: number) { status = c; return res; },
        setHeader() {},
        json(b: unknown) { text = JSON.stringify(b); },
        send(b: string) { text = b; },
        write() {},
        end() {},
    };
    const req: ApiRequest = { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body };
    await h(req, res);
    return { status, json: JSON.parse(text) };
}

const recording = () => createClaudeHandler({
    fetch: async (url, init) => {
        if (url.startsWith('https://api.anthropic.com')) sent.push(JSON.parse(String(init?.body)));
        return mock.fetch(url, init);
    },
    linkFetch: async () => new Response('<title>Not Found</title>', { status: 404, headers: { 'content-type': 'text/html' } }),
    env,
});

describe('no web search', () => {
    it('course features send one plain request: no tools, the #99 limits', async () => {
        const h = recording();
        await call(h, { feature: 'upskill', input: UPSKILL });
        await call(h, { feature: 'roadmap', input: ROADMAP });
        expect(sent).toHaveLength(2);
        for (const body of sent) {
            expect(body.tools).toBeUndefined();
            expect(body.max_tokens).toBe(4096);
            expect(JSON.stringify(body)).not.toMatch(/web_search/);
        }
        for (const f of Object.values(AI_FEATURES)) expect('webSearch' in f).toBe(false);
    });

    it('nothing the app or the server runs sends the web_search tool', () => {
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
                if (/\.(ts|tsx|mjs|js)$/.test(e.name) && /web_search/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
            }
        };
        for (const d of ['src', 'api', 'scripts']) walk(path.join(ROOT, d));
        expect(hits).toEqual([]);
    });
});

describe('the time limit', () => {
    it('an answer that takes too long is stopped with a clear message and the visitor’s slot back', async () => {
        const h = createClaudeHandler({
            fetch: (url, init) => url.startsWith('https://api.anthropic.com')
                ? new Promise((_ok, fail) => init?.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError'))))
                : mock.fetch(url, init),
            env,
            turnTimeoutMs: 30,
        });
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(504);
        expect(r.json.error.message).toMatch(/took too long/);
        expect(mock.answers.size).toBe(0);
        const visitor = [...mock.rateCounts].filter(([k]) => k.startsWith('v:')).map(([, v]) => v.count);
        expect(visitor.length).toBeGreaterThan(0);
        expect(visitor.every((c) => c === 0)).toBe(true);
    });

    it('the function may run 120 s, and an answer is stopped well before that', () => {
        const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
        expect(cfg.functions['api/claude.ts'].maxDuration).toBe(120);
        expect(TURN_TIMEOUT_MS).toBe(100_000);
    });
});

describe('logging', () => {
    it('one line per new answer: tokens, time, courses and direct links; no search field, no key; also sent as usage', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const r = await call(recording(), { feature: 'upskill', input: UPSKILL });
        const line = info.mock.calls.map((c) => String(c[1] ?? '')).find((l) => l.includes('"feature":"upskill"'))!;
        const logged = JSON.parse(line);
        expect(logged).toEqual({ feature: 'upskill', inputTokens: 900, outputTokens: 400, ms: expect.any(Number), stopReason: 'end_turn', courses: 3, direct: 0 });
        expect(line).not.toMatch(/search|sk-test/);
        expect(r.json.usage).toEqual({ inputTokens: 900, outputTokens: 400, ms: expect.any(Number), stopReason: 'end_turn' });
        info.mockRestore();
    });
});
