/**
 * A fake Anthropic API and a fake Supabase (PostgREST) in one `fetch`, for
 * tests and for `FOJ_MOCK_CLAUDE=1 npm run dev`. Never used in production and
 * never bundled into the app: only vite.config.ts (dev server) and tests load it.
 *
 * Claude: answers by feature, recognised from the prompt the gateway built,
 * with valid JSON in the app's shapes, and logs every call so a check can
 * prove a saved answer made no second call.
 * Supabase: ai_shared_answers (select / insert ignore-duplicates / delete) and
 * rpc/ai_rate_take, in memory, with the same semantics as the migration.
 */

export const MOCK_SUPABASE_URL = 'http://mock-supabase.local';

export interface MockClaudeCall {
    feature: string;
    at: number;
    stream: boolean;
}

export interface MockBackend {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
    calls: MockClaudeCall[];
    answers: Map<string, { row: Record<string, unknown> }>;
    rateCounts: Map<string, { count: number; expiresAt: number }>;
    reset(): void;
}

function featureOf(prompt: string): string {
    if (prompt.includes('Analyze the following job tasks')) return 'analyze';
    if (prompt.includes('"Day in the Life"')) return 'scenario';
    if (prompt.includes('Career Defend & Build plan')) return 'roadmap';
    if (prompt.includes('Recommend exactly 3 real')) return 'upskill';
    if (prompt.includes('Career Resilience Expert')) return 'skills';
    if (prompt.includes('startup execution coach')) return 'startup_plans';
    if (prompt.includes('AI co-founder')) return 'startup_core';
    if (prompt.trim() === 'ping') return 'ping';
    return 'unknown';
}

function titleOf(prompt: string): string {
    return (
        prompt.match(/for a "([^"]+)" role/)?.[1] ??
        prompt.match(/Role: (.+)/)?.[1]?.trim() ??
        prompt.match(/plan for a (.+?)\./)?.[1] ??
        prompt.match(/working as a "([^"]+)"/)?.[1] ??
        'this role'
    );
}

