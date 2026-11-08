/**
 * The one scale every scored role is ranked on (utils/roleScale): the 50
 * Kelley titles as the store holds them, plus every scored BLS occupation from
 * the bundled scores. Used by the store's labels, the 3D colours, the
 * dashboard and the role panel, so they can never disagree.
 */

import type { Job } from '../types';
import { BLS_SCORE_HUMAN, BLS_SCORE_RISK } from './blsScores';
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

export function kelleyScorePoints(jobs: readonly Job[]): ScorePoint[] {
    return jobs.filter(jobIsScored).map((j) => ({ key: j.id, risk: j.automationCostIndex, human: jobHuman(j) }));
}

const cache = new WeakMap<readonly Job[], RoleScale>();

/** The scale across all scored roles, for this jobs array (cached per array). */
export function roleScaleFor(jobs: readonly Job[]): RoleScale {
    let scale = cache.get(jobs);
    if (!scale) {
        scale = buildRoleScale([...kelleyScorePoints(jobs), ...BLS_SCORE_POINTS]);
        cache.set(jobs, scale);
    }
    return scale;
}
