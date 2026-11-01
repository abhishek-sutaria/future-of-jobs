/**
 * Published AI scores for BLS occupations outside the 50 Kelley roles: today,
 * the 13 Business & Finance occupations no Kelley title covers, so the whole
 * field is scored. Written by `npm run generate-bls-scores` to
 * src/data/ai_scores_bls.json (same model, prompt and parser as ai_scores.json).
 *
 * Kept apart from the store on purpose: these roles are not in the jobs list,
 * the Kelley toggle or the 50-role percentile labels, and nothing here changes
 * a Kelley score, label, colour scale or rank. Their panels make no Claude call.
 *
 * Read through import.meta.glob so the app works before the file exists: with
 * no file, every one of these occupations stays "not scored yet".
 */

import { CACHE_VERSION } from './taskScoring';
import { PERCENTILES, RESILIENCE_LABELS } from '../config/constants';
import { getBakedScores } from './bakedScores';
import { initialJobs } from '../data';
import { MAP_TITLE_TO_SOC } from './onet';
import { OCCUPATION_INDEX, continentOf } from './occupationIndex';

export interface BlsTaskScore {
    name: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
    onetCode: string;
    taskId: number;
}

export interface BlsRoleScore {
    soc: string;
    title: string;
    tasks: BlsTaskScore[];
    /** Mean task aiCapabilityScore to two decimals: the Kelley automationCostIndex rule. */
    automationCostIndex: number;
    /** Mean task humanCriticalityScore. */
    humanCriticality: number;
    /** ISO time of the Claude response. */
    scoredAt: string;
    model: string;
    /** O*NET codes the tasks were taken from (13-2020 has none of its own). */
    onetCodes: string[];
}

interface RawFile {
    version?: number;
    model?: string;
    generatedAt?: string;
    scores?: Record<string, {
        title?: string;
        responseModel?: string | null;
        scoredAt?: string;
        onetCodes?: string[];
        tasks?: { taskName?: string; aiCapabilityScore?: number; humanCriticalityScore?: number; onetCode?: string; taskId?: number }[];
    }>;
}

const SCORE_FILE = '../data/ai_scores_bls.json';
const FILES = import.meta.glob<RawFile>('../data/ai_scores_bls.json', { eager: true, import: 'default' });

const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Parses the file, dropping any entry that is not a complete, in-range score. */
export function parseBlsScores(file: RawFile | null | undefined): { meta: BlsScoresMeta | null; scores: Map<string, BlsRoleScore> } {
    const scores = new Map<string, BlsRoleScore>();
    if (!file || file.version !== CACHE_VERSION || !file.model || !file.scores) return { meta: null, scores };
    for (const [soc, raw] of Object.entries(file.scores)) {
        const tasks = (raw.tasks ?? []).map((t) => ({
            name: t.taskName ?? '',
            aiCapabilityScore: t.aiCapabilityScore as number,
            humanCriticalityScore: t.humanCriticalityScore as number,
            onetCode: t.onetCode ?? '',
            taskId: t.taskId ?? 0,
        }));
        const valid = tasks.length > 0 && tasks.every((t) => t.name && isUnit(t.aiCapabilityScore) && isUnit(t.humanCriticalityScore));
        if (!valid || !raw.scoredAt || !raw.title) {
            console.warn(`[Scores] Ignoring incomplete AI score for ${soc} in ai_scores_bls.json`);
            continue;
        }
        scores.set(soc, {
            soc,
            title: raw.title,
            tasks,
            automationCostIndex: parseFloat(mean(tasks.map((t) => t.aiCapabilityScore)).toFixed(2)),
            humanCriticality: mean(tasks.map((t) => t.humanCriticalityScore)),
            scoredAt: raw.scoredAt,
            model: raw.responseModel ?? file.model,
            onetCodes: raw.onetCodes ?? [],
        });
    }
    return { meta: { model: file.model, generatedAt: file.generatedAt ?? null }, scores };
}

export interface BlsScoresMeta {
    model: string;
    generatedAt: string | null;
}

const PARSED = parseBlsScores(FILES[SCORE_FILE]);

export const BLS_SCORES: ReadonlyMap<string, BlsRoleScore> = PARSED.scores;
export const BLS_SCORES_META: BlsScoresMeta | null = PARSED.meta;

export const blsScoreFor = (soc: string): BlsRoleScore | undefined => BLS_SCORES.get(soc);

const KELLEY_SOCS: ReadonlySet<string> = new Set(initialJobs.map((j) => MAP_TITLE_TO_SOC[j.title]).filter(Boolean));

/** Fields (two-digit SOC majors) in which every occupation has published AI scores. */
export function fullyScoredFields(blsScores: ReadonlyMap<string, unknown> = BLS_SCORES): string[] {
    const byField = new Map<string, boolean>();
    for (const occ of OCCUPATION_INDEX.occupations) {
        const code = continentOf(occ.soc);
        const scored = KELLEY_SOCS.has(occ.soc) || blsScores.has(occ.soc);
        byField.set(code, (byField.get(code) ?? true) && scored);
    }
    return [...byField].filter(([, all]) => all).map(([code]) => code);
}

export const BUSINESS_FINANCE_CODE = '13';

/** True once every Business & Finance occupation resolves to a published score. */
export const BUSINESS_FINANCE_FULLY_SCORED: boolean = fullyScoredFields().includes(BUSINESS_FINANCE_CODE);

/**
 * Plain wording for where scores reach, so the legend, Methodology and guides
 * stay true before and after the Business & Finance scores land.
 */
export const SCORE_COVERAGE = BUSINESS_FINANCE_FULLY_SCORED
    ? {
          short: 'the 50 Kelley roles plus all of Business & Finance',
          sentence: 'AI scores cover the 50 Kelley business roles plus every Business & Finance occupation.',
      }
    : {
          short: 'the 50 Kelley roles',
          sentence: 'AI scores cover the 50 Kelley business roles for now.',
      };

/** Calendar date of the scoring run, as written in the file (UTC). */
export function scoredOnLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
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
    const humans = rows.map((a) => mean(a.tasks.map((t) => t.humanCriticalityScore)));
    const sorted = [...humans].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(Math.floor(p * sorted.length), sorted.length - 1)];
    const h = score.humanCriticality;
    return {
        total: rows.length,
        riskHigherThan: risks.filter((r) => r < score.automationCostIndex).length,
        humanHigherThan: humans.filter((x) => x < h).length,
        resilienceLabel: h >= pct(PERCENTILES.HIGH) ? RESILIENCE_LABELS.TOP : h >= pct(PERCENTILES.LOW) ? RESILIENCE_LABELS.MID : RESILIENCE_LABELS.BOTTOM,
    };
}
