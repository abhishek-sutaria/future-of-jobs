/**
 * Published AI scores for BLS occupations, by SOC: src/data/ai_scores_bls.json,
 * written by `npm run generate-bls-scores` (one model, prompt, parser and set
 * of task rules for every row of data/bls_score_plan_all.json).
 *
 * Two kinds of entry:
 *   - occupations no Kelley title covers (the 736 so far): kept apart from the
 *     store's jobs list, opened as role-panel Jobs (utils/blsRoleJob);
 *   - the 47 Kelley SOCs, once `--batch kelley` has scored them
 *     (KELLEY_SOC_SCORES): the store seeds every Kelley title from its SOC's
 *     entry (utils/kelleyScores), so titles that share a SOC share its tasks
 *     and scores. Until then a Kelley title keeps its first score
 *     (ai_scores.json).
 * Every scored occupation is ranked once on one scale (utils/allRoleScale).
 *
 * Served by scripts/lib/blsScoresPlugin.ts in two parts: the main bundle holds
 * the meta and one Automation Risk per SOC (all the world view needs), and each
 * field's scores, slimmed to the fields read here, load with that field's
 * occupation file (worldStore.loadContinent → loadBlsFieldScores). With no
 * file, every one of these occupations stays "not scored yet".
 */

import { meta as BUNDLE_META, risks as BUNDLE_RISKS, humans as BUNDLE_HUMANS, kelley as BUNDLE_KELLEY, fieldLoaders } from 'virtual:bls-scores';
import { KELLEY_JOB_SOCS, KELLEY_SOC_SET } from './kelleySocs';
import { OCCUPATION_INDEX, continentOf } from './occupationIndex';
import { parseBlsScores, type BlsBundleMeta, type BlsRoleScore } from './blsScoresData';

export { parseBlsScores } from './blsScoresData';
export type { BlsBundleMeta, BlsRoleScore, BlsScoresMeta, BlsTaskScore } from './blsScoresData';

/** Model, file date, entry count and first / last scoredAt of the published set (every entry, Kelley SOCs included). */
export const BLS_SCORES_META: BlsBundleMeta | null = BUNDLE_META;

/** Automation Risk of every scored BLS occupation outside the Kelley SOCs, by SOC. Always loaded. */
export const BLS_SCORE_RISK: ReadonlyMap<string, number> = new Map(Object.entries(BUNDLE_RISKS));

/** Mean Human Criticality of every scored BLS occupation outside the Kelley SOCs, by SOC (4 decimals). Always loaded. */
export const BLS_SCORE_HUMAN: ReadonlyMap<string, number> = new Map(Object.entries(BUNDLE_HUMANS ?? {}));

/**
 * The Kelley SOCs' entries in ai_scores_bls.json, by SOC, in the main bundle:
 * each Kelley title whose SOC is here reads its tasks and scores from it.
 * Empty until `--batch kelley` is written.
 */
export const KELLEY_SOC_SCORES: ReadonlyMap<string, BlsRoleScore> = parseBlsScores(BUNDLE_KELLEY ?? null).scores;

const loadedScores = new Map<string, BlsRoleScore>();
const fieldLoads = new Map<string, Promise<void>>();

/**
 * Loads one field's full scores (tasks, Human Criticality, provenance). A field
 * with no scored occupation resolves at once. A failed load can be retried.
 */
export function loadBlsFieldScores(code: string): Promise<void> {
    const load = fieldLoaders[code];
    if (!load) return Promise.resolve();
    let p = fieldLoads.get(code);
    if (!p) {
        p = load().then((mod) => {
            for (const [soc, score] of parseBlsScores(mod.default).scores) loadedScores.set(soc, score);
        });
        p.catch(() => fieldLoads.delete(code));
        fieldLoads.set(code, p);
    }
    return p;
}

/** Loads every field's scores (tests and scripts). */
export const loadAllBlsScores = (): Promise<void> =>
    Promise.all(Object.keys(fieldLoaders).map(loadBlsFieldScores)).then(() => undefined);

/** Full published score, once its field is loaded (OccupationPanel waits for that). */
export const blsScoreFor = (soc: string): BlsRoleScore | undefined => loadedScores.get(soc);

const KELLEY_SOCS: ReadonlySet<string> = KELLEY_SOC_SET;

