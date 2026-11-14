/**
 * Pure data rules for src/data/ai_scores_bls.json, shared by the app
 * (utils/blsScores) and the build (scripts/lib/blsScoresPlugin). No Vite, no
 * app state, so both run the very same code.
 *
 * The file holds more than the app reads (yearly forecasts, prompt inputs,
 * hashes). The build keeps only the fields below (slimBlsFile) and splits them
 * so the main bundle carries one Automation Risk per job for the hill colours,
 * and each field's tasks load with that field's occupation file
 * (buildBlsBundle). The meta also counts entries per task rule for the
 * Methodology text. blsScoresSlim.test.ts checks the result against the full
 * file on every field the app reads.
 *
 * Kelley SOCs (the 47 occupations the 50 Kelley titles map to) are scored by
 * `--batch kelley` into this same file. Their entries never go into `risks`,
 * `humans` or the field chunks: they go whole (slimmed) into `kelley`, in the
 * main bundle, because the store seeds every Kelley title at startup and reads
 * its tasks and scores from there (utils/kelleyScores). A Kelley title whose
 * SOC has no entry yet keeps its old score from src/data/ai_scores.json, and
 * the build serves only those old entries (legacyKelleySubset), so once every
 * Kelley SOC is in this file the app reads nothing from ai_scores.json.
 */

import { CACHE_VERSION } from './scoreVersion';
import { meanUnit } from './scoreRounding';

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
    /** Mean task aiCapabilityScore to two decimals, rounded from whole hundredths (utils/scoreRounding). */
    automationCostIndex: number;
    /** Mean task humanCriticalityScore. */
    humanCriticality: number;
    /** ISO time of the Claude response. */
    scoredAt: string;
    model: string;
    /** O*NET codes the tasks were taken from (13-2020 has none of its own). */
    onetCodes: string[];
}

export interface RawBlsTask {
    taskName?: string;
    aiCapabilityScore?: number;
    humanCriticalityScore?: number;
    onetCode?: string;
    taskId?: number;
}

export interface RawBlsEntry {
    title?: string;
    /** Task rule from the plan: first-5-onet-order, round-robin-sub-codes or round-robin-onet-codes. */
    rule?: string;
    responseModel?: string | null;
    scoredAt?: string;
    onetCodes?: string[];
    tasks?: RawBlsTask[];
}

export interface RawBlsFile {
    version?: number;
    model?: string;
    generatedAt?: string;
    scores?: Record<string, RawBlsEntry>;
}

export interface BlsScoresMeta {
    model: string;
    generatedAt: string | null;
}

/** Meta of the published set, with its count and date range taken from the entries. */
export interface BlsBundleMeta extends BlsScoresMeta {
    count: number;
    firstScoredAt: string | null;
    lastScoredAt: string | null;
    /** How many entries each task rule scored. */
    rules: Record<string, number>;
}

const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Parses the file, dropping any entry that is not a complete, in-range score. */
export function parseBlsScores(file: RawBlsFile | null | undefined): { meta: BlsScoresMeta | null; scores: Map<string, BlsRoleScore> } {
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
            automationCostIndex: meanUnit(tasks.map((t) => t.aiCapabilityScore)),
            humanCriticality: mean(tasks.map((t) => t.humanCriticalityScore)),
            scoredAt: raw.scoredAt,
            model: raw.responseModel ?? file.model,
            onetCodes: raw.onetCodes ?? [],
        });
    }
    return { meta: { model: file.model, generatedAt: file.generatedAt ?? null }, scores };
}

/** The fields parseBlsScores reads, file and entry and task; nothing else is kept. */
export const READ_FILE_KEYS = ['version', 'model', 'generatedAt'] as const;
export const READ_ENTRY_KEYS = ['title', 'responseModel', 'scoredAt', 'onetCodes'] as const;
export const READ_TASK_KEYS = ['taskName', 'aiCapabilityScore', 'humanCriticalityScore', 'onetCode', 'taskId'] as const;

function pick<T extends object>(obj: T, keys: readonly string[]): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
    return out as Partial<T>;
}

function slimEntry(entry: RawBlsEntry): RawBlsEntry {
    const out: RawBlsEntry = pick(entry, READ_ENTRY_KEYS);
    if (entry.tasks) out.tasks = entry.tasks.map((t) => pick(t, READ_TASK_KEYS));
    return out;
}

