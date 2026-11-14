/**
 * The one Claude request both score generators make:
 *   scripts/generate_ai_scores.ts  — the 50 Kelley roles (src/data/ai_scores.json)
 *   scripts/generate_bls_scores.ts — the rest of Business & Finance (src/data/ai_scores_bls.json)
 *
 * Prompt and validation come from src/utils/taskScoring.ts, so neither script
 * keeps its own copy. Moved here unchanged from generate_ai_scores.ts, plus the
 * usage figures and the model name the response reports.
 */

import { buildJobAnalysisPrompt, parseJobAnalysis, type JobAnalysisResult } from '../../src/utils/taskScoring';
import { JobTaskScoringSchema } from '../../src/utils/claude';

// Must mirror src/utils/claude.ts. `thinking: disabled` and max_tokens 4096 are
// deliberate fixes for Sonnet 5 spending the token budget on hidden reasoning
// and truncating the JSON mid-array — do not "simplify" these away.
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const CLAUDE_MODEL = 'claude-sonnet-5';
export const MAX_TOKENS = 4096;

/**
 * Two ways to authenticate, so this is runnable without copying the production
 * secret onto disk:
 *   direct — a key of your own, calls api.anthropic.com (generate_ai_scores.ts
 *            reads ANTHROPIC_API_KEY; generate_bls_scores.ts --direct reads
 *            FOJ_SCORING_API_KEY or ~/.foj_scoring_key, see scoringAuth.ts).
 *            `workspace`, when set, is sent as anthropic-workspace-id (needed
 *            for a user key with no workspace scope).
 *   proxy  — --proxy <url> (or CLAUDE_PROXY_URL), routes through the app's own
 *            /api/claude/messages endpoint, which holds the key server-side
 * The body is requestBody(job) either way, byte for byte.
 */
export type Auth = { mode: 'direct'; key: string; workspace?: string } | { mode: 'proxy'; url: string };

/** URL and headers for one call. The key only ever goes into the x-api-key header. */
export function requestTarget(auth: Auth): { url: string; headers: Record<string, string> } {
    if (auth.mode === 'proxy') return { url: auth.url, headers: { 'content-type': 'application/json' } };
    return {
        url: ANTHROPIC_URL,
        headers: {
            'x-api-key': auth.key,
            ...(auth.workspace ? { 'anthropic-workspace-id': auth.workspace } : {}),
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
        },
    };
}

export interface JobInput {
    title: string;
    taskNames: string[];
    employment: number;
    projectedGrowth: number;
}

export interface ClaudeUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

export interface ScoredResponse {
    analysis: JobAnalysisResult;
    usage: ClaudeUsage | null;
    /** The model the response says served it. */
    model: string | null;
}

/** Thrown when the HTTP call itself fails (proxy down, 4xx/5xx): never worth a blind retry. */
export class TransportError extends Error {}

/** Thrown when Claude answered but the answer failed parsing or the forecast rules. */
export class ResponseError extends Error {
    readonly usage: ClaudeUsage | null;
    readonly model: string | null;
    constructor(message: string, usage: ClaudeUsage | null, model: string | null) {
        super(message);
        this.usage = usage;
        this.model = model;
    }
}

/** Extracts the JSON object/array from a possibly fenced Claude response. */
export function extractJsonBlock(text: string): string {
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const objectStart = cleaned.indexOf('{');
    const arrayStart = cleaned.indexOf('[');
    const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
    if (start === -1) return cleaned;
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (end === -1 || end < start) return cleaned.slice(start);
    return cleaned.slice(start, end + 1);
}

/** The exact request body for one job: same prompt, model, thinking and max_tokens for every caller. */
export function requestBody(job: JobInput): string {
    const prompt = buildJobAnalysisPrompt(job.title, job.taskNames, job.employment, job.projectedGrowth);
    return JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
    });
}

/** One Claude call: builds the shared prompt, sends it, validates with the shared parser. */
export async function scoreWithClaude(job: JobInput, auth: Auth): Promise<ScoredResponse> {
    let response: Response;
    try {
        const { url, headers } = requestTarget(auth);
        response = await fetch(url, { method: 'POST', headers, body: requestBody(job) });
    } catch (err) {
        throw new TransportError(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
        const body = await response.text();
        throw new TransportError(`Claude ${response.status}: ${body.slice(0, 300)}`);
    }

    const body = await response.json();
    const usage: ClaudeUsage | null = body?.usage ?? null;
    const model: string | null = typeof body?.model === 'string' ? body.model : null;
    try {
        if (body?.stop_reason === 'max_tokens') {
            throw new Error(`response truncated (hit max_tokens=${MAX_TOKENS})`);
        }
        const text: string = (body?.content ?? [])
            .map((part: { text?: string }) => part?.text ?? '')
            .join('\n')
            .trim();
        if (!text) throw new Error('empty response from Claude');

        const parsed = JobTaskScoringSchema.parse(JSON.parse(extractJsonBlock(text)));
        return { analysis: parseJobAnalysis(parsed, job.taskNames, job.projectedGrowth), usage, model };
    } catch (err) {
        throw new ResponseError(err instanceof Error ? err.message : String(err), usage, model);
    }
}
