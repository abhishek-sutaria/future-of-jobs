/**
 * The Claude gateway behind /api/claude/messages (api/claude.ts on Vercel,
 * scripts/lib/devApiPlugin.ts under `npm run dev`). One code path for both.
 *
 * POST { feature, input, stream? }      the app's own requests (shared/aiFeatures)
 *   1. feature must be in AI_FEATURES and input must pass its schema;
 *   2. the server builds the prompt and the Anthropic body itself
 *      (model, max_tokens and thinking come from the table, never the browser);
 *   3. shared features: a saved answer for this exact request is returned at
 *      once, with no Claude call and no rate-limit count;
 *   4. otherwise, on the server key, the visitor's limit is taken first;
 *   5. Claude's answer is parsed and checked; only a checked answer is
 *      returned, and for shared features saved for every later visitor. If
 *      the call fails or the answer is rejected, the visitor's slot is given
 *      back (api/_lib/rateLimit give), so a failed click costs them nothing.
 *
 * POST <raw Anthropic body> + x-foj-feature: rescore | ping
 *   Only with the visitor's OWN key (x-foj-key-source: user). Shape-checked
 *   (model, max_tokens ≤ 4096, one user message), never on the server key.
 *
 * GET  status for System status: which parts are on and which env var names
 *      are missing. Never a key, never a Claude call.
 */

import {
    AI_FEATURES,
    AI_MODEL,
    RAW_FEATURES,
    RawRequestSchema,
    extractJsonBlock,
    isAiFeature,
    type GatewayErrorBody,
} from '../../src/shared/aiFeatures.js';
import { supabaseConfig, type FetchLike, type ServerEnv } from './supabaseRest.js';
import { requestHash, supabaseSharedAnswers, type SharedAnswerKey } from './sharedAnswers.js';
import { limitsFromEnv, memoryRateLimiter, supabaseRateLimiter, visitorId, type RateLimiter, type Window } from './rateLimit.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface ApiRequest {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    socket?: { remoteAddress?: string };
}

export interface ApiResponse {
    status(code: number): ApiResponse;
    setHeader(name: string, value: string): void;
    json(body: unknown): void;
    send(body: string): void;
    write(chunk: Uint8Array): void;
    end(): void;
}

export interface GatewayDeps {
    fetch: FetchLike;
    /** For checking course links (shared/courseLinks); defaults to `fetch`. */
    linkFetch?: FetchLike;
    /** How long one answer may take in all (TURN_TIMEOUT_MS); tests shorten it. */
    turnTimeoutMs?: number;
    /** Read on every request, so a changed Vercel env applies without a code change. */
    env: () => ServerEnv;
    now?: () => number;
}

function header(req: ApiRequest, name: string): string {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] || '';
    return typeof value === 'string' ? value : '';
}

function fail(res: ApiResponse, status: number, type: string, message: string, extra: Partial<GatewayErrorBody['error']> = {}) {
    const body: GatewayErrorBody = { error: { type, message, ...extra } };
    return res.status(status).json(body);
}

