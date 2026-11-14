/**
 * The scoring plan for every one of the 830 BLS occupations, in all 22 fields,
 * by ONE set of rules. Pure apart from loadAllInputs(). No network: this only
 * reads the committed O*NET and BLS files and builds the prompt text.
 *
 * Rows, in this order (the first 770 are byte for byte the 2026-11-07 plan):
 *   - 770 rows with no `batch`: every occupation outside the Kelley and
 *     Business & Finance SOCs, sorted by scoring group, field, SOC. Scored by
 *     --family 1|2|3 / --fields (2026-11-07/08); 47 of them have no tasks.
 *   - 13 rows with batch "business-finance": BF_TARGET_SOCS, scored on
 *     2026-11-01 by the Business & Finance run (data/bls_scoring_plan.json, the
 *     same planRole). Listed so every scored occupation has its row here; a
 *     run never scores them again.
 *   - 47 rows with batch "kelley": the SOCs of the 50 Kelley titles
 *     (initialJobs through MAP_TITLE_TO_SOC), added 2026-11-08 so they are
 *     scored by the same rules, prompt and inputs as every other job
 *     (--batch kelley). Their old scores in src/data/ai_scores.json used other
 *     tasks and inputs (docs/scoring-decisions.md).
 *
 * Every occupation's entry carries its task rule:
 *   own-code   its own .00 task list, first 5 in O*NET file order
 *   sub-codes  no .00 tasks: one task from each O*NET sub-code in turn
 *   combined   no O*NET code of its own: the split O*NET codes' tasks in turn (ONET_CODES_FOR_SOC)
 *   no-tasks   no O*NET tasks anywhere: never sent; the app shows "Not scored"
 * The task picking itself is planRole() in blsTasks.ts, the code that planned
 * the 13 Business & Finance roles, unchanged.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildJobAnalysisPrompt } from '../../src/utils/taskScoring';
import { familyOf } from '../../src/config/socFamilies';
import {
    BF_TARGET_SOCS,
    ONET_CODES_FOR_SOC,
    TASKS_PER_ROLE,
    TASK_STATEMENTS_PATH,
    parseTaskStatements,
    planRole,
    type OccupationRow,
    type PlanInputs,
    type PlannedTask,
    type SelectionRule,
} from './blsTasks';

export const OCCUPATIONS_DIR = 'src/data/occupations';
export const PLAN_ALL_PATH = 'data/bls_score_plan_all.json';

/**
 * The owner's scoring order, by BLS SOC family (2018 SOC User Guide Table 6,
 * src/config/socFamilies.ts). Not the BLS family numbers: group 2 here is BLS
 * family 3 (Sales and Office), and group 3 is BLS families 2, 4 and 5.
 */
export const SCORING_GROUPS = [
    { id: 1, name: 'Management, Business, Science, and Arts', blsFamilies: [1] },
    { id: 2, name: 'Sales and Office', blsFamilies: [3] },
    {
        id: 3,
        name: 'Service; Natural Resources, Construction, and Maintenance; Production, Transportation, and Material Moving',
        blsFamilies: [2, 4, 5],
    },
] as const;

export type ScoringGroupId = 1 | 2 | 3;
export type TaskRule = 'own-code' | 'sub-codes' | 'combined' | 'no-tasks';
/** Rows added on 2026-11-08 carry a batch; the 770 rows of the first plan have none. */
export type PlanBatch = 'business-finance' | 'kelley';
export const PLAN_BATCHES: readonly PlanBatch[] = ['business-finance', 'kelley'];
/** Batches a scoring run may take (business-finance was scored on 2026-11-01). */
export const RUNNABLE_BATCHES: readonly PlanBatch[] = ['kelley'];

/**
 * Kelley batch controls: five already-published non-Kelley jobs from the
 * 2026-11-01 Business & Finance run, across its risk range and all three task
 * rules: 13-1074 Farm Labor Contractors 0.30 (lowest of the 13), 13-1199
 * Business Operations Specialists, All Other 0.40 (sub-codes), 13-2020
 * Property Appraisers and Assessors 0.55 (combined), 13-1031 Claims Adjusters
 * 0.66, 13-2081 Tax Examiners 0.73 (highest). Re-scored from their own plan
 * rows, whose prompt must hash to the published promptSha256, and compared
 * with the published numbers in ai_scores_bls.json. Never published.
 */
