/**
 * taskScoring.ts
 * --------------
 * Scores every job's O*NET tasks via Gemini API at runtime.
 * Results are cached in localStorage (30-day TTL) so the API is
 * only called once per browser session / cache expiry.
 *
 * Returns scores keyed by jobId so store.ts can patch tasks in place
 * and re-run percentile computation across all 13 jobs.
 */

import { callClaudeJSON } from './claude';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TaskScore {
    taskName: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

interface ScoreCache {
    version: number;
    timestamp: number;
    data: Record<string, TaskScore[]>; // keyed by jobId
}

// ── Cache ──────────────────────────────────────────────────────────────────

const CACHE_KEY = 'foj_ai_scores_v1';
const CACHE_VERSION = 2;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_MS = 1200; // stay under free-tier limits (~50 req/min)

export function loadScoreCache(): Record<string, TaskScore[]> | null {
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

export function saveScoreCache(data: Record<string, TaskScore[]>): void {
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

async function callGeminiForScores(
    jobTitle: string,
    taskNames: string[]
): Promise<TaskScore[]> {
    const prompt = `You are an expert labor economist analyzing the impact of Generative AI on job tasks.

Job Title: "${jobTitle}"

For each task below, provide two scores from 0.0 to 1.0:
- aiCapabilityScore: How easily can current GenAI/LLMs automate this task today?
  (0.0 = completely impossible for AI, 1.0 = trivially and fully automated right now)
- humanCriticalityScore: How essential is human judgment, empathy, ethics, or physical presence?
  (0.0 = human not needed at all, 1.0 = absolutely requires a human, cannot be replaced)

Tasks:
${taskNames.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY a valid JSON array. No markdown, no explanation, no extra text:
[
  { "taskName": "<copy exact task text from above>", "aiCapabilityScore": 0.0, "humanCriticalityScore": 0.0 }
]`;
    const parsed = await callClaudeJSON<TaskScore[]>(prompt);

    // Clamp scores and match back to original task names (Gemini may paraphrase)
    return parsed.map((s, i) => ({
        taskName: taskNames[i] ?? s.taskName, // prefer original text
        aiCapabilityScore: Math.max(0, Math.min(1, Number(s.aiCapabilityScore) || 0)),
        humanCriticalityScore: Math.max(0, Math.min(1, Number(s.humanCriticalityScore) || 0)),
    }));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scores every job's tasks with Gemini. Reads from localStorage cache first;
 * only calls the API for jobs not yet cached. Saves after each successful job.
 *
 * @param jobs  Subset of the store's job list (id + title + task names)
 * @param apiKey  Optional user-provided Claude key (deprecated arg)
 * @param onProgress  Called after each job is scored (jobId, done, total)
 */
export async function scoreAllJobTasks(
    jobs: { id: string; title: string; tasks: { name: string }[] }[],
    _apiKey?: string,
    onProgress?: (jobId: string, done: number, total: number) => void
): Promise<Record<string, TaskScore[]>> {
    const cached = loadScoreCache() ?? {};
    const result: Record<string, TaskScore[]> = { ...cached };

    const uncached = jobs.filter(j => !cached[j.id]);
    let done = Object.keys(cached).length;

    for (const job of uncached) {
        try {
            console.log(`[TaskScoring] Scoring "${job.title}" (${done + 1}/${jobs.length})...`);
            const scores = await callGeminiForScores(
                job.title,
                job.tasks.map(t => t.name)
            );
            result[job.id] = scores;
            done++;

            // Save incrementally so partial progress survives a page reload
            saveScoreCache(result);
            onProgress?.(job.id, done, jobs.length);

            if (done < jobs.length) await sleep(RATE_LIMIT_MS);
        } catch (err) {
            console.error(`[TaskScoring] Failed for "${job.title}":`, err);
            // Leave existing estimated scores for this job; don't abort others
        }
    }

    if (uncached.length === 0) {
        console.log('[TaskScoring] All scores loaded from cache.');
    } else {
        console.log(`[TaskScoring] Done. Scored ${uncached.length} jobs, ${done} total cached.`);
    }

    return result;
}
