/**
 * The only Claude requests the app makes, as a table the server enforces
 * (api/_lib/gateway.ts). The browser sends `{ feature, input }`; the server
 * checks the input against the feature's schema, builds the prompt itself
 * (shared/aiPrompts), and calls Claude with the feature's own model and
 * max_tokens. So the server key can never be spent on a prompt the app did
 * not write.
 *
 * Shared features are answers about a role, the same for every visitor. The
 * first answer that passes the feature's `output` check is saved server-side
 * (Supabase table ai_shared_answers, keyed by role + feature + prompt version
 * + a hash of the exact request), and every later visitor gets that saved
 * answer with no new Claude call. Personal features (résumé based) are never
 * saved on the server.
 *
 * Pure: no Vite, no DOM, no Node. See aiPrompts.ts for why imports carry ".js".
 */

import { z } from 'zod';
import {
    buildAnalyzePrompt,
    buildResumePrompt,
    buildRoadmapPrompt,
    buildScenarioPrompt,
    buildStartupCorePrompt,
    buildStartupPlansPrompt,
    buildUpskillPrompt,
} from './aiPrompts.js';
import { oohEnvelopeCap } from '../utils/oohEnvelope.js';

/** The one model the app calls. claude-sonnet-5 rejects `temperature`, so it is never sent. */
export const AI_MODEL = 'claude-sonnet-5';

/** Highest max_tokens any request may carry (Startup Ideas' two streamed calls). */
export const MAX_TOKENS_CAP = 6000;

// ── Inputs: what the browser may send, with hard size limits ────────────────

/** A Kelley role id ("job-15") or a BLS occupation key ("soc:29-1141"). */
const RoleKey = z.string().regex(/^(job-\d{1,3}|soc:\d\d-\d{4})$/);
const Title = z.string().trim().min(1).max(160);
const TaskName = z.string().trim().min(1).max(600);
const Unit = z.number().min(0).max(1);
/** Résumé text: the browser trims it the same way (hooks/useResumeInput). */
const ResumeText = z.string().trim().min(1).max(30_000);

const AnalyzeInput = z.object({
    roleKey: RoleKey,
    title: Title,
    tasks: z.array(TaskName).min(1).max(12),
    employment: z.number().int().min(0).max(50_000_000),
    projectedGrowth: z.number().min(-100).max(500),
}).strict();

const ScenarioInput = z.object({
    roleKey: RoleKey,
    title: Title,
    risk: Unit,
    tasks: z.array(z.object({ name: TaskName, aiCapabilityScore: Unit }).strict()).min(1).max(12),
}).strict();

const RoadmapInput = z.object({
    roleKey: RoleKey,
    title: Title,
    riskTask: TaskName,
    targetTask: TaskName,
}).strict();

const UpskillInput = z.object({
    roleKey: RoleKey,
    title: Title,
    taskName: TaskName,
    mode: z.enum(['defend', 'build']),
    riskPercent: z.number().min(0).max(100),
}).strict();

const SkillsInput = z.object({ text: ResumeText }).strict();
const StartupCoreInput = z.object({ resume: ResumeText }).strict();
const StartupPlansInput = z.object({
    resume: ResumeText,
    ideaNames: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
}).strict();

// ── Outputs: an answer is saved only if it passes these checks ──────────────

const NonEmpty = z.string().trim().min(1);

/**
 * One task of a live Analyze answer: the shape utils/claude.ts has always
 * validated (TaskScoreSchema), plus the task text it answers. The scores are
 * never shown: every number on the role page is the published one.
 */
export const AnalyzeTaskSchema = z.object({
    task_text: z.string(),
    ai_exposure_score: Unit,
    human_criticality_score: Unit,
    reasoning: NonEmpty,
}).passthrough();

export const AnalyzeOutput = z.object({
    strategic_insight: NonEmpty,
    tasks: z.array(AnalyzeTaskSchema).min(1),
    yearlyForecast: z.array(z.object({
        year: z.number(),
        growthImpact: z.number(),
        reasoning: z.string().optional().default(''),
    }).passthrough()).optional(),
    likely_replacements: z.array(NonEmpty).min(1),
    human_centric_traits: z.array(NonEmpty).min(1),
}).passthrough();

