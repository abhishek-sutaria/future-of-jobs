/**
 * The 50 Kelley titles and the BLS occupation (SOC) each maps to. Pure: no
 * Vite, no store, so the build plugin (scripts/lib/blsScoresPlugin.ts), the
 * scoring scripts and the app all read the same list.
 */

import { initialJobs } from '../data';
import { MAP_TITLE_TO_SOC } from './onet';

/**
 * Every Kelley title's job id and SOC, in data.ts order. A title with no SOC
 * is left out rather than thrown on (some tests mock MAP_TITLE_TO_SOC empty);
 * roles.test.ts and scorePlanAll.test.ts check that all 50 map to 47 SOCs.
 */
export const KELLEY_JOB_SOCS: readonly { id: string; title: string; soc: string }[] = initialJobs
    .map((j) => ({ id: j.id, title: j.title, soc: MAP_TITLE_TO_SOC[j.title] }))
    .filter((k): k is { id: string; title: string; soc: string } => Boolean(k.soc));

/** The distinct SOCs of the Kelley titles (47: three SOCs hold two titles each). */
export const KELLEY_SOC_SET: ReadonlySet<string> = new Set(KELLEY_JOB_SOCS.map((k) => k.soc));
