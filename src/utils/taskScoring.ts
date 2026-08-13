/**
 * taskScoring.ts
 * --------------
 * For each O*NET-described job, one Claude call returns BOTH:
 *   1. Per-task aiCapabilityScore + humanCriticalityScore (0..1).
 *   2. Year-by-year growthImpact forecast (2026-2030), grounded in the real
 *      BLS 10-year projection passed into the prompt.
 *
 * Results are cached in localStorage (30-day TTL) so the API is only
 * called once per browser session / cache expiry. Cache version bumped
 * when the schema or prompt changes so stale entries are dropped.
 */

import { callClaudeJSON, JobTaskScoringSchema } from './claude';
import { YEAR_MIN, YEAR_MAX } from '../config/constants';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskScore {
    taskName: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

export interface ForecastPoint {
    year: number;
    growthImpact: number;
    reasoning: string;
}

export interface JobAnalysisResult {
    tasks: TaskScore[];
    yearlyForecast: ForecastPoint[];
}

interface ScoreCache {
    version: number;
    timestamp: number;
    data: Record<string, JobAnalysisResult>;
}

// ── Cache ──────────────────────────────────────────────────────────────────

const CACHE_KEY = 'foj_ai_scores_v1';
// v4 = cumulative % from 2025 baseline (not YoY deltas).
// v5 = prompts grounded in inlined BLS numbers; post-parse forecast cap validation.
export const CACHE_VERSION = 5;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_MS = 1200; // stay under free-tier limits (~50 req/min)

/** Cached scores plus the time they were written, or null if absent/stale. */
export function loadScoreCacheWithMeta(): { data: Record<string, JobAnalysisResult>; timestamp: number } | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const cache: ScoreCache = JSON.parse(raw);
        if (cache.version !== CACHE_VERSION) { localStorage.removeItem(CACHE_KEY); return null; }
        if (Date.now() - cache.timestamp > CACHE_TTL_MS) { localStorage.removeItem(CACHE_KEY); return null; }
        return { data: cache.data, timestamp: cache.timestamp };
    } catch {
        return null;
    }
}

export function loadScoreCache(): Record<string, JobAnalysisResult> | null {
    return loadScoreCacheWithMeta()?.data ?? null;
}

export function saveScoreCache(data: Record<string, JobAnalysisResult>): void {
    try {
        const cache: ScoreCache = { version: CACHE_VERSION, timestamp: Date.now(), data };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('[TaskScoring] Could not write cache:', e);
    }
}

export function clearScoreCache(): void {
    localStorage.removeItem(CACHE_KEY);
}

// ── Claude call ────────────────────────────────────────────────────────────

/** Reject forecasts that violate BLS OOH cap or baseline rules (post-Zod). */
function assertValidYearlyForecast(projectedGrowth: number, points: ForecastPoint[]): void {
    const cap = Math.abs(projectedGrowth);
    const baselineTol = 0.08;
    const expectedYears = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);
    const byYear = new Map<number, ForecastPoint>();
    for (const p of points) {
        if (!byYear.has(p.year)) byYear.set(p.year, p);
    }

    for (const y of expectedYears) {
        const pt = byYear.get(y);
        if (!pt) throw new Error(`Forecast missing year ${y}`);
        const g = pt.growthImpact;
        if (!Number.isFinite(g)) throw new Error(`Invalid growthImpact for ${y}`);
        if (cap < 1e-9) {
            if (Math.abs(g) > baselineTol) {
                throw new Error(`BLS 10-year growth ~0%: year ${y} must stay near 0, got ${g}`);
            }
        } else if (Math.abs(g) > cap + 1e-6) {
            throw new Error(`Year ${y}: |cumulative ${g}| exceeds BLS |${projectedGrowth}|`);
        }
    }

    const base = byYear.get(YEAR_MIN);
    if (!base || Math.abs(base.growthImpact) > baselineTol) {
        throw new Error(`${YEAR_MIN} baseline cumulative must be ~0 (within ${baselineTol}), got ${base?.growthImpact}`);
    }
}

/**
 * Builds the job-analysis prompt. Pure — no I/O.
 *
 * Shared by the in-app scoring path (via callClaudeJSON) and the build-time
 * generator (scripts/generate_ai_scores.ts) so precomputed scores and
 * user-refreshed scores can never drift apart.
 */