export const ScenarioOutput = z.object({
    story: NonEmpty,
    keyChanges: z.array(NonEmpty).min(1),
}).passthrough();

export const RoadmapOutput = z.object({
    phases: z.array(z.object({ title: NonEmpty, items: z.array(NonEmpty).min(1) }).passthrough()).min(1),
    resources: z.array(z.object({ category: NonEmpty, items: z.array(NonEmpty) }).passthrough()),
    successMetrics: z.array(NonEmpty).min(1),
}).passthrough();

export const UpskillOutput = z.object({
    courses: z.array(z.object({
        title: NonEmpty,
        provider: NonEmpty,
        duration: z.string(),
        level: z.string(),
    }).passthrough()).min(1),
    whyTheseCourses: z.string(),
}).passthrough();

export const SkillsOutput = z.object({
    strengths: z.array(z.string()),
    gaps: z.array(z.string()),
    plan: z.string(),
    feedback: z.string(),
}).passthrough();

// ── The table ───────────────────────────────────────────────────────────────

export type AnalyzeFeatureInput = z.infer<typeof AnalyzeInput>;
export type ScenarioFeatureInput = z.infer<typeof ScenarioInput>;
export type RoadmapFeatureInput = z.infer<typeof RoadmapInput>;
export type UpskillFeatureInput = z.infer<typeof UpskillInput>;

interface FeatureSpec<I> {
    /** Saved once per role and request, then shown to every visitor. */
    shared: boolean;
    /** Streamed straight through as SSE (long résumé generations); never saved. */
    stream: boolean;
    /**
     * Part of the saved answer's key. Bump it when the prompt's meaning changes
     * without its text changing (the key also hashes the exact request, so any
     * text change already gets a new answer).
     */
    promptVersion: string;
    maxTokens: number;
    input: z.ZodType<I>;
    prompt: (input: I) => string;
    /** Checks a parsed answer; returns the answer to save and show, or throws. */
    check: (answer: unknown, input: I) => unknown;
}

function spec<I>(s: FeatureSpec<I>): FeatureSpec<I> {
    return s;
}

/**
 * The live Analyze forecast is clamped into the BLS envelope, as utils/analysis
 * always did, so a saved answer can never overshoot the projection.
 */
function clampForecast(answer: z.infer<typeof AnalyzeOutput>, projectedGrowth: number) {
    if (!answer.yearlyForecast) return answer;
    const cap = oohEnvelopeCap(projectedGrowth);
    const lo = Math.min(0, cap);
    const hi = Math.max(0, cap);
    return {
        ...answer,
        yearlyForecast: answer.yearlyForecast.map((f) => ({ ...f, growthImpact: Math.min(hi, Math.max(lo, f.growthImpact)) })),
    };
}