/** Fields (two-digit SOC majors) in which every occupation has published AI scores. */
export function fullyScoredFields(blsScored: ReadonlyMap<string, unknown> = BLS_SCORE_RISK): string[] {
    const byField = new Map<string, boolean>();
    for (const occ of OCCUPATION_INDEX.occupations) {
        const code = continentOf(occ.soc);
        const scored = KELLEY_SOCS.has(occ.soc) || blsScored.has(occ.soc);
        byField.set(code, (byField.get(code) ?? true) && scored);
    }
    return [...byField].filter(([, all]) => all).map(([code]) => code);
}

/** Counts behind every coverage sentence, all taken from the data. */
export interface ScoreCounts {
    /** BLS occupations in the app (830). */
    total: number;
    /** Occupations with published scores: the Kelley SOCs plus ai_scores_bls.json. */
    scored: number;
    /** Distinct BLS occupations the 50 Kelley titles map to. */
    kelleySocs: number;
    /** Kelley titles (each its own scored role). */
    kelleyTitles: number;
    /**
     * Scored roles, the population every rank is taken across (utils/roleScale):
     * each Kelley title once plus each other scored occupation once.
     */
    roles: number;
    /** BLS occupations that hold two or more Kelley titles (each title is its own role). */
    sharedKelleySocs: number;
    /** Scored occupations outside the 50 Kelley roles. */
    bls: number;
    /** Kelley SOCs with an entry in ai_scores_bls.json (scored by the one method): 0 until --batch kelley, then 47. */
    kelleyOnFile: number;
    /** Kelley titles whose SOC is on file. */
    kelleyTitlesOnFile: number;
    /** Kelley SOCs still on their first score (ai_scores.json). */
    legacyKelleySocs: number;
    /** Kelley titles still on their first score. */
    legacyKelleyTitles: number;
    /** Occupations scored by the one method (every entry of ai_scores_bls.json): bls + kelleyOnFile. */
    oneMethod: number;
    /**
     * The population every rank is taken across (utils/allRoleScale): each
     * scored occupation once, so the three SOCs that hold two Kelley titles
     * count once. Equal to `scored`.
     */
    ranked: number;
    /** Occupations with no score. */
    unscored: number;
    /** Of those, how many have no O*NET task list at all (index taskCount 0). */
    unscoredNoTasks: number;
    /** Of those, how many are BLS "All Other" residual groups. */
    unscoredAllOther: number;
}

export function scoreCounts(
    blsScored: ReadonlyMap<string, unknown> = BLS_SCORE_RISK,
    kelleyOnFile: ReadonlyMap<string, unknown> = KELLEY_SOC_SCORES,
): ScoreCounts {
    const occs = OCCUPATION_INDEX.occupations;
    const isScored = (soc: string) => KELLEY_SOCS.has(soc) || blsScored.has(soc);
    const unscored = occs.filter((o) => !isScored(o.soc));
    const bls = occs.filter((o) => !KELLEY_SOCS.has(o.soc) && blsScored.has(o.soc)).length;
    const titlesPerSoc = new Map<string, number>();
    for (const k of KELLEY_JOB_SOCS) titlesPerSoc.set(k.soc, (titlesPerSoc.get(k.soc) ?? 0) + 1);
    const kelleySocs = occs.filter((o) => KELLEY_SOCS.has(o.soc)).length;
    const onFile = occs.filter((o) => KELLEY_SOCS.has(o.soc) && kelleyOnFile.has(o.soc)).length;
    const titlesOnFile = KELLEY_JOB_SOCS.filter((k) => kelleyOnFile.has(k.soc)).length;
    const scored = occs.length - unscored.length;
    return {
        total: occs.length,
        scored,
        kelleySocs,
        kelleyTitles: KELLEY_JOB_SOCS.length,
        roles: KELLEY_JOB_SOCS.length + bls,
        sharedKelleySocs: [...titlesPerSoc.values()].filter((n) => n > 1).length,
        bls,
        kelleyOnFile: onFile,
        kelleyTitlesOnFile: titlesOnFile,
        legacyKelleySocs: kelleySocs - onFile,
        legacyKelleyTitles: KELLEY_JOB_SOCS.length - titlesOnFile,
        oneMethod: bls + onFile,
        ranked: scored,
        unscored: unscored.length,
        unscoredNoTasks: unscored.filter((o) => o.taskCount === 0).length,
        unscoredAllOther: unscored.filter((o) => o.title.includes('All Other')).length,
    };
}

