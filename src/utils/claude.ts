import { z } from 'zod';

const CLAUDE_PROXY_ENDPOINT = '/api/claude/messages';
const CLAUDE_MODEL = 'claude-sonnet-5';

const AI_MODE_STORAGE_KEY = 'foj_ai_mode';
const AI_USER_KEY_STORAGE_KEY = 'foj_user_claude_key';

function extractJsonBlock(text: string): string {
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const objectStart = cleaned.indexOf('{');
    const arrayStart = cleaned.indexOf('[');
    const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
    if (start === -1) return cleaned;
    const objectEnd = cleaned.lastIndexOf('}');
    const arrayEnd = cleaned.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    if (end === -1 || end < start) return cleaned.slice(start);
    return cleaned.slice(start, end + 1);
}

function getUserKeyFromStorage(): string | null {
    const mode = localStorage.getItem(AI_MODE_STORAGE_KEY);
    if (mode !== 'user') return null;
    const userKey = localStorage.getItem(AI_USER_KEY_STORAGE_KEY)?.trim();
    return userKey || null;
}

export const TaskScoreSchema = z.object({
    ai_exposure_score: z.number().min(0).max(1),
    human_criticality_score: z.number().min(0).max(1),
    reasoning: z.string().min(1)
});

export const ClaudeResponseSchema = z.object({
    tasks: z.array(TaskScoreSchema).nonempty()
}).passthrough();

/** Batch job scoring + yearly forecast (taskScoring.ts). */
export const JobTaskScoringSchema = z.object({
    tasks: z.array(z.object({
        taskName: z.string().optional(),
        aiCapabilityScore: z.number(),
        humanCriticalityScore: z.number(),
    })).nonempty(),
    yearlyForecast: z.array(z.object({
        year: z.number(),
        growthImpact: z.number(),
        reasoning: z.string().optional(),
    })).nonempty(),
});

export function validateClaudeResponse(jsonText: string) {
    if (/"(?:ai_exposure_score|human_criticality_score)"\s*:\s*(0|1|0\.\d|1\.0)(?!\d|\.)/.test(jsonText)) {
        throw new Error("Validation Error: Score must be exactly 2 decimals.");
    }
    const parsed = JSON.parse(jsonText);
    return ClaudeResponseSchema.parse(parsed);
}

/** Score fields from Claude sometimes arrive as strings ("8") or out of range; coerce + clamp. */
const StartupScore = z.coerce.number().catch(0).transform((n) => Math.max(0, Math.min(10, Math.round(n))));
const StringList = z.array(z.string()).catch([]).default([]);
/** Normalize to exactly Pursue/Test/Avoid even if the model returns a full sentence. */
const Recommendation = z.string().default('Test').transform((s) => {
    const t = s.toLowerCase();
    if (t.includes('avoid')) return 'Avoid';
    if (t.includes('pursue')) return 'Pursue';
    return 'Test';
});

const StartupIdeaSchema = z.object({
    name: z.string().default('Untitled idea'),
    summary: z.string().default(''),
    customer: z.string().default(''),
    problem: z.string().default(''),
    whyNow: z.string().default(''),
    whyAI: z.string().default(''),
    whyYou: z.string().default(''),
    applicableSkills: StringList,
    skillsNeeded: StringList,
    mvpPlan: z.string().default(''),
    firstCustomerPath: z.string().default(''),
    pricingModel: z.string().default(''),
    pathTo10kMrr: z.string().default(''),
    pathToScale: z.string().default(''),
    risks: StringList,
    validation: z.string().default(''),
    difficultyScore: StartupScore,
    resumeFitScore: StartupScore,
    revenuePotentialScore: StartupScore,
    recommendation: Recommendation,
});

const StartupTopThreeSchema = z.object({
    name: z.string().default(''),
    validation48h: z.string().default(''),
    mvp7day: z.string().default(''),
    launch30day: z.string().default(''),
    revenue90day: z.string().default(''),
    techStack: StringList,
    firstCustomers: StringList,
    outreachScript: z.string().default(''),
    killCriteria: z.string().default(''),
});

const FounderProfileSchema = z.object({
    summary: z.string().default(''),
    coreSkills: StringList,
    domains: StringList,
    unfairAdvantages: StringList,
    gaps: StringList,
}).default({ summary: '', coreSkills: [], domains: [], unfairAdvantages: [], gaps: [] });

/**
 * The Startup Ideas dashboard is generated in TWO calls so neither approaches
 * Vercel's function time limit (a single combined call ran ~46-56s, right at the
 * 60s cap, so cold/heavy runs timed out → "Couldn't generate ideas"):
 *   1. StartupCoreSchema  — founder profile + 5 ranked ideas (~35s)
 *   2. StartupPlansSchema — top-3 execution plans (~18s)
 */
export const StartupCoreSchema = z.object({
    founderProfile: FounderProfileSchema,
    ideas: z.array(StartupIdeaSchema).min(1),
    startHere: z.string().default(''),
});

// Call 2 returns, for the top 3 ideas, the heavy per-idea detail AND the
// execution plan. Keeping these out of call 1 is what keeps each call fast.
const StartupDetailSchema = z.object({
    name: z.string().default(''),
    applicableSkills: StringList,
    skillsNeeded: StringList,
    mvpPlan: z.string().default(''),
    firstCustomerPath: z.string().default(''),
    pricingModel: z.string().default(''),
    pathTo10kMrr: z.string().default(''),
    pathToScale: z.string().default(''),
    risks: StringList,
    validation: z.string().default(''),
    validation48h: z.string().default(''),
    mvp7day: z.string().default(''),
    launch30day: z.string().default(''),
    revenue90day: z.string().default(''),
    techStack: StringList,
    firstCustomers: StringList,
    outreachScript: z.string().default(''),
    killCriteria: z.string().default(''),
});