export const KELLEY_CONTROL_SOCS = ['13-1074', '13-1199', '13-2020', '13-1031', '13-2081'] as const;

export function scoringGroupOf(field: string): ScoringGroupId {
    const bls = familyOf(field).id;
    const g = SCORING_GROUPS.find((x) => (x.blsFamilies as readonly number[]).includes(bls));
    if (!g) throw new Error(`field ${field} is in no scoring group`);
    return g.id;
}

export interface PlanAllEntry {
    soc: string;
    title: string;
    /** Scoring order group 1, 2 or 3 (SCORING_GROUPS). */
    family: ScoringGroupId;
    /** BLS SOC family 1-5 (src/config/socFamilies.ts). */
    blsFamily: number;
    /** Two-digit SOC major group: the field on the map. */
    field: string;
    /** Only on the 60 rows added 2026-11-08 (business-finance, kelley). */
    batch?: PlanBatch;
    taskRule: TaskRule;
    /** The blsTasks.ts selection rule behind taskRule; null for no-tasks. */
    selectionRule: SelectionRule | null;
    onetCodes: string[];
    /** OEWS May 2025 national employment, as in the prompt. */
    employment: number;
    /** BLS EP 2025-35 percent change, as in the prompt. */
    projectedGrowth: number;
    tasks: PlannedTask[];
    /** Characters in the prompt (JavaScript string length); null for no-tasks. */
    promptLength: number | null;
    /** SHA-256 of the exact prompt text; null for no-tasks. */
    promptSha256: string | null;
}

const RULE_FROM_SELECTION: Record<SelectionRule, TaskRule> = {
    'first-5-onet-order': 'own-code',
    'round-robin-sub-codes': 'sub-codes',
    'round-robin-onet-codes': 'combined',
};

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** All 22 field files plus the O*NET task rows. */
export function loadAllInputs(root: string): PlanInputs {
    const dir = path.join(root, OCCUPATIONS_DIR);
    const occupations: Record<string, OccupationRow> = {};
    const files = fs.readdirSync(dir).filter((f) => /^\d{2}\.json$/.test(f)).sort();
    for (const f of files) {
        const file = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        Object.assign(occupations, file.occupations);
    }
    const statements = parseTaskStatements(fs.readFileSync(path.join(root, TASK_STATEMENTS_PATH), 'utf-8'));
    return { occupations, statements };
}

/** The 60 SOCs scored before the family batches: the 47 Kelley SOCs and the 13 Business & Finance SOCs. */
export function scoredSocs(kelleySocs: Iterable<string>): Set<string> {
    return new Set([...kelleySocs, ...BF_TARGET_SOCS]);
}

/** Which 2026-11-08 batch a SOC's row belongs to, if any. */
export function batchOf(soc: string, kelleySocs: ReadonlySet<string>): PlanBatch | undefined {
    if (kelleySocs.has(soc)) return 'kelley';
    if ((BF_TARGET_SOCS as readonly string[]).includes(soc)) return 'business-finance';
    return undefined;
}

/** True when the occupation has no task rows anywhere it could take them from. */
function hasNoTasks(occ: OccupationRow): boolean {
    return occ.onetTaskSource === 'none' && !ONET_CODES_FOR_SOC[occ.soc];
}