export const SCORE_COUNTS: ScoreCounts = scoreCounts();

/**
 * Plain wording for where scores reach, built from the counts, so the legend,
 * Methodology, intro and panels say what the data holds.
 */
export interface ScoreCoverage {
    /** "783 of 830 occupations". */
    short: string;
    /** One sentence on what is scored. */
    sentence: string;
    /** One sentence on what is not, and why ('' when everything is scored). */
    unscoredReason: string;
    /** Ends "Slate peaks …" in the intro ('' when nothing is slate). */
    slate: string;
}

export function scoreCoverage(c: ScoreCounts): ScoreCoverage {
    const n = (v: number) => v.toLocaleString('en-US');
    const noTasks = c.unscored > 0 && c.unscoredNoTasks === c.unscored;
    const what = c.unscoredAllOther === c.unscored ? '“All Other” groups' : 'occupations';
    const unscoredReason =
        c.unscored === 0 ? '' : noTasks
            ? `The other ${n(c.unscored)} are ${what} for which O*NET lists no tasks, so they are not scored.`
            : `The other ${n(c.unscored)} are not scored yet.`;
    const slate = c.unscored === 0 ? '' : noTasks
        ? ` are the ${n(c.unscored)} ${what} for which O*NET lists no tasks, so they are not scored.`
        : ' are scored soon.';
    if (c.bls === 0) {
        return { short: `the ${n(c.kelleyTitles)} Kelley roles`, sentence: `AI scores cover the ${n(c.kelleyTitles)} Kelley business roles for now.`, unscoredReason, slate };
    }
    return {
        short: `${n(c.scored)} of ${n(c.total)} occupations`,
        sentence: `AI scores cover ${n(c.scored)} of the ${n(c.total)} occupations: the ${n(c.kelleyTitles)} Kelley business roles (${n(c.kelleySocs)} BLS occupations) plus ${n(c.bls)} more.`,
        unscoredReason,
        slate,
    };
}

export const SCORE_COVERAGE = scoreCoverage(SCORE_COUNTS);

/**
 * Legend and hover label for an unscored peak. Once every unscored occupation
 * is one O*NET gives no task list, nothing more is coming, so it says why.
 */
export function unscoredLabel(c: ScoreCounts): { title: string; detail: string } {
    return c.unscored > 0 && c.unscoredNoTasks === c.unscored
        ? { title: 'Not scored', detail: 'no O*NET tasks' }
        : { title: 'Not scored yet', detail: 'AI scores coming soon' };
}

export const UNSCORED_LABEL = unscoredLabel(SCORE_COUNTS);

/** Calendar date of the scoring run, as written in the file (UTC). */
export function scoredOnLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** "November 1 to 8, 2026" style range of the first and last scoredAt (UTC). */
export function scoredRangeLabel(first: string | null, last: string | null): string | null {
    if (!first || !last) return null;
    const a = scoredOnLabel(first);
    const b = scoredOnLabel(last);
    return a === b ? a : `${a} to ${b}`;
}

/**
 * Month label of a date range for the header badge, from the data: "Nov 2026",
 * "Aug–Nov 2026" or "Dec 2026–Jan 2027" (UTC). Null with no dates.
 */
export function monthRangeLabel(first: string | null, last: string | null): string | null {
    if (!first || !last) return null;
    const a = new Date(first);
    const b = new Date(last);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    const year = (d: Date) => d.getUTCFullYear();
    if (year(a) === year(b)) return month(a) === month(b) ? `${month(a)} ${year(a)}` : `${month(a)}–${month(b)} ${year(a)}`;
    return `${month(a)} ${year(a)}–${month(b)} ${year(b)}`;
}

/**
 * When the published scores on the map were made: the scoredAt dates in
 * ai_scores_bls.json, plus the first-score date of ai_scores.json while any
 * Kelley title still uses it (`legacyGeneratedAt`, null once none does).
 */
export function publishedScoreDates(meta: BlsBundleMeta | null, legacyGeneratedAt: string | null): { first: string | null; last: string | null } {
    const dates = [meta?.firstScoredAt, meta?.lastScoredAt, legacyGeneratedAt].filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)));
    dates.sort((x, y) => Date.parse(x) - Date.parse(y));
    return { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}