/** The file with only the fields the app reads. */
export function slimBlsFile(file: RawBlsFile): RawBlsFile {
    const out: RawBlsFile = pick(file, READ_FILE_KEYS);
    if (file.scores) out.scores = Object.fromEntries(Object.entries(file.scores).map(([soc, e]) => [soc, slimEntry(e)]));
    return out;
}

export interface BlsBundle {
    meta: BlsBundleMeta | null;
    /**
     * The entries of Kelley SOCs, slimmed, as one file (version, model, scores),
     * for the store's startup seed. Empty scores until --batch kelley is written.
     */
    kelley: RawBlsFile;
    /** Automation Risk per scored SOC: all the world view needs. */
    risks: Record<string, number>;
    /**
     * Mean Human Criticality per scored SOC, rounded to 4 decimals (exact for
     * 5 or 4 two-decimal task scores). With `risks`, enough to rank every
     * scored role at startup (utils/roleScale) without loading a field.
     */
    humans: Record<string, number>;
    /** One slim file per field (two-digit SOC major) holding its scored SOCs. */
    fields: Record<string, RawBlsFile>;
}

/**
 * What the build puts in the main bundle (meta, risks, humans, kelley) and in
 * each field's chunk. `kelleySocs` are the Kelley titles' SOCs: their entries
 * go to `kelley` only.
 */
export function buildBlsBundle(file: RawBlsFile | null | undefined, kelleySocs: Iterable<string> = []): BlsBundle {
    const { meta, scores } = parseBlsScores(file);
    if (!file || !meta) return { meta: null, risks: {}, humans: {}, kelley: { scores: {} }, fields: {} };
    const kelleySet = new Set(kelleySocs);
    const slim = slimBlsFile(file);
    const risks: Record<string, number> = {};
    const humans: Record<string, number> = {};
    const fields: Record<string, RawBlsFile> = {};
    const kelley: RawBlsFile = { ...pick(slim, READ_FILE_KEYS), scores: {} };
    const dates: string[] = [];
    const rules: Record<string, number> = {};
    for (const [soc, s] of scores) {
        dates.push(s.scoredAt);
        const rule = file.scores![soc].rule ?? 'unknown';
        rules[rule] = (rules[rule] ?? 0) + 1;
        if (kelleySet.has(soc)) {
            kelley.scores![soc] = slim.scores![soc];
            continue;
        }
        risks[soc] = s.automationCostIndex;
        humans[soc] = Math.round(s.humanCriticality * 10_000) / 10_000;
        const code = soc.slice(0, 2);
        const field = (fields[code] ??= { ...pick(slim, READ_FILE_KEYS), scores: {} });
        field.scores![soc] = slim.scores![soc];
    }
    dates.sort((a, b) => Date.parse(a) - Date.parse(b));
    return {
        meta: { ...meta, count: scores.size, firstScoredAt: dates[0] ?? null, lastScoredAt: dates[dates.length - 1] ?? null, rules },
        risks,
        humans,
        kelley,
        fields,
    };
}

/** src/data/ai_scores.json: the Kelley titles' first published scores (Aug 2026), by job id. */
export interface LegacyKelleyFile {
    version?: number;
    model?: string;
    generatedAt?: string;
    scores?: Record<string, unknown>;
}

/**
 * The part of ai_scores.json the app still needs: the entries of Kelley titles
 * whose SOC has no entry in ai_scores_bls.json. Empty (and so unused) once
 * --batch kelley has scored every Kelley SOC.
 */
export function legacyKelleySubset(
    legacy: LegacyKelleyFile | null | undefined,
    kelleyJobs: readonly { id: string; soc: string }[],
    socsOnFile: ReadonlySet<string>,
): LegacyKelleyFile {
    const keep = new Set(kelleyJobs.filter((k) => !socsOnFile.has(k.soc)).map((k) => k.id));
    const scores = Object.fromEntries(Object.entries(legacy?.scores ?? {}).filter(([id]) => keep.has(id)));
    return { version: legacy?.version, model: legacy?.model, generatedAt: legacy?.generatedAt, scores };
}