export const AI_FEATURES = {
    analyze: spec<AnalyzeFeatureInput>({
        shared: true,
        stream: false,
        promptVersion: 'analyze-1',
        maxTokens: 4096,
        input: AnalyzeInput,
        prompt: (i) => buildAnalyzePrompt(i.title, i.tasks, { employment: i.employment, projectedGrowth: i.projectedGrowth }),
        check: (answer, i) => {
            const parsed = AnalyzeOutput.parse(answer);
            // One reasoning per task, or the panel would attach prose to the wrong task.
            if (parsed.tasks.length !== i.tasks.length) {
                throw new Error(`Analyze answered ${parsed.tasks.length} tasks for ${i.tasks.length}`);
            }
            return clampForecast(parsed, i.projectedGrowth);
        },
    }),
    scenario: spec<ScenarioFeatureInput>({
        shared: true,
        stream: false,
        promptVersion: 'scenario-1',
        maxTokens: 4096,
        input: ScenarioInput,
        prompt: (i) => buildScenarioPrompt(i.title, i.risk, i.tasks),
        check: (answer) => ScenarioOutput.parse(answer),
    }),
    roadmap: spec<RoadmapFeatureInput>({
        shared: true,
        stream: false,
        promptVersion: 'roadmap-2',
        maxTokens: 4096,
        input: RoadmapInput,
        prompt: (i) => buildRoadmapPrompt(i.title, i.riskTask, i.targetTask),
        check: (answer) => RoadmapOutput.parse(answer),
    }),
    upskill: spec<UpskillFeatureInput>({
        shared: true,
        stream: false,
        promptVersion: 'upskill-1',
        maxTokens: 4096,
        input: UpskillInput,
        prompt: (i) => buildUpskillPrompt(i.title, i.taskName, i.mode, i.riskPercent),
        check: (answer) => UpskillOutput.parse(answer),
    }),
    skills: spec<z.infer<typeof SkillsInput>>({
        shared: false,
        stream: false,
        promptVersion: 'skills-1',
        maxTokens: 4096,
        input: SkillsInput,
        prompt: (i) => buildResumePrompt(i.text),
        check: (answer) => SkillsOutput.parse(answer),
    }),
    startup_core: spec<z.infer<typeof StartupCoreInput>>({
        shared: false,
        stream: true,
        promptVersion: 'startup-core-1',
        maxTokens: 6000,
        input: StartupCoreInput,
        prompt: (i) => buildStartupCorePrompt(i.resume),
        check: (answer) => answer,
    }),
    startup_plans: spec<z.infer<typeof StartupPlansInput>>({
        shared: false,
        stream: true,
        promptVersion: 'startup-plans-1',
        maxTokens: 6000,
        input: StartupPlansInput,
        prompt: (i) => buildStartupPlansPrompt(i.resume, i.ideaNames),
        check: (answer) => answer,
    }),
} as const;

export type AiFeatureName = keyof typeof AI_FEATURES;
export type SharedFeatureName = 'analyze' | 'scenario' | 'roadmap' | 'upskill';

export const SHARED_FEATURES: readonly SharedFeatureName[] = ['analyze', 'scenario', 'roadmap', 'upskill'];

export const isAiFeature = (name: unknown): name is AiFeatureName =>
    typeof name === 'string' && Object.prototype.hasOwnProperty.call(AI_FEATURES, name);

/**
 * Requests that are still forwarded as a raw Anthropic body, and only with
 * the visitor's OWN key (never the server key): the opt-in full re-score
 * (utils/taskScoring) and the System status ping for a saved key.
 */
export const RAW_FEATURES = ['rescore', 'ping'] as const;
export type RawFeatureName = (typeof RAW_FEATURES)[number];

export const RawRequestSchema = z.object({
    model: z.literal(AI_MODEL),
    max_tokens: z.number().int().min(1).max(4096),
    thinking: z.object({ type: z.literal('disabled') }).strict().optional(),
    messages: z.array(z.object({
        role: z.literal('user'),
        content: z.string().min(1).max(40_000),
    }).strict()).length(1),
}).strict();

/** Pulls the JSON object out of a Claude reply (it sometimes wraps it in a code fence). */
export function extractJsonBlock(text: string): string {
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

// ── What the server answers ─────────────────────────────────────────────────

/** Where a shared answer came from: saved earlier (no Claude call) or made now. */
export interface SharedAnswerMeta {
    /** True when the answer was already saved, so this request made no Claude call. */
    hit: boolean;
    /** True when the answer is in the saved store now (false if saving is off or failed). */
    saved: boolean;
    /** When the saved answer was first made (ISO), if known. */
    savedAt: string | null;
}

export interface FeatureResponse<T> {
    result: T;
    shared?: SharedAnswerMeta;
}

/** Error body the gateway sends; `type` tells the browser which friendly message to show. */
export interface GatewayErrorBody {
    error: {
        type: 'foj_rate_limited' | 'foj_bad_request' | 'foj_not_allowed' | 'foj_invalid_answer' | 'foj_upstream' | string;
        message: string;
        retryAfterSeconds?: number;
        limit?: number;
        window?: 'hour' | 'day' | 'global-day';
    };
}
