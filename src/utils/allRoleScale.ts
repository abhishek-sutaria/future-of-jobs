/**
 * The one scale every scored role is ranked on (utils/roleScale): each scored
 * occupation (SOC) once. That is every Kelley SOC, from the store's Kelley
 * titles, plus every other scored BLS occupation from the bundled scores, 783
 * today. Used by the store's labels, the 3D colours, the dashboard and the
 * role panel, so they can never disagree.
 *
 * A Kelley title takes its SOC's rank. Titles that share a SOC (Marketing /
 * Brand Manager, BI Analyst / Data Scientist, Buyer / Purchasing Agent) share
 * its entry once `--batch kelley` is in, so they have the same numbers and the
 * SOC's one point is those numbers. Until then each title still has its own
 * first score, and the SOC's point is the mean of its titles' scores; each
 * title's own label is still worked out from its own numbers on that scale.
 */

import type { Job } from '../types';
import { BLS_SCORE_HUMAN, BLS_SCORE_RISK } from './blsScores';
import { MAP_TITLE_TO_SOC } from './onet';
import { buildRoleScale, type RoleScale, type ScorePoint } from './roleScale';

export const blsKey = (soc: string): string => `soc:${soc}`;

const jobHuman = (job: Job): number =>
    job.tasks.reduce((sum, t) => sum + t.humanCriticalityScore, 0) / (job.tasks.length || 1);

const jobIsScored = (job: Job): boolean => job.tasks.some((t) => t.aiCapabilityScore > 0 || t.humanCriticalityScore > 0);

/** Every scored BLS occupation outside the Kelley SOCs. Fixed for the life of the page. */
export const BLS_SCORE_POINTS: readonly ScorePoint[] = [...BLS_SCORE_RISK].map(([soc, risk]) => ({
    key: blsKey(soc),
    risk,
    human: BLS_SCORE_HUMAN.get(soc) ?? 0,
}));

/**
 * One point per Kelley SOC with a scored title: the mean of its scored
 * titles' Automation Risk and Human Criticality (identical titles give the
 * SOC's own numbers).
 */
export function kelleySocPoints(jobs: readonly Job[]): ScorePoint[] {
    const bySoc = new Map<string, Job[]>();
    for (const job of jobs) {
        const soc = MAP_TITLE_TO_SOC[job.title];
        if (!soc || !jobIsScored(job)) continue;
        const list = bySoc.get(soc);
        if (list) list.push(job);
        else bySoc.set(soc, [job]);
    }
    return [...bySoc].map(([soc, titles]) => ({
        key: blsKey(soc),
        risk: titles.reduce((s, j) => s + j.automationCostIndex, 0) / titles.length,
        human: titles.reduce((s, j) => s + jobHuman(j), 0) / titles.length,
    }));
}

const cache = new WeakMap<readonly Job[], RoleScale>();

/** The scale across all scored occupations, for this jobs array (cached per array). */
export function roleScaleFor(jobs: readonly Job[]): RoleScale {
    let scale = cache.get(jobs);
    if (!scale) {
        scale = buildRoleScale([...kelleySocPoints(jobs), ...BLS_SCORE_POINTS]);
        cache.set(jobs, scale);
    }
    return scale;
}
