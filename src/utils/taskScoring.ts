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

import { callClaudeJSON } from './claude';
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
// v4 = forecast switched from year-over-year deltas to cumulative percent
//      change from 2025 baseline (matches shader dampening calibration).
const CACHE_VERSION = 4;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_MS = 1200; // stay under free-tier limits (~50 req/min)

export function loadScoreCache(): Record<string, JobAnalysisResult> | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const cache: ScoreCache = JSON.parse(raw);
        if (cache.version !== CACHE_VERSION) { localStorage.removeItem(CACHE_KEY); return null; }
        if (Date.now() - cache.timestamp > CACHE_TTL_MS) { localStorage.removeItem(CACHE_KEY); return null; }
        return cache.data;
    } catch {
        return null;
    }
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

interface ClaudeJobResponse {
    tasks: Array<{
        taskName?: string;
        aiCapabilityScore?: number;
        humanCriticalityScore?: number;
    }>;
    yearlyForecast?: Array<{
        year?: number;
        growthImpact?: number;
        reasoning?: string;
    }>;
}

async function callAIForJobAnalysis(
    jobTitle: string,
    taskNames: string[],
    projectedGrowth: number
): Promise<JobAnalysisResult> {
    const growthLabel = `${projectedGrowth >= 0 ? '+' : ''}${projectedGrowth}%`;
    const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i);

    const prompt = `You are an expert labor economist analyzing the impact of Generative AI on job tasks.

Job Title: "${jobTitle}"
BLS Occupational Outlook 2022-2032 projection for this role: ${growthLabel} (10-year total).

TWO outputs are needed:

(1) PER-TASK SCORES (0.00 to 1.00, two-decimal precision):
  - aiCapabilityScore: How easily current GenAI / LLMs can automate this task today.
    0.00 = completely impossible for AI, 1.00 = trivially and fully automated.
  - humanCriticalityScore: How essential human judgment, empathy, ethics, or physical presence is.
    0.00 = human not needed, 1.00 = absolutely requires a human.

(2) YEARLY FORECAST for ${YEAR_MIN} through ${YEAR_MAX} (six years):
  - growthImpact: CUMULATIVE percent change in this role's total US employment
    from the ${YEAR_MIN} baseline. NOT year-over-year — cumulative from ${YEAR_MIN}.
  - Year ${YEAR_MIN} MUST be exactly 0.00 (this is the baseline by definition).
  - Year ${YEAR_MAX} should approximate roughly half of the BLS 10-year projection
    (since BLS covers 2022-2032 and ${YEAR_MIN}-${YEAR_MAX} is roughly half that span),
    adjusted up or down based on AI risk:
      * Mostly high aiCapabilityScore tasks → adjust DOWN (may go negative)
      * Mostly high humanCriticalityScore tasks → adjust UP (may exceed half-projection)
  - Years ${YEAR_MIN + 1} through ${YEAR_MAX - 1}: smooth progression between baseline and endpoint.
  - Use two-decimal precision (e.g. 2.40, -3.85).

Examples to calibrate magnitudes:
  - Software Developer (BLS +25% over 10 yrs, moderate AI exposure):
    2025: 0.00, 2026: 2.50, 2027: 4.20, 2028: 5.80, 2029: 7.00, 2030: 8.50
  - Marketing Manager (BLS +7% over 10 yrs, high AI exposure):
    2025: 0.00, 2026: 1.00, 2027: 1.20, 2028: 0.80, 2029: -0.40, 2030: -2.50
  - Cashier (BLS -2% over 10 yrs, very high AI exposure):
    2025: 0.00, 2026: -1.50, 2027: -3.80, 2028: -6.20, 2029: -8.50, 2030: -10.20

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

    const parsed = await callClaudeJSON<ClaudeJobResponse>(prompt);

    // Clamp and align task scores back to original task names (Claude may paraphrase).
    const tasks: TaskScore[] = (parsed.tasks || []).map((s, i) => ({
        taskName: taskNames[i] ?? s.taskName ?? '',
        aiCapabilityScore: Math.max(0, Math.min(1, Number(s.aiCapabilityScore) || 0)),
        humanCriticalityScore: Math.max(0, Math.min(1, Number(s.humanCriticalityScore) || 0)),
    }));

    // Validate and normalize the forecast.
    const yearlyForecast: ForecastPoint[] = (parsed.yearlyForecast || [])
        .map(f => ({
            year: Number(f.year) || 0,
            growthImpact: Number(f.growthImpact) || 0,
            reasoning: String(f.reasoning || ''),
        }))
        .filter(f => f.year >= YEAR_MIN && f.year <= YEAR_MAX);

    return { tasks, yearlyForecast };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * For each job, asks Claude for per-task scores AND a year-by-year forecast in
 * one round-trip. Reads from localStorage cache first; only hits the API for
 * jobs not yet cached. Saves after each successful job so a refresh keeps
 * partial progress.
 *
 * @param jobs       Subset of the store's job list (id + title + task names + BLS projection)
 * @param _apiKey    Deprecated — user key is read inside callClaudeJSON
 * @param onProgress Called after each job is analyzed (jobId, done, total)
 */
export async function scoreAllJobTasks(
    jobs: { id: string; title: string; tasks: { name: string }[]; projectedGrowth: number }[],
    _apiKey?: string,
    onProgress?: (jobId: string, done: number, total: number) => void
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
                job.projectedGrowth
            );
            result[job.id] = analysis;
            done++;

            saveScoreCache(result);
            onProgress?.(job.id, done, jobs.length);

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