export function planEntry(occ: OccupationRow, inputs: PlanInputs, batch?: PlanBatch): PlanAllEntry {
    const field = occ.soc.slice(0, 2);
    const base = {
        soc: occ.soc,
        title: occ.title,
        family: scoringGroupOf(field),
        blsFamily: familyOf(field).id,
        field,
        ...(batch ? { batch } : {}),
    };
    if (hasNoTasks(occ)) {
        if (occ.employment == null || occ.ep == null) throw new Error(`${occ.soc}: missing BLS inputs`);
        return {
            ...base,
            taskRule: 'no-tasks',
            selectionRule: null,
            onetCodes: [],
            employment: occ.employment,
            projectedGrowth: occ.ep.percentChange,
            tasks: [],
            promptLength: null,
            promptSha256: null,
        };
    }
    const plan = planRole(occ, inputs.statements);
    if (plan.tasks.length === 0) throw new Error(`${occ.soc}: no tasks planned`);
    const prompt = promptFor(plan);
    return {
        ...base,
        taskRule: RULE_FROM_SELECTION[plan.rule],
        selectionRule: plan.rule,
        onetCodes: plan.onetCodes,
        employment: plan.employment,
        projectedGrowth: plan.projectedGrowth,
        tasks: plan.tasks,
        promptLength: prompt.length,
        promptSha256: sha256(prompt),
    };
}

/** The exact prompt the scoring run sends for a planned job. */
export function promptFor(p: { title: string; tasks: { name: string }[]; employment: number; projectedGrowth: number }): string {
    return buildJobAnalysisPrompt(p.title, p.tasks.map((t) => t.name), p.employment, p.projectedGrowth);
}

const planOrder = (a: PlanAllEntry, b: PlanAllEntry) => a.family - b.family || a.field.localeCompare(b.field) || a.soc.localeCompare(b.soc);

/**
 * Every one of the occupations, one row each: first the rows with no batch
 * (the 2026-11-07 plan, unchanged), then business-finance, then kelley, each
 * sorted by scoring group, field, SOC.
 */
export function planAllFields(inputs: PlanInputs, kelleySocs: Iterable<string>): PlanAllEntry[] {
    const kelley = new Set(kelleySocs);
    const rows = Object.values(inputs.occupations).map((occ) => planEntry(occ, inputs, batchOf(occ.soc, kelley)));
    const part = (batch: PlanBatch | undefined) => rows.filter((e) => e.batch === batch).sort(planOrder);
    return [...part(undefined), ...PLAN_BATCHES.flatMap((b) => part(b))];
}

export interface PlanFilter {
    family?: ScoringGroupId;
    fields?: string[];
    /** --batch kelley. Never combined with --family or --fields. */
    batch?: PlanBatch;
}