export function buildJobAnalysisPrompt(
    jobTitle: string,
    taskNames: string[],
    employment: number,
    projectedGrowth: number,
): string {
    const growthLabel = `${projectedGrowth >= 0 ? '+' : ''}${projectedGrowth}%`;
    const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);

    return `You are an expert labor economist analyzing the impact of Generative AI on job tasks.

Job Title: "${jobTitle}"

Official BLS / snapshot context (do not invent different national totals; your forecast must stay consistent with these inputs):
- US employment level (OES snapshot used in app): ${employment.toLocaleString()}
- BLS Occupational Outlook 2024-2034 projected employment change for this occupation group: ${growthLabel} (10-year total)

TWO outputs are needed:

(1) PER-TASK SCORES (0.00 to 1.00, two-decimal precision):
  - aiCapabilityScore: How easily current GenAI / LLMs can automate this task today.
    0.00 = completely impossible for AI, 1.00 = trivially and fully automated.
  - humanCriticalityScore: How essential human judgment, empathy, ethics, or physical presence is.
    0.00 = human not needed, 1.00 = absolutely requires a human.

(2) YEARLY FORECAST for ${YEAR_MIN} through ${YEAR_MAX} (six years):
  - growthImpact: CUMULATIVE percent change in this role's total US employment
    from the ${YEAR_MIN} baseline. NOT year-over-year — cumulative from ${YEAR_MIN}.
  - Year ${YEAR_MIN} MUST be exactly 0.00 (baseline).
  - For EVERY year in the window, cumulative |growthImpact| must NOT exceed |${projectedGrowth}| (the BLS OOH 10-year % above).
  - Years ${YEAR_MIN + 1} through ${YEAR_MAX}: smooth progression toward a plausible 2030 endpoint that still respects the cap at every year.
  - Use two-decimal precision (e.g. 2.40, -3.85).
  - Do not invent other macro statistics (GDP, national unemployment) unless they appear in a task description below.

Tasks:
${taskNames.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY a valid JSON object. No markdown, no extra text:
{
  "tasks": [
    { "taskName": "<copy exact task text from above>", "aiCapabilityScore": 0.00, "humanCriticalityScore": 0.00 }
  ],
  "yearlyForecast": [
${years.map(y => `    { "year": ${y}, "growthImpact": 0.00, "reasoning": "<one short sentence>" }`).join(',\n')}
  ]
}`;
}

/** Raw shape returned by JobTaskScoringSchema — see ./claude. */
type RawJobAnalysis = {
    tasks: { taskName?: string; aiCapabilityScore: number; humanCriticalityScore: number }[];
    yearlyForecast: { year: number; growthImpact: number; reasoning?: string }[];
};

/**
 * Normalizes + validates a parsed Claude response into a JobAnalysisResult.
 * Pure — no I/O. Throws if the forecast violates the BLS cap / baseline rules.
 * Shared by the runtime and the build-time generator (see buildJobAnalysisPrompt).
 */
export function parseJobAnalysis(
    parsed: RawJobAnalysis,
    taskNames: string[],
    projectedGrowth: number,
): JobAnalysisResult {
    const tasks: TaskScore[] = parsed.tasks.map((s, i) => ({
        taskName: taskNames[i] ?? s.taskName ?? '',
        aiCapabilityScore: Math.max(0, Math.min(1, Number(s.aiCapabilityScore) || 0)),
        humanCriticalityScore: Math.max(0, Math.min(1, Number(s.humanCriticalityScore) || 0)),
    }));

    const yearlyForecast: ForecastPoint[] = parsed.yearlyForecast
        .map(f => ({
            year: f.year,
            growthImpact: f.growthImpact,
            reasoning: String(f.reasoning ?? ''),
        }))
        .filter(f => f.year >= YEAR_MIN && f.year <= YEAR_MAX)
        .sort((a, b) => a.year - b.year);

    assertValidYearlyForecast(projectedGrowth, yearlyForecast);

    return { tasks, yearlyForecast };
}

async function callAIForJobAnalysis(
    jobTitle: string,
    taskNames: string[],
    employment: number,
    projectedGrowth: number,
): Promise<JobAnalysisResult> {
    const prompt = buildJobAnalysisPrompt(jobTitle, taskNames, employment, projectedGrowth);
    const parsed = await callClaudeJSON(prompt, JobTaskScoringSchema);
    return parseJobAnalysis(parsed, taskNames, projectedGrowth);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * For each job, asks Claude for per-task scores AND a year-by-year forecast in
 * one round-trip. Reads from localStorage cache first; only hits the API for
 * jobs not yet cached. Saves after each successful job so a refresh keeps
 * partial progress.
 *
 * @param jobs       Subset of the store's job list (id + title + tasks + OES employment + BLS OOH %)
 * @param _apiKey    Deprecated — user key is read inside callClaudeJSON
 * @param onProgress Called after each job is analyzed (jobId, done, total)
 */
export async function scoreAllJobTasks(
    jobs: { id: string; title: string; tasks: { name: string }[]; employment: number; projectedGrowth: number }[],
    _apiKey?: string,
    onProgress?: (jobId: string, done: number, total: number, analysis: JobAnalysisResult) => void
): Promise<Record<string, JobAnalysisResult>> {
    const cached = loadScoreCache() ?? {};
    const result: Record<string, JobAnalysisResult> = { ...cached };

    const uncached = jobs.filter(j => !cached[j.id]);
    let done = Object.keys(cached).length;

    for (const job of uncached) {
        try {
            console.log(`[TaskScoring] Analyzing "${job.title}" (${done + 1}/${jobs.length})...`);
            const analysis = await callAIForJobAnalysis(
                job.title,
                job.tasks.map(t => t.name),
                job.employment,
                job.projectedGrowth,
            );
            result[job.id] = analysis;
            done++;

            saveScoreCache(result);
            onProgress?.(job.id, done, jobs.length, analysis);

            if (done < jobs.length) await sleep(RATE_LIMIT_MS);
        } catch (err) {
            console.error(`[TaskScoring] Failed for "${job.title}":`, err);
            // Leave this job pending; don't abort the others.
        }
    }

    if (uncached.length === 0) {
        console.log('[TaskScoring] All analyses loaded from cache.');
    } else {
        console.log(`[TaskScoring] Done. Analyzed ${uncached.length} new jobs, ${done} total cached.`);
    }

    return result;
}
