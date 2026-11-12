/**
 * Display formatting for role and region numbers. Formatting only: every
 * input is a published BLS value (or its straight-line EP path), never
 * computed here.
 */

import { YEAR_MIN } from '../config/constants';
import { ONET_CODES_FOR_SOC, describeOnetCodes } from '../config/onetSplitCodes';

/** The workers tooltip: EP counts every worker, self-employed included. */
export const WORKERS_NOTE = `All workers in ${YEAR_MIN}, including self-employed. BLS Employment Projections.`;
export const NO_TASKS_NOTE = 'O*NET has no task list for this occupation.';
export const AI_SOON_TITLE = 'AI scores coming soon';
/** An occupation with no O*NET tasks: there is nothing to score, so nothing is coming. */
export const NOT_SCORED_TITLE = 'Not scored';

/**
 * Where a job's O*NET tasks come from, when O*NET has no list under its own
 * code: the combined jobs (O*NET splits the BLS job into smaller codes) name
 * those codes. `scoredFrom` is the codes its published tasks were taken from.
 */
export function noOwnTaskListNote(soc: string, scoredFrom: readonly string[] = []): string {
    if (scoredFrom.length > 0) {
        return `O*NET has no task list under ${soc} itself. The scored tasks above come from O*NET ${describeOnetCodes(scoredFrom)}.`;
    }
    const split = ONET_CODES_FOR_SOC[soc];
    if (split) return `O*NET has no task list under ${soc} itself: it splits this job into ${describeOnetCodes(split)}.`;
    return NO_TASKS_NOTE;
}

/** 3,465,400 → "3.5M", 140,200 → "140K" (3D labels, where space is tight). */
export function formatWorkersShort(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return Math.round(n).toString();
}

/** 140200 → "140,200". */
export const formatCount = (n: number): string => n.toLocaleString('en-US');

/** BLS EP percent change: 4.2 → "+4.2%", -1.4 → "-1.4%", 0 → "0.0%". */
export function formatGrowth(pct: number): string {
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function growthColor(pct: number): string {
    return pct > 0 ? '#4ade80' : pct < 0 ? '#f87171' : '#94a3b8';
}