/** Parses --family 1|2|3, --fields 11,15,17 and --batch kelley from argv. Throws on a bad value. */
export function parsePlanFilter(argv: readonly string[]): PlanFilter {
    const value = (flag: string) => {
        const i = argv.indexOf(flag);
        if (i === -1) return undefined;
        const v = argv[i + 1];
        if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`);
        return v;
    };
    const filter: PlanFilter = {};
    const fam = value('--family');
    if (fam !== undefined) {
        if (!['1', '2', '3'].includes(fam)) throw new Error(`--family must be 1, 2 or 3, not "${fam}"`);
        filter.family = Number(fam) as ScoringGroupId;
    }
    const fields = value('--fields');
    if (fields !== undefined) {
        const list = fields.split(',').map((f) => f.trim()).filter(Boolean);
        for (const f of list) {
            if (!/^\d{2}$/.test(f)) throw new Error(`--fields takes two-digit SOC majors like 11,15,17, not "${f}"`);
            familyOf(f); // throws for a code outside the 22 fields
        }
        if (list.length === 0) throw new Error('--fields needs at least one field');
        filter.fields = [...new Set(list)].sort();
    }
    const batch = value('--batch');
    if (batch !== undefined) {
        if (!(RUNNABLE_BATCHES as readonly string[]).includes(batch)) {
            throw new Error(
                batch === 'business-finance'
                    ? '--batch business-finance was scored on 2026-11-01 (the Business & Finance run) and is never run again.'
                    : `--batch must be ${RUNNABLE_BATCHES.join(' or ')}, not "${batch}"`,
            );
        }
        if (filter.family !== undefined || filter.fields !== undefined) throw new Error('--batch cannot be combined with --family or --fields');
        filter.batch = batch as PlanBatch;
    }
    return filter;
}

export const isFiltered = (f: PlanFilter) => f.family !== undefined || f.fields !== undefined || f.batch !== undefined;

/**
 * A named batch takes its own rows only. --family / --fields take only rows with
 * no batch, exactly the rows they took before the Kelley and Business & Finance
 * rows were added.
 */
export function applyFilter(entries: readonly PlanAllEntry[], f: PlanFilter): PlanAllEntry[] {
    if (f.batch !== undefined) return entries.filter((e) => e.batch === f.batch);
    return entries.filter((e) => e.batch === undefined && (f.family === undefined || e.family === f.family) && (f.fields === undefined || f.fields.includes(e.field)));
}

/** A stable name for a filtered batch, used to key its control run in the ledger. */
export function batchKey(f: PlanFilter): string {
    if (f.batch !== undefined) return f.batch;
    const parts: string[] = [];
    if (f.family !== undefined) parts.push(`family-${f.family}`);
    if (f.fields !== undefined) parts.push(`fields-${f.fields.join(',')}`);
    return parts.join('+') || 'all';
}

export interface PlanCounts {
    totalOccupations: number;
    /** One row per occupation. */
    rows: number;
    /** Rows with O*NET tasks: every occupation that can be scored. */
    scorable: number;
    /** Rows with no O*NET tasks anywhere: never sent, "Not scored". */
    noTasks: number;
    /** The rows with no batch (the 2026-11-07 plan), per scoring group, counted as then. */
    byFamily: Record<string, { toDo: number; plannable: number; noTasks: number; byRule: Record<TaskRule, number> }>;
    /** The rows added 2026-11-08. */
    byBatch: Record<PlanBatch, { jobs: number; byRule: Record<TaskRule, number> }>;
    /** Every row. */
    byRule: Record<TaskRule, number>;
    fewerThanFiveTasks: string[];
}

const emptyRules = (): Record<TaskRule, number> => ({ 'own-code': 0, 'sub-codes': 0, combined: 0, 'no-tasks': 0 });

export function countPlan(entries: readonly PlanAllEntry[], totalOccupations: number): PlanCounts {
    const byFamily: PlanCounts['byFamily'] = {};
    const byBatch = Object.fromEntries(PLAN_BATCHES.map((b) => [b, { jobs: 0, byRule: emptyRules() }])) as PlanCounts['byBatch'];
    const byRule = emptyRules();
    for (const g of SCORING_GROUPS) byFamily[g.id] = { toDo: 0, plannable: 0, noTasks: 0, byRule: emptyRules() };
    for (const e of entries) {
        byRule[e.taskRule]++;
        if (e.batch) {
            byBatch[e.batch].jobs++;
            byBatch[e.batch].byRule[e.taskRule]++;
            continue;
        }
        const f = byFamily[e.family];
        f.toDo++;
        f.byRule[e.taskRule]++;
        if (e.taskRule === 'no-tasks') f.noTasks++;
        else f.plannable++;
    }
    const noTasks = byRule['no-tasks'];
    return {
        totalOccupations,
        rows: entries.length,
        scorable: entries.length - noTasks,
        noTasks,
        byFamily,
        byBatch,
        byRule,
        fewerThanFiveTasks: entries.filter((e) => e.taskRule !== 'no-tasks' && e.tasks.length < TASKS_PER_ROLE).map((e) => e.soc),
    };
}

// ── Cost estimate (no calls) ────────────────────────────────────────────────

/**
 * Measured on the Business & Finance run (22 calls, data/ai_scores_bls_run.json
 * on the owner's Mac): per call 1,208 input and 721 output tokens, about 7 s.
 * claude-sonnet-5 list price $2 / $10 per million tokens.
 */
export const BF_MEASURED = { inputTokens: 1208, outputTokens: 721, secondsPerCall: 7, pricePerMTok: { input: 2, output: 10 } } as const;
export const RETRY_ALLOWANCE = 0.15;

export interface CostEstimate {
    jobs: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    costWithRetries: number;
    minutes: number;
}

/**
 * Input tokens scale with prompt length against the 13 Business & Finance
 * prompts' mean length; output tokens are taken as the measured mean.
 */
export function estimateCost(entries: readonly PlanAllEntry[], bfMeanPromptLength: number): CostEstimate {
    const jobs = entries.filter((e) => e.promptLength != null);
    const inputTokens = jobs.reduce((s, e) => s + (BF_MEASURED.inputTokens * e.promptLength!) / bfMeanPromptLength, 0);
    const outputTokens = jobs.length * BF_MEASURED.outputTokens;
    const cost = (inputTokens * BF_MEASURED.pricePerMTok.input + outputTokens * BF_MEASURED.pricePerMTok.output) / 1e6;
    return {
        jobs: jobs.length,
        inputTokens: Math.round(inputTokens),
        outputTokens,
        cost,
        costWithRetries: cost * (1 + RETRY_ALLOWANCE),
        minutes: (jobs.length * BF_MEASURED.secondsPerCall) / 60,
    };
}

// ── The committed file ──────────────────────────────────────────────────────

export function planAllFile(entries: PlanAllEntry[], counts: PlanCounts) {
    return {
        _meta: {
            purpose:
                'Every one of the BLS occupations, one row each, with the exact tasks and BLS inputs it is scored on by ONE set of rules, and its prompt hash. Generated by `npm run generate-bls-scores -- --plan`; a scoring run refuses to start if this file and the data disagree. No API call is made to build it.',
            sort: 'Rows with no batch first (the 2026-11-07 plan, unchanged), then batch business-finance, then batch kelley; each part by family (scoring order 1-3), then field (two-digit SOC major), then SOC',
            families: Object.fromEntries(SCORING_GROUPS.map((g) => [g.id, { name: g.name, blsFamilies: g.blsFamilies }])),
            batches: {
                none: 'No batch field: every occupation outside the Kelley and Business & Finance SOCs. Scored by --family 1|2|3 (or --fields) on 2026-11-07/08; rows with no tasks are never sent.',
                'business-finance': 'The 13 SOC-13 occupations no Kelley title covers (scripts/lib/blsTasks.ts BF_TARGET_SOCS), scored on 2026-11-01 by the Business & Finance run from data/bls_scoring_plan.json with the same planRole. Listed so every scored occupation has its row; never run again.',
                kelley: `The 47 SOCs of the 50 Kelley titles (src/data.ts initialJobs through MAP_TITLE_TO_SOC), planned on 2026-11-08 by the same rules, prompt and inputs as every other row and scored by --batch kelley. Controls: ${KELLEY_CONTROL_SOCS.join(', ')} (published business-finance rows). Their earlier scores in src/data/ai_scores.json are history only.`,
            },
            taskRules: {
                'own-code': "The occupation's own .00 tasks, first 5 in O*NET file order.",
                'sub-codes': "No .00 task list: one task from each O*NET sub-code in turn, each in O*NET file order. A task whose text exactly repeats another sub-code's task is skipped (identical text is kept once, under the first sub-code in the occupations data, e.g. 19-3039.03 repeats 19-3039.02).",
                combined:
                    'No O*NET code of its own: the split O*NET codes it maps to (src/config/onetSplitCodes.ts ONET_CODES_FOR_SOC), taken in turn the same way, as for 13-2020.',
                'no-tasks': 'No O*NET tasks anywhere: not scored; the app shows "Not scored".',
            },
            taskSource: `O*NET 30.1 (${TASK_STATEMENTS_PATH})`,
            employment: 'BLS OEWS May 2025 national employment (src/data/occupations/<field>.json employment)',
            growth: 'BLS Employment Projections 2025-35, Table 1.2, percent change (ep.percentChange)',
            prompt: 'src/utils/taskScoring.ts buildJobAnalysisPrompt(title, task names, employment, growth); promptLength in characters, promptSha256 of the UTF-8 text',
            tasksPerRole: TASKS_PER_ROLE,
            counts,
            docs: 'docs/scoring-decisions.md',
        },
        jobs: entries,
    };
}
