/**
 * generate-bls-scores --direct: calls api.anthropic.com itself with the owner's
 * key and workspace, sending exactly the body the proxy route sends. Every
 * fetch here is mocked; no test makes a network call. The key in these tests
 * is a fake string.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ANTHROPIC_URL,
    ANTHROPIC_VERSION,
    CLAUDE_MODEL,
    MAX_TOKENS,
    requestBody,
    scoreWithClaude,
    type JobInput,
} from '../../scripts/lib/claudeScoring';
import { loadDirectAuth } from '../../scripts/lib/scoringAuth';
import { DEFAULT_MAX_CALLS, HARD_MAX_CALLS, parseMaxCalls, parseMaxJobs } from '../../scripts/generate_bls_scores';

const FAKE_KEY = 'sk-ant-FIXTURE-not-a-real-key';
const FAKE_WS = 'wrkspc_FIXTURE0123';
const PROXY = 'https://futureofjobs.vercel.app/api/claude/messages';

const job: JobInput = {
    title: 'FIXTURE Occupation',
    taskNames: ['Task one.', 'Task two.', 'Task three.', 'Task four.', 'Task five.'],
    employment: 123450,
    projectedGrowth: 4.2,
};

/** A valid Claude reply for `job`, so scoreWithClaude parses it. */
function reply() {
    const forecast = [2025, 2026, 2027, 2028, 2029, 2030].map((year) => ({ year, growthImpact: 0, aiAdoptionRate: 10, explanation: 'FIXTURE' }));
    const text = JSON.stringify({
        tasks: job.taskNames.map((taskName) => ({ taskName, aiCapabilityScore: 0.4, humanCriticalityScore: 0.6, reasoning: 'FIXTURE' })),
        yearlyForecast: forecast,
    });
    return new Response(JSON.stringify({ model: CLAUDE_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
}

describe('direct and proxy requests', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('direct goes to api.anthropic.com with the key, workspace and version headers, and the same body as the proxy', async () => {
        const calls: { url: string; init: RequestInit }[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return reply();
        }));

        await scoreWithClaude(job, { mode: 'direct', key: FAKE_KEY, workspace: FAKE_WS });
        await scoreWithClaude(job, { mode: 'proxy', url: PROXY });
        expect(calls).toHaveLength(2);
        const [direct, proxy] = calls;

        expect(direct.url).toBe(ANTHROPIC_URL);
        expect(ANTHROPIC_URL).toBe('https://api.anthropic.com/v1/messages');
        expect(direct.init.method).toBe('POST');
        expect(direct.init.headers).toEqual({
            'x-api-key': FAKE_KEY,
            'anthropic-workspace-id': FAKE_WS,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
        });

        // The proxy route is unchanged: its URL, only content-type, no key.
        expect(proxy.url).toBe(PROXY);
        expect(proxy.init.headers).toEqual({ 'content-type': 'application/json' });

        // Byte-identical bodies, and the published settings.
        expect(typeof direct.init.body).toBe('string');
        expect(direct.init.body).toBe(proxy.init.body);
        expect(direct.init.body).toBe(requestBody(job));
        const body = JSON.parse(direct.init.body as string);
        expect(Object.keys(body)).toEqual(['model', 'max_tokens', 'thinking', 'messages']);
        expect(body.model).toBe('claude-sonnet-5');
        expect(body.max_tokens).toBe(MAX_TOKENS);
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body).not.toHaveProperty('temperature');
        expect(direct.init.body as string).not.toContain(FAKE_KEY);
    });
});

describe('loadDirectAuth', () => {
    const files = (map: Record<string, string>) => (file: string) => map[file] ?? null;

    it('prefers the env vars, else reads ~/.foj_scoring_key and ~/.foj_scoring_workspace', () => {
        const fromEnv = loadDirectAuth({ env: { FOJ_SCORING_API_KEY: FAKE_KEY, FOJ_SCORING_WORKSPACE: FAKE_WS }, home: '/h', readFile: files({}) });
        expect([fromEnv.key, fromEnv.workspace, fromEnv.keySource]).toEqual([FAKE_KEY, FAKE_WS, 'env FOJ_SCORING_API_KEY']);
        const fromFiles = loadDirectAuth({ env: {}, home: '/h', readFile: files({ '/h/.foj_scoring_key': `${FAKE_KEY}\n`, '/h/.foj_scoring_workspace': `${FAKE_WS}\n` }) });
        expect([fromFiles.key, fromFiles.workspace, fromFiles.keySource, fromFiles.workspaceSource]).toEqual([FAKE_KEY, FAKE_WS, '~/.foj_scoring_key', '~/.foj_scoring_workspace']);
    });

    it('never reads ANTHROPIC_API_KEY', () => {
        expect(() => loadDirectAuth({ env: { ANTHROPIC_API_KEY: FAKE_KEY, FOJ_SCORING_WORKSPACE: FAKE_WS }, home: '/h', readFile: files({}) })).toThrow(/FOJ_SCORING_API_KEY/);
    });

    it('requires the workspace, and never puts the key in an error', () => {
        let message = '';
        try {
            loadDirectAuth({ env: { FOJ_SCORING_API_KEY: FAKE_KEY }, home: '/h', readFile: files({}) });
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toMatch(/workspace/);
        expect(message).not.toContain(FAKE_KEY);
        expect(() => loadDirectAuth({ env: { FOJ_SCORING_API_KEY: FAKE_KEY, FOJ_SCORING_WORKSPACE: 'not-a-workspace' }, home: '/h', readFile: files({}) })).toThrow(/wrkspc_/);
        expect(() => loadDirectAuth({ env: { FOJ_SCORING_API_KEY: 'two words', FOJ_SCORING_WORKSPACE: FAKE_WS }, home: '/h', readFile: files({}) })).toThrow(/whitespace/);
    });
});

describe('call limits', () => {
    it('--max-calls defaults to 30 and refuses anything above 450', () => {
        expect(DEFAULT_MAX_CALLS).toBe(30);
        expect(HARD_MAX_CALLS).toBe(450);
        expect(parseMaxCalls([])).toBe(30);
        expect(parseMaxCalls(['--max-calls', '10'])).toBe(10);
        expect(parseMaxCalls(['--max-calls', '450'])).toBe(450);
        expect(() => parseMaxCalls(['--max-calls', '451'])).toThrow(/450/);
        expect(() => parseMaxCalls(['--max-calls', '0'])).toThrow();
        expect(() => parseMaxCalls(['--max-calls', '1e3'])).toThrow();
        expect(() => parseMaxCalls(['--max-calls'])).toThrow();
    });

    it('--max-jobs is optional and must be a whole number', () => {
        expect(parseMaxJobs([])).toBe(Infinity);
        expect(parseMaxJobs(['--max-jobs', '5'])).toBe(5);
        expect(() => parseMaxJobs(['--max-jobs', 'x'])).toThrow();
    });
});
