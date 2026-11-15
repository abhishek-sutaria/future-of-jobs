/**
 * Course features search the providers' sites while they answer (Anthropic's
 * web_search server tool). The gateway must send the tool, read the JSON from
 * the final text, continue a pause_turn, survive failed searches and a refused
 * tool, and log searches, tokens and time. Claude is a scripted fake here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClaudeHandler, finalText, MAX_CONTINUATIONS, type ApiRequest, type ClaudeBlock } from '../../api/_lib/gateway';
import { createMockBackend, MOCK_SUPABASE_URL, type MockBackend } from '../../scripts/lib/mockAiBackend';
import { courseSearchDomains, MAX_SEARCH_DOMAINS } from '../shared/courseProviders';
import { AI_FEATURES } from '../shared/aiFeatures';

const UPSKILL = { roleKey: 'soc:13-2011', title: 'Accountants and Auditors', taskName: 'Prepare tax returns', mode: 'defend', riskPercent: 70 };
const GOOD = 'https://www.coursera.org/learn/ai-for-everyone';
const ANSWER = { courses: [{ title: 'AI For Everyone', provider: 'Coursera', url: GOOD, duration: '6 hours', level: 'Beginner' }], whyTheseCourses: 'Why.' };

let mock: MockBackend;
let sent: Record<string, unknown>[];

const reply = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A Claude that answers each request with the next scripted reply. */
function handlerWith(replies: (() => Response)[]) {
    let n = 0;
    return createClaudeHandler({
        fetch: async (url, init) => {
            if (!url.startsWith('https://api.anthropic.com')) return mock.fetch(url, init);
            sent.push(JSON.parse(String(init?.body)));
            const r = replies[Math.min(n++, replies.length - 1)];
            return r();
        },
        linkFetch: async () => new Response('<title>AI For Everyone | Coursera</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
        env: () => ({ ANTHROPIC_API_KEY: 'sk-test', SUPABASE_URL: MOCK_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'sb' }),
    });
}

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

/** A search answer: a note with braces, a search, its results, then the JSON split by a citation. */
function searchAnswer(answer: unknown, extra: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    const text = JSON.stringify(answer);
    const cut = text.indexOf('Coursera') + 3; // mid-string, as citations do
    return {
        content: [
            { type: 'text', text: 'Let me search {carefully}.' },
            { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'ai for everyone coursera' } },
            { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: GOOD, title: 'AI For Everyone', encrypted_content: 'x' }] },
            { type: 'text', text: text.slice(0, cut) },
            { type: 'text', text: text.slice(cut), citations: [{ type: 'web_search_result_location', url: GOOD }] },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12000, output_tokens: 900, server_tool_use: { web_search_requests: 2 } },
        ...extra,
    };
}

beforeEach(() => {
    mock = createMockBackend();
    sent = [];
});

describe('the search tool on the request', () => {
    it('upskill and roadmap carry web_search_20260209, limited to the course providers; other features none', async () => {
        const h = handlerWith([() => reply(searchAnswer(ANSWER))]);
        await call(h, { feature: 'upskill', input: UPSKILL });
        const tools = sent[0].tools as Record<string, unknown>[];
        expect(tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 4, allowed_domains: courseSearchDomains() }]);
        // No separate code_execution tool: this version filters results itself.
        expect(tools.some((t) => String(t.type).startsWith('code_execution'))).toBe(false);
        expect(sent[0].model).toBe('claude-sonnet-5');
        expect(AI_FEATURES.roadmap.webSearch).toEqual({ maxUses: 5 });
        expect('webSearch' in AI_FEATURES.analyze).toBe(false);
    });

    it('the domain list: at most 64 bare ASCII hostnames (paths only for LinkedIn and Kaggle), no duplicates', () => {
        expect(courseSearchDomains().length).toBeLessThanOrEqual(MAX_SEARCH_DOMAINS);
        expect(new Set(courseSearchDomains()).size).toBe(courseSearchDomains().length);
        for (const d of courseSearchDomains()) {
            expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]+(\/[a-z]+)?$/);
            expect(d).not.toMatch(/^https?:|\*/);
        }
        expect(courseSearchDomains()).toContain('coursera.org');
        expect(courseSearchDomains()).toContain('linkedin.com/learning');
    });
});

describe('reading the answer', () => {
    it('reads the JSON from the final text run, joined across citation blocks; the note before the search is ignored', async () => {
        const h = handlerWith([() => reply(searchAnswer(ANSWER))]);
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(200);
        expect(r.json.result.courses[0].link).toEqual({ href: GOOD, kind: 'course', label: 'Open course' });
        expect(r.json.usage).toMatchObject({ requests: 1, searches: 2, inputTokens: 12000, outputTokens: 900, stopReason: 'end_turn', searchErrors: [] });
    });

    it('finalText: only the trailing text blocks, joined with nothing between', () => {
        const blocks: ClaudeBlock[] = [
            { type: 'text', text: 'note' },
            { type: 'server_tool_use' },
            { type: 'text', text: '{"a":"b' },
            { type: 'text', text: 'c"}' },
        ];
        expect(finalText(blocks)).toBe('{"a":"bc"}');
        expect(finalText([{ type: 'text', text: '{"x":1}' }])).toBe('{"x":1}');
        expect(finalText([{ type: 'text', text: 'x' }, { type: 'server_tool_use' }])).toBe('');
    });

    it('a failed search (200 with an error object) still gives an answer, and the error is logged', async () => {
        const failed = searchAnswer(ANSWER);
        (failed.content as ClaudeBlock[])[2] = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } };
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const h = handlerWith([() => reply(failed)]);
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(200);
        expect(r.json.usage.searchErrors).toEqual(['max_uses_exceeded']);
        const line = info.mock.calls.map((c) => String(c[1] ?? '')).find((l) => l.includes('"feature":"upskill"'))!;
        expect(JSON.parse(line)).toMatchObject({ feature: 'upskill', searches: 2, inputTokens: 12000, outputTokens: 900, searchErrors: ['max_uses_exceeded'], courses: 1, direct: 1, urlsGiven: 1, urlsFromSearch: 0 });
        expect(line).not.toContain('sk-test');
        info.mockRestore();
    });

    it('logs whether the course URLs came from the search results', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        await call(handlerWith([() => reply(searchAnswer(ANSWER))]), { feature: 'upskill', input: UPSKILL });
        const line = info.mock.calls.map((c) => String(c[1] ?? '')).find((l) => l.includes('"feature":"upskill"'))!;
        expect(JSON.parse(line)).toMatchObject({ urlsGiven: 1, urlsFromSearch: 1, ms: expect.any(Number) });
        info.mockRestore();
    });
});

