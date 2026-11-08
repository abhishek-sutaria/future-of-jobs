/**
 * Published AI scores for BLS occupations outside the 50 Kelley roles: every
 * occupation with O*NET tasks that no Kelley title covers. Written by
 * `npm run generate-bls-scores` to src/data/ai_scores_bls.json (same model,
 * prompt and parser as ai_scores.json).
 *
 * Kept apart from the store on purpose: these roles are not in the jobs list,
 * the Kelley toggle or the 50-role percentile labels, and nothing here changes
 * a Kelley score, label, colour scale or rank. Their panels make no Claude call.
 *
 * Served by scripts/lib/blsScoresPlugin.ts in two parts: the main bundle holds
 * the meta and one Automation Risk per SOC (all the world view needs), and each
 * field's scores, slimmed to the fields read here, load with that field's
 * occupation file (worldStore.loadContinent → loadBlsFieldScores). With no
 * file, every one of these occupations stays "not scored yet".
 */

import { meta as BUNDLE_META, risks as BUNDLE_RISKS, fieldLoaders } from 'virtual:bls-scores';
import { PERCENTILES, RESILIENCE_LABELS } from '../config/constants';
import { getBakedScores } from './bakedScores';
import { initialJobs } from '../data';
import { MAP_TITLE_TO_SOC } from './onet';
import { OCCUPATION_INDEX, continentOf } from './occupationIndex';
import { parseBlsScores, type BlsBundleMeta, type BlsRoleScore } from './blsScoresData';

export { parseBlsScores } from './blsScoresData';
export type { BlsBundleMeta, BlsRoleScore, BlsScoresMeta, BlsTaskScore } from './blsScoresData';

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Model, file date, entry count and first / last scoredAt of the published set. */
export const BLS_SCORES_META: BlsBundleMeta | null = BUNDLE_META;

/** Automation Risk of every scored BLS occupation, by SOC. Always loaded. */
export const BLS_SCORE_RISK: ReadonlyMap<string, number> = new Map(Object.entries(BUNDLE_RISKS));

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

const KELLEY_SOCS: ReadonlySet<string> = new Set(initialJobs.map((j) => MAP_TITLE_TO_SOC[j.title]).filter(Boolean));

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
    /** Scored occupations outside the 50 Kelley roles. */
    bls: number;
    /** Occupations with no score. */
    unscored: number;
    /** Of those, how many have no O*NET task list at all (index taskCount 0). */
    unscoredNoTasks: number;
    /** Of those, how many are BLS "All Other" residual groups. */
    unscoredAllOther: number;
}

export function scoreCounts(blsScored: ReadonlyMap<string, unknown> = BLS_SCORE_RISK): ScoreCounts {
    const occs = OCCUPATION_INDEX.occupations;
    const isScored = (soc: string) => KELLEY_SOCS.has(soc) || blsScored.has(soc);
    const unscored = occs.filter((o) => !isScored(o.soc));
    return {
        total: occs.length,
        scored: occs.length - unscored.length,
        kelleySocs: occs.filter((o) => KELLEY_SOCS.has(o.soc)).length,
        bls: occs.filter((o) => !KELLEY_SOCS.has(o.soc) && blsScored.has(o.soc)).length,
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
        return { short: 'the 50 Kelley roles', sentence: 'AI scores cover the 50 Kelley business roles for now.', unscoredReason, slate };
    }
    return {
        short: `${n(c.scored)} of ${n(c.total)} occupations`,
        sentence: `AI scores cover ${n(c.scored)} of the ${n(c.total)} occupations: the 50 Kelley business roles (${n(c.kelleySocs)} BLS occupations) plus ${n(c.bls)} more.`,
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

// ── Where a role would sit among the 50 published Kelley roles ─────────────

export interface KelleyComparison {
    total: number;
    /** How many of the 50 have a lower Automation Risk. */
    riskHigherThan: number;
    /** How many of the 50 have a lower average Human Criticality. */
    humanHigherThan: number;
    /** The Human Resilience label the 50's own thresholds would give it. */
    resilienceLabel: string;
}

/**
 * Compares against the published ai_scores.json set, never the 50 plus this
 * role: the 50 keep their labels and ranks. Thresholds follow store.ts
 * applyPercentileLabels (top quarter Future-Proof, middle half High, bottom
 * quarter At Risk).
 */
export function compareWithKelley(score: Pick<BlsRoleScore, 'automationCostIndex' | 'humanCriticality'>): KelleyComparison | null {
    const published = getBakedScores();
    if (!published) return null;
    const rows = Object.values(published.scores).filter((a) => a.tasks.length > 0);
    if (rows.length === 0) return null;
    const risks = rows.map((a) => parseFloat(mean(a.tasks.map((t) => t.aiCapabilityScore)).toFixed(2)));
    // Three decimals on both sides: exact for five two-decimal task scores, so a
    // tie stays a tie and two decimals' false ties (0.564 and 0.56) never appear.
    const roundHuman = (v: number) => parseFloat(v.toFixed(3));
    const humans = rows.map((a) => roundHuman(mean(a.tasks.map((t) => t.humanCriticalityScore))));
    const sorted = [...humans].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(Math.floor(p * sorted.length), sorted.length - 1)];
    const h = roundHuman(score.humanCriticality);
    return {
        total: rows.length,
        riskHigherThan: risks.filter((r) => r < score.automationCostIndex).length,
        humanHigherThan: humans.filter((x) => x < h).length,
        resilienceLabel: h >= pct(PERCENTILES.HIGH) ? RESILIENCE_LABELS.TOP : h >= pct(PERCENTILES.LOW) ? RESILIENCE_LABELS.MID : RESILIENCE_LABELS.BOTTOM,
    };
}