export const StartupPlansSchema = z.object({
    topThree: z.array(StartupDetailSchema).catch([]).default([]),
});

/** Full dashboard shape (core + plans merged) used for the result type. */
export const StartupIdeasSchema = z.object({
    founderProfile: FounderProfileSchema,
    ideas: z.array(StartupIdeaSchema).min(1),
    topThree: z.array(StartupTopThreeSchema).catch([]).default([]),
    startHere: z.string().default(''),
});

interface CallClaudeOptions {
    maxTokens?: number;
    /**
     * Stream the response via SSE. Long generations (e.g. the Startup Ideas
     * dashboard, ~55s / ~5k tokens) send no bytes until finished when
     * unstreamed, so any idle/proxy timeout in the user's path drops them mid-
     * flight ("slow, then fails"). Streaming keeps bytes flowing continuously.
     */
    stream?: boolean;
    /** Called with the accumulated text so far, for progress UI while streaming. */
    onProgress?: (accumulatedText: string) => void;
}

function friendlyHttpError(status: number, message: string): Error {
    const lower = String(message).toLowerCase();
    const missingProxyKey =
        status === 401 &&
        (lower.includes('x-api-key') || lower.includes('api key')) &&
        (lower.includes('required') || lower.includes('missing'));
    if (missingProxyKey) {
        return new Error(
            'No default AI key is configured on the dev server. Add ANTHROPIC_API_KEY to a .env file in the project root and restart the dev server, or use your own key from the Claude setup screen.',
        );
    }
    return new Error(`Claude ${status}: ${message}`);
}

/** Read an Anthropic SSE stream into the final text + stop_reason. */
async function readClaudeStream(
    response: Response,
    onProgress?: (text: string) => void,
): Promise<{ text: string; stopReason: string | null }> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response from Claude');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let stopReason: string | null = null;

    const handleData = (raw: string) => {
        if (!raw || raw === '[DONE]') return;
        let evt: {
            type?: string;
            delta?: { type?: string; text?: string; stop_reason?: string };
            error?: { message?: string };
        };
        try {
            evt = JSON.parse(raw);
        } catch {
            return; // keepalive / partial line
        }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            text += evt.delta.text ?? '';
            onProgress?.(text);
        } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
            stopReason = evt.delta.stop_reason;
        } else if (evt.type === 'error') {
            throw new Error(evt.error?.message || 'Claude streaming error');
        }
    };

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) handleData(trimmed.slice(5).trim());
        }
    }
    if (buffer.trim().startsWith('data:')) handleData(buffer.trim().slice(5).trim());
    return { text, stopReason };
}

export async function callClaudeJSON<T>(prompt: string, schema?: z.ZodType<T>, opts?: CallClaudeOptions): Promise<T> {
    const userKey = getUserKeyFromStorage();
    const stream = opts?.stream ?? false;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (userKey) {
        headers['x-user-api-key'] = userKey;
        headers['x-foj-key-source'] = 'user';
    }

    const response = await fetch(CLAUDE_PROXY_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: opts?.maxTokens ?? 4096,
            // NOTE: claude-sonnet-5 rejects `temperature` ("temperature is deprecated
            // for this model"), which was making every AI call fail with a 400. Do not
            // re-add it. Run-to-run stability for Analyze is preserved by the per-job
            // fingerprint cache in analysis.ts (re-opening a role returns cached scores).
            // Claude Sonnet 5 runs adaptive thinking by default when this is omitted,
            // which silently eats into max_tokens on structured-output calls that
            // don't need deep reasoning — disable it so the full budget goes to JSON.
            thinking: { type: 'disabled' },
            ...(stream ? { stream: true } : {}),
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        let message = response.statusText;
        try {
            const data = await response.json();
            message = data?.error?.message || data?.message || message;
        } catch {
            // no-op
        }
        throw friendlyHttpError(response.status, message);
    }

    let text: string;
    let stopReason: string | null;
    if (stream) {
        const result = await readClaudeStream(response, opts?.onProgress);
        text = result.text.trim();
        stopReason = result.stopReason;
    } else {
        const body = await response.json();
        text = body?.content?.map((part: { type?: string; text?: string }) => part?.text || '').join('\n').trim();
        stopReason = body?.stop_reason ?? null;
    }
    if (!text) {
        throw new Error('Empty response from Claude');
    }
    const jsonText = extractJsonBlock(text);
    try {
        if (schema) {
            const parsed = JSON.parse(jsonText);
            return schema.parse(parsed);
        }
        return JSON.parse(jsonText) as T;
    } catch (e) {
        // A truncated response (hit max_tokens mid-JSON) surfaces as a generic
        // SyntaxError otherwise — give a diagnosable message instead.
        if (stopReason === 'max_tokens') {
            throw new Error('Claude response truncated: hit max_tokens before finishing the JSON output.');
        }
        throw e;
    }
}

/** Maps Claude/proxy errors to short UI copy (never logs secrets). */
export function getClaudeUserFriendlyMessage(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('No default AI key is configured')) {
        return msg;
    }
    if (msg.startsWith('Claude 401:') || msg.includes('authentication') || msg.includes('invalid x-api-key')) {
        return 'Claude could not authenticate. Check your API key, or set ANTHROPIC_API_KEY in .env for default mode.';
    }
    if (msg.includes('429') || msg.toLowerCase().includes('rate')) {
        return 'Claude rate limit reached. Try again in a moment.';
    }
    if (msg.includes('Empty response')) {
        return 'Claude returned an empty response. Try again.';
    }
    if (msg.includes('truncated')) {
        return "Claude's response was cut off before finishing. Try again — usually succeeds on retry.";
    }
    return 'Analysis unavailable. Using baseline data.';
}
