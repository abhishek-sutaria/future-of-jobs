/**
 * Where each Kelley title's tasks and scores come from. Pure: no store, no
 * Vite, so tests can run it on a fake Kelley batch.
 *
 *   1. Its SOC's entry in ai_scores_bls.json, when there is one (scored by
 *      `--batch kelley` with the same rules, prompt and inputs as every other
 *      job). The title then takes that entry's O*NET tasks and scores whole,
 *      exactly like any other scored occupation, so titles that share a SOC
 *      (Marketing / Brand Manager, BI Analyst / Data Scientist, Buyer /
 *      Purchasing Agent) get identical tasks and scores. Its own peak, title
 *      and Kelley label stay.
 *   2. Otherwise its first published score (ai_scores.json, Aug 2026), as
 *      before, on its own task list from data.ts.
 *
 * A user's own opt-in re-score (localStorage) still layers on top, as it
 * always has, but over a SOC entry only when it was made on those same tasks:
 * a re-score from before the switch was made on the old task list and is
 * ignored, so it can never pin old numbers on new tasks.
 */

import type { Job } from '../types';
import type { JobAnalysisResult } from './taskScoring';
import type { BlsRoleScore } from './blsScoresData';
import { MAP_TITLE_TO_SOC } from './onet';

/** O*NET's placeholder importance, the same as data.ts and blsRoleJob use. */
const UNIFORM_IMPORTANCE = 3;

/** A Kelley title on its SOC's published entry: the entry's tasks and scores, the title's own everything else. */
export function kelleyJobFromSocScore(job: Job, score: BlsRoleScore): Job {
    // The old yearly forecast belonged to the old task list; no published entry carries one.
    const { yearlyForecast: _oldForecast, ...rest } = job;
    void _oldForecast;
    return {
        ...rest,
        automationCostIndex: score.automationCostIndex,
        tasks: score.tasks.map((t) => ({
            name: t.name,
            aiCapabilityScore: t.aiCapabilityScore,
            humanCriticalityScore: t.humanCriticalityScore,
            importance: UNIFORM_IMPORTANCE,
        })),
    };
}

/** The same task match the store has always used, without its index fallback. */
const taskMatches = (taskName: string, scoredName: string) => scoredName === taskName || scoredName.startsWith(taskName.slice(0, 40));

/** True when an analysis was made on exactly this job's tasks (every task found by name or 40-character prefix). */
export function analysisFitsTasks(job: Pick<Job, 'tasks'>, analysis: Pick<JobAnalysisResult, 'tasks'>): boolean {
    if (analysis.tasks.length !== job.tasks.length) return false;
    return job.tasks.every((t) => analysis.tasks.some((a) => taskMatches(t.name, a.taskName)));
}

/**
 * Seeds the Kelley titles: a title whose SOC has an entry takes it (rule 1),
 * any other title is left as data.ts has it for `applyAnalyses` to fill from
 * its first score (rule 2). `analyses` holds the old scores (only for titles
 * still on them) and any user re-score; a re-score over a SOC entry is kept
 * only when it fits the entry's tasks.
 */
export function seedKelleyJobs(
    jobs: readonly Job[],
    socScores: ReadonlyMap<string, BlsRoleScore>,
    analyses: Record<string, JobAnalysisResult>,
    applyAnalyses: (jobs: Job[], analyses: Record<string, JobAnalysisResult>) => Job[],
): Job[] {
    return jobs.map((job) => {
        const soc = MAP_TITLE_TO_SOC[job.title];
        const score = soc ? socScores.get(soc) : undefined;
        const analysis = analyses[job.id];
        if (!score) return analysis ? applyAnalyses([job], { [job.id]: analysis })[0] : job;
        const seeded = kelleyJobFromSocScore(job, score);
        return analysis && analysisFitsTasks(seeded, analysis) ? applyAnalyses([seeded], { [job.id]: analysis })[0] : seeded;
    });
}