describe('pause_turn', () => {
    const paused = {
        content: [
            { type: 'server_tool_use', id: 'srvtoolu_p', name: 'web_search', input: { query: 'q' } },
        ],
        stop_reason: 'pause_turn',
        container: { id: 'container_123' },
        usage: { input_tokens: 3000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
    };

    it('continues with what Claude has so far, the same tools and its container, and sums the usage', async () => {
        const h = handlerWith([() => reply(paused), () => reply(searchAnswer(ANSWER))]);
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(200);
        expect(sent).toHaveLength(2);
        const second = sent[1] as { messages: { role: string; content: unknown }[]; tools: unknown; container?: string };
        expect(second.messages).toHaveLength(2);
        expect(second.messages[1]).toEqual({ role: 'assistant', content: paused.content });
        expect(second.tools).toEqual(sent[0].tools);
        expect(second.container).toBe('container_123');
        expect(r.json.usage).toMatchObject({ requests: 2, continuations: 1, searches: 3, inputTokens: 15000, outputTokens: 1000 });
    });

    it(`stops after ${MAX_CONTINUATIONS} continuations with a clear error, and gives the visitor's slot back`, async () => {
        const h = handlerWith([() => reply(paused)]);
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(sent).toHaveLength(1 + MAX_CONTINUATIONS);
        expect(r.status).toBe(502);
        expect(r.json.error.type).toBe('foj_invalid_answer');
        expect(r.json.error.message).toMatch(/still searching/);
        expect(mock.answers.size).toBe(0);
    });
});

describe('when search is not available', () => {
    it('a request refused because of the search tool is asked again without it; courses then fall back to search links', async () => {
        const noUrl = { courses: [{ title: 'AI For Everyone', provider: 'Coursera', url: '', duration: '6 hours', level: 'Beginner' }], whyTheseCourses: 'Why.' };
        const h = handlerWith([
            () => reply({ type: 'error', error: { type: 'invalid_request_error', message: 'Web search is not enabled for this organization.' } }, 400),
            () => reply({ content: [{ type: 'text', text: JSON.stringify(noUrl) }], stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 300 } }),
        ]);
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(200);
        expect(sent[0].tools).toBeDefined();
        expect(sent[1].tools).toBeUndefined();
        expect(r.json.usage).toMatchObject({ searchDropped: true, requests: 2, searches: 0 });
        expect(r.json.result.courses[0].link.label).toBe('Search on Coursera');
    });

    it('an answer that takes too long is stopped with a clear message and the visitor\'s slot back, inside the function limit', async () => {
        const h = createClaudeHandler({
            fetch: (url, init) => url.startsWith('https://api.anthropic.com')
                ? new Promise((_ok, fail) => init?.signal?.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError'))))
                : mock.fetch(url, init),
            env: () => ({ ANTHROPIC_API_KEY: 'sk-test', SUPABASE_URL: MOCK_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'sb' }),
            turnTimeoutMs: 30,
        });
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(504);
        expect(r.json.error.message).toMatch(/took too long/);
        expect(mock.answers.size).toBe(0);
        // The slot was given back: the visitor's hour count is back to zero.
        const visitor = [...mock.rateCounts].filter(([k]) => k.startsWith('v:')).map(([, v]) => v.count);
        expect(visitor.length).toBeGreaterThan(0);
        expect(visitor.every((c) => c === 0)).toBe(true);
    });

    it('the function may run 120 s, and an answer is stopped well before that', async () => {
        const fs = await import('fs');
        const cfg = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
        expect(cfg.functions['api/claude.ts'].maxDuration).toBe(120);
        const { TURN_TIMEOUT_MS } = await import('../../api/_lib/gateway');
        expect(TURN_TIMEOUT_MS).toBeLessThanOrEqual(120_000 - 15_000);
    });

    it('any other upstream error is passed on, not retried', async () => {
        const h = handlerWith([() => reply({ error: { message: 'Overloaded' } }, 529)]);
        const r = await call(h, { feature: 'upskill', input: UPSKILL });
        expect(r.status).toBe(529);
        expect(sent).toHaveLength(1);
    });

    it('the free mock server answers in the search shape, so the dev server exercises this path', async () => {
        const h = createClaudeHandler({
            fetch: mock.fetch,
            linkFetch: async () => new Response('<title>Not Found</title>', { status: 404, headers: { 'content-type': 'text/html' } }),
            env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
        });
        const r = await call(h, { feature: 'roadmap', input: { roleKey: 'soc:13-2011', title: 'Accountants', riskTask: 'r', targetTask: 't' } });
        expect(r.status).toBe(200);
        expect(r.json.usage).toMatchObject({ searches: 2 });
        expect(r.json.result.courses.length).toBeGreaterThan(0);
    });
});