/** The friendly words for the visitor limit, shown as-is in the panel. */
export function rateLimitMessage(window: Window, limit: number, retryAfterSeconds: number): string {
    const minutes = Math.max(1, Math.round(retryAfterSeconds / 60));
    const wait = minutes >= 90 ? `about ${Math.round(minutes / 60)} hours` : `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
    if (window === 'global-day') {
        return `The app has made its daily share of new AI answers. Answers already saved still open instantly; new ones are back in ${wait}.`;
    }
    return `You have asked for ${limit} new AI answers this ${window === 'hour' ? 'hour' : 'day'}, the most one visitor can. Answers already saved still open instantly; new ones are back in ${wait}.`;
}

function parseBody(raw: unknown): Record<string, unknown> | null {
    let v = raw;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { return null; }
    }
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function pipe(upstream: Response, res: ApiResponse) {
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    // Long generations (Startup Ideas, ~55 s) stream over SSE: pipe chunks so the
    // connection never sits idle long enough for a proxy to drop it.
    res.setHeader('cache-control', 'no-cache, no-transform');
    // Tells nginx-family reverse proxies (e.g. the IU frontend) not to buffer.
    res.setHeader('x-accel-buffering', 'no');
    if (!upstream.body) {
        res.send(await upstream.text());
        return;
    }
    const reader = upstream.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(value);
    }
    res.end();
}

// ── One Claude answer: time limit, tokens and time ──────────────────────────

interface ClaudeMessage {
    content?: { text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
}

/** What one new answer cost and took: logged, and sent with the answer. */
export interface AnswerUsage {
    inputTokens: number;
    outputTokens: number;
    ms: number;
    stopReason: string;
}

/**
 * An answer is stopped after this long, so the visitor gets a clear message
 * and their slot back, with time left for the course link checks, inside the
 * function's 120 s limit (vercel.json maxDuration).
 */
export const TURN_TIMEOUT_MS = 100_000;

/** One log line per new answer: tokens and time, never the prompt, the answer or a key. */
function logAnswer(feature: string, usage: AnswerUsage, extra: Record<string, unknown> = {}) {
    console.info('[ai-gateway] answer', JSON.stringify({ feature, ...usage, ...extra }));
}

export function createClaudeHandler(deps: GatewayDeps) {
    const now = deps.now ?? (() => Date.now());
    // One in-memory fallback per instance, kept across requests.
    let memory: { limiter: RateLimiter; sig: string } | null = null;

    const limiterFor = (env: ServerEnv): RateLimiter => {
        const limits = limitsFromEnv(env);
        const sig = JSON.stringify(limits);
        if (memory?.sig !== sig) memory = { limiter: memoryRateLimiter(limits), sig };
        const { config } = supabaseConfig(env);
        return config ? supabaseRateLimiter(config, deps.fetch, limits, memory.limiter) : memory.limiter;
    };

    return async function handler(req: ApiRequest, res: ApiResponse) {
        const env = deps.env();
        const serverKey = (env.ANTHROPIC_API_KEY || '').trim();

        if (req.method === 'GET') {
            const { missing } = supabaseConfig(env);
            res.setHeader('cache-control', 'no-store');
            return res.status(200).json({
                serverKey: Boolean(serverKey),
                sharedAnswers: missing.length === 0,
                rateLimitStore: missing.length === 0 ? 'supabase' : 'memory',
                limits: limitsFromEnv(env),
                missing: [...(serverKey ? [] : ['ANTHROPIC_API_KEY']), ...missing],
            });
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return fail(res, 405, 'foj_bad_request', 'Method not allowed');
        }

        const userProvidedKey = header(req, 'x-user-api-key').trim();
        const keySource = header(req, 'x-foj-key-source').trim();
        const usingUserKey = keySource === 'user' ? Boolean(userProvidedKey) : !serverKey && Boolean(userProvidedKey);
        const apiKey = usingUserKey ? userProvidedKey : serverKey;
        if (!apiKey) {
            return fail(res, 401, 'authentication_error', 'x-api-key header is required (no user key and no ANTHROPIC_API_KEY configured)');
        }

        const body = parseBody(req.body);
        if (!body) return fail(res, 400, 'foj_bad_request', 'The request body must be a JSON object.');

        const callClaude = (anthropicBody: Record<string, unknown>, signal?: AbortSignal) =>
            deps.fetch(ANTHROPIC_URL, {
                method: 'POST',
                ...(signal ? { signal } : {}),
                headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
                body: JSON.stringify(anthropicBody),
            });

        // ── Raw Anthropic body: the visitor's own key only ─────────────────
        if (!('feature' in body)) {
            const rawFeature = header(req, 'x-foj-feature').trim();
            if (!usingUserKey || !(RAW_FEATURES as readonly string[]).includes(rawFeature)) {
                return fail(res, 403, 'foj_not_allowed', 'This is not a request the app makes.');
            }
            const raw = RawRequestSchema.safeParse(body);
            if (!raw.success) return fail(res, 400, 'foj_bad_request', 'This is not a request the app makes.');
            try {
                return await pipe(await callClaude(raw.data), res);
            } catch (error) {
                return fail(res, 502, 'foj_upstream', error instanceof Error ? error.message : 'Unknown proxy error');
            }
        }

        // ── The app's own features ─────────────────────────────────────────
        const name = body.feature;
        if (!isAiFeature(name)) return fail(res, 400, 'foj_bad_request', 'Unknown feature.');
        const feature = AI_FEATURES[name];
        const parsedInput = (feature.input as import('zod').ZodType).safeParse(body.input);
        if (!parsedInput.success) return fail(res, 400, 'foj_bad_request', `The ${name} request is not one the app makes.`);
        const input = parsedInput.data as never;

        const anthropicBody: Record<string, unknown> = {
            model: AI_MODEL,
            max_tokens: feature.maxTokens,
            // Sonnet 5 thinks by default when this is omitted, eating into
            // max_tokens on a structured answer that does not need it.
            thinking: { type: 'disabled' },
            messages: [{ role: 'user', content: feature.prompt(input) }],
        };

        const { config: sbConfig } = supabaseConfig(env);
        const store = feature.shared && sbConfig ? supabaseSharedAnswers(sbConfig, deps.fetch) : null;
        let key: SharedAnswerKey | null = null;
        if (feature.shared) {
            const roleKey = (input as { roleKey: string }).roleKey;
            key = { roleKey, feature: name, promptVersion: feature.promptVersion, inputHash: requestHash(anthropicBody as never) };
        }

        if (store && key) {
            try {
                const hit = await store.get(key);
                if (hit) {
                    res.setHeader('cache-control', 'no-store');
                    return res.status(200).json({ result: hit.payload, shared: { hit: true, saved: true, savedAt: hit.createdAt } });
                }
            } catch (err) {
                console.warn('[ai-gateway] saved-answer read failed:', err instanceof Error ? err.message : 'error');
            }
        }

        // A new Claude answer on the server key counts against the visitor's limit.
        let refund: string[] = [];
        const limiter = usingUserKey ? null : limiterFor(env);
        if (limiter) {
            const t = now();
            const taken = await limiter.take(visitorId(req.headers, req.socket?.remoteAddress), t);
            if (!taken.allowed) {
                res.setHeader('retry-after', String(taken.retryAfterSeconds));
                return fail(res, 429, 'foj_rate_limited', rateLimitMessage(taken.window, taken.limit, taken.retryAfterSeconds), {
                    retryAfterSeconds: taken.retryAfterSeconds,
                    limit: taken.limit,
                    window: taken.window,
                });
            }
            refund = taken.refund;
        }
        /** Claude's answer failed or was rejected: give the visitor's slot back, then answer with the error. */
        const failAndRefund = async (status: number, type: string, message: string) => {
            if (limiter && refund.length > 0) await limiter.give(refund);
            refund = [];
            return fail(res, status, type, message);
        };

        if (feature.stream) {
            let upstream: Response;
            try {
                upstream = await callClaude({ ...anthropicBody, stream: true });
            } catch (error) {
                return failAndRefund(502, 'foj_upstream', error instanceof Error ? error.message : 'Unknown proxy error');
            }
            if (!upstream.ok) {
                let message = upstream.statusText || 'Claude error';
                try {
                    const data = (await upstream.json()) as { error?: { message?: string } };
                    message = data?.error?.message || message;
                } catch { /* keep the status text */ }
                return failAndRefund(upstream.status, 'foj_upstream', message);
            }
            return pipe(upstream, res);
        }

        const started = now();
        const usage: AnswerUsage = { inputTokens: 0, outputTokens: 0, ms: 0, stopReason: '' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), deps.turnTimeoutMs ?? TURN_TIMEOUT_MS);
        let data: ClaudeMessage;
        try {
            const upstream = await callClaude(anthropicBody, controller.signal);
            if (!upstream.ok) {
                let message = upstream.statusText || 'Claude error';
                try {
                    const err = (await upstream.json()) as { error?: { message?: string } };
                    message = err?.error?.message || message;
                } catch { /* keep the status text */ }
                usage.ms = now() - started;
                logAnswer(name, usage, { status: upstream.status });
                return failAndRefund(upstream.status, 'foj_upstream', message);
            }
            data = (await upstream.json()) as ClaudeMessage;
        } catch (error) {
            usage.ms = now() - started;
            if (controller.signal.aborted) {
                logAnswer(name, usage, { status: 504 });
                return failAndRefund(504, 'foj_upstream', 'Claude took too long to answer, so nothing was saved. Try again in a moment.');
            }
            return failAndRefund(502, 'foj_upstream', error instanceof Error ? error.message : 'Unknown proxy error');
        } finally {
            clearTimeout(timer);
        }
        usage.inputTokens = data.usage?.input_tokens ?? 0;
        usage.outputTokens = data.usage?.output_tokens ?? 0;
        usage.stopReason = data.stop_reason ?? '';
        usage.ms = now() - started;

        let answer: unknown;
        try {
            const text = (data.content ?? []).map((p) => p?.text || '').join('\n').trim();
            if (!text) {
                logAnswer(name, usage, { rejected: 'empty' });
                return failAndRefund(502, 'foj_invalid_answer', 'Empty response from Claude');
            }
            try {
                answer = JSON.parse(extractJsonBlock(text));
            } catch {
                logAnswer(name, usage, { rejected: 'json' });
                return failAndRefund(502, 'foj_invalid_answer', usage.stopReason === 'max_tokens'
                    ? 'Claude response truncated: hit max_tokens before finishing the JSON output.'
                    : 'Claude’s answer was not valid JSON, so it was not saved. Try again.');
            }
            answer = (feature.check as (a: unknown, i: unknown) => unknown)(answer, input);
        } catch {
            logAnswer(name, usage, { rejected: 'check' });
            return failAndRefund(502, 'foj_invalid_answer', 'Claude’s answer did not pass the app’s checks, so it was not saved. Try again.');
        }

        // Course links are checked here, before the answer is shown or saved,
        // so a visitor and the saved store only ever get checked links.
        if ('finalize' in feature && feature.finalize) {
            try {
                answer = await feature.finalize(answer, { fetch: deps.linkFetch ?? deps.fetch });
            } catch {
                return failAndRefund(502, 'foj_invalid_answer', 'Claude’s answer did not pass the app’s checks, so it was not saved. Try again.');
            }
        }

        const courseLinks = (answer as { courses?: { link?: { kind?: string } }[] })?.courses;
        logAnswer(name, usage, Array.isArray(courseLinks) ? {
            courses: courseLinks.length,
            direct: courseLinks.filter((c) => c?.link?.kind === 'course').length,
        } : {});

        if (!feature.shared || !key) return res.status(200).json({ result: answer, usage });

        let saved = false;
        let savedAt: string | null = null;
        let result = answer;
        if (store) {
            try {
                const stored = await store.put(key, answer, { model: AI_MODEL });
                saved = true;
                savedAt = stored.createdAt;
                result = stored.payload;
            } catch (err) {
                console.warn('[ai-gateway] saved-answer write failed:', err instanceof Error ? err.message : 'error');
            }
        }
        res.setHeader('cache-control', 'no-store');
        return res.status(200).json({ result, shared: { hit: false, saved, savedAt }, usage });
    };
}