function answerFor(feature: string, prompt: string, n: number): unknown {
    const title = titleOf(prompt);
    switch (feature) {
        case 'analyze': {
            // The numbered lines between "Tasks:" and the JSON instructions.
            const section = prompt.split('Tasks:')[1]?.split('return a JSON object')[0] ?? '';
            const tasks = [...section.matchAll(/^\s*\d+\. (.+)$/gm)].map((m) => m[1]);
            return {
                strategic_insight: `[mock #${n}] ${title}: AI takes the routine drafting; the judgment calls stay human.`,
                tasks: tasks.map((t) => ({ task_text: t, ai_exposure_score: 0.42, human_criticality_score: 0.61, reasoning: `[mock] Why "${t.slice(0, 30)}" scores this way.` })),
                yearlyForecast: [2025, 2026, 2027, 2028, 2029, 2030].map((year, i) => ({ year, growthImpact: i * 0.5, reasoning: 'mock' })),
                likely_replacements: ['Mock drafting assistant', 'Mock scheduling agent'],
                human_centric_traits: ['Mock judgment', 'Mock trust'],
                human_resilience_label: 'High',
                salary_volatility_label: 'Low',
                salary_forecast: [100, 101, 102, 103, 104, 105],
            };
        }
        case 'scenario':
            return { story: `[mock #${n}] A day in 2030 as a ${title}.`, keyChanges: ['Mock change one', 'Mock change two', 'Mock change three'] };
        case 'roadmap':
            return {
                phases: [
                    { title: 'Months 1-2: Foundation', items: [`[mock #${n}] Learn the review tools a ${title} uses`] },
                    { title: 'Months 3-4: Application', items: ['Mock step'] },
                    { title: 'Months 5-6: Mastery', items: ['Mock step'] },
                ],
                resources: [{ category: 'Courses & Certifications', items: ['Mock course'] }],
                successMetrics: ['Mock metric'],
            };
        case 'upskill':
            return {
                courses: [{ title: `[mock #${n}] Course`, provider: 'Mock Academy', duration: '4 weeks', level: 'Intermediate' }],
                whyTheseCourses: 'Mock reason.',
            };
        case 'skills':
            return { strengths: ['Mock strength'], gaps: ['Mock gap'], plan: 'Mock plan', feedback: 'Mock feedback' };
        default:
            return { ok: true };
    }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** PostgREST-style filters: key=eq.value pairs. */
function filters(url: URL): [string, string][] {
    const out: [string, string][] = [];
    for (const [k, v] of url.searchParams) {
        if (v.startsWith('eq.')) out.push([k, v.slice(3)]);
    }
    return out;
}

export function createMockBackend(): MockBackend {
    const calls: MockClaudeCall[] = [];
    const answers = new Map<string, { row: Record<string, unknown> }>();
    const rateCounts = new Map<string, { count: number; expiresAt: number }>();
    const rowKey = (r: Record<string, unknown>) => [r.role_key, r.feature, r.prompt_version, r.input_hash].join('|');
    const matches = (row: Record<string, unknown>, fs: [string, string][]) => fs.every(([k, v]) => String(row[k]) === v);

    async function fakeFetch(input: string, init?: RequestInit): Promise<Response> {
        const url = new URL(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

        if (url.hostname === 'api.anthropic.com') {
            const prompt: string = body?.messages?.[0]?.content ?? '';
            const feature = featureOf(prompt);
            calls.push({ feature, at: Date.now(), stream: Boolean(body?.stream) });
            const answer = answerFor(feature, prompt, calls.length);
            if (body?.stream) {
                const text = JSON.stringify(feature === 'startup_core'
                    ? { founderProfile: { summary: 'Mock', coreSkills: [], domains: [], unfairAdvantages: [], gaps: [] }, ideas: [{ name: 'Mock idea' }], startHere: 'Mock' }
                    : { topThree: [] });
                const sse = [
                    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
                    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`,
                ].join('');
                return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
            }
            return json(200, { content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' });
        }

        if (url.origin === MOCK_SUPABASE_URL) {
            if (url.pathname === '/rest/v1/rpc/ai_rate_take') {
                // No pruning here: window keys already change every hour and day,
                // and tests run on their own clock.
                const keys: string[] = body.p_keys;
                const limits: number[] = body.p_limits;
                const expires: string[] = body.p_expires;
                keys.forEach((k, i) => { if (!rateCounts.has(k)) rateCounts.set(k, { count: 0, expiresAt: Date.parse(expires[i]) }); });
                for (let i = 0; i < keys.length; i++) {
                    if (rateCounts.get(keys[i])!.count >= limits[i]) return json(200, keys[i]);
                }
                for (const k of keys) rateCounts.get(k)!.count += 1;
                return json(200, null);
            }
            if (url.pathname === '/rest/v1/ai_shared_answers') {
                const fs = filters(url);
                if (method === 'GET') {
                    const rows = [...answers.values()].map((a) => a.row).filter((r) => matches(r, fs));
                    return json(200, rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length)));
                }
                if (method === 'POST') {
                    for (const r of body as Record<string, unknown>[]) {
                        const k = rowKey(r);
                        if (!answers.has(k)) answers.set(k, { row: { ...r, created_at: new Date().toISOString() } });
                    }
                    return new Response(null, { status: 201 });
                }
                if (method === 'DELETE') {
                    const gone: Record<string, unknown>[] = [];
                    for (const [k, a] of answers) if (matches(a.row, fs)) { gone.push(a.row); answers.delete(k); }
                    return json(200, gone);
                }
            }
            return json(404, { message: 'mock: no such route' });
        }

        throw new Error(`mock backend: unexpected fetch to ${url.origin}`);
    }

    return {
        fetch: fakeFetch,
        calls,
        answers,
        rateCounts,
        reset() {
            calls.length = 0;
            answers.clear();
            rateCounts.clear();
        },
    };
}
