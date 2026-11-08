/**
 * The scoring plan for every BLS occupation that has no AI score yet, in all 22
 * fields. Pure apart from loadAllInputs(). No network: this only reads the
 * committed O*NET and BLS files and builds the prompt text.
 *
 * Already scored, so never planned (60 SOCs):
 *   - the 47 SOCs of the 50 Kelley roles (initialJobs through MAP_TITLE_TO_SOC)
 *   - the 13 Business & Finance SOCs in src/data/ai_scores_bls.json (BF_TARGET_SOCS)
 *
 * Every other occupation gets one entry with its task rule:
 *   own-code   its own .00 task list, first 5 in O*NET file order
 *   sub-codes  no .00 tasks: one task from each O*NET sub-code in turn
 *   combined   no O*NET code of its own: the split O*NET codes' tasks in turn (ONET_CODES_FOR_SOC)
 *   no-tasks   no O*NET tasks anywhere: not scored, stays "not scored yet"
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

/** The 60 SOCs that already have published scores. */
export function scoredSocs(kelleySocs: Iterable<string>): Set<string> {
    return new Set([...kelleySocs, ...BF_TARGET_SOCS]);
}

/** True when the occupation has no task rows anywhere it could take them from. */
function hasNoTasks(occ: OccupationRow): boolean {
    return occ.onetTaskSource === 'none' && !ONET_CODES_FOR_SOC[occ.soc];
}

export function planEntry(occ: OccupationRow, inputs: PlanInputs): PlanAllEntry {
    const field = occ.soc.slice(0, 2);
    const base = {
        soc: occ.soc,
        title: occ.title,
        family: scoringGroupOf(field),
        blsFamily: familyOf(field).id,
        field,
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

/** Every unscored occupation, sorted by scoring group, then field, then SOC. */
export function planAllFields(inputs: PlanInputs, scored: ReadonlySet<string>): PlanAllEntry[] {
    return Object.values(inputs.occupations)
        .filter((occ) => !scored.has(occ.soc))
        .map((occ) => planEntry(occ, inputs))
        .sort((a, b) => a.family - b.family || a.field.localeCompare(b.field) || a.soc.localeCompare(b.soc));
}

export interface PlanFilter {
    family?: ScoringGroupId;
    fields?: string[];
}

/** Parses --family 1|2|3 and --fields 11,15,17 from argv. Throws on a bad value. */
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
    return filter;
}

export const isFiltered = (f: PlanFilter) => f.family !== undefined || f.fields !== undefined;

export function applyFilter(entries: readonly PlanAllEntry[], f: PlanFilter): PlanAllEntry[] {
    return entries.filter((e) => (f.family === undefined || e.family === f.family) && (f.fields === undefined || f.fields.includes(e.field)));
}

/** A stable name for a filtered batch, used to key its control run in the ledger. */
export function batchKey(f: PlanFilter): string {
    const parts: string[] = [];
    if (f.family !== undefined) parts.push(`family-${f.family}`);
    if (f.fields !== undefined) parts.push(`fields-${f.fields.join(',')}`);
    return parts.join('+') || 'all';
}

export interface PlanCounts {
    totalOccupations: number;
    scored: number;
    toDo: number;
    plannable: number;
    noTasks: number;
    byFamily: Record<string, { toDo: number; plannable: number; noTasks: number; byRule: Record<TaskRule, number> }>;
    byRule: Record<TaskRule, number>;
    fewerThanFiveTasks: string[];
}

const emptyRules = (): Record<TaskRule, number> => ({ 'own-code': 0, 'sub-codes': 0, combined: 0, 'no-tasks': 0 });

export function countPlan(entries: readonly PlanAllEntry[], totalOccupations: number, scored: number): PlanCounts {
    const byFamily: PlanCounts['byFamily'] = {};
    const byRule = emptyRules();
    for (const g of SCORING_GROUPS) byFamily[g.id] = { toDo: 0, plannable: 0, noTasks: 0, byRule: emptyRules() };
    for (const e of entries) {
        const f = byFamily[e.family];
        f.toDo++;
        f.byRule[e.taskRule]++;
        byRule[e.taskRule]++;
        if (e.taskRule === 'no-tasks') f.noTasks++;
        else f.plannable++;
    }
    const noTasks = byRule['no-tasks'];
    return {
        totalOccupations,
        scored,
        toDo: entries.length,
        plannable: entries.length - noTasks,
        noTasks,
        byFamily,
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
                'Every BLS occupation with no AI score yet, the exact tasks and BLS inputs it would be scored on, and its prompt hash. Generated by `npm run generate-bls-scores -- --plan`; a scoring run refuses to start if this file and the data disagree. No API call is made to build it.',
            sort: 'family (scoring order 1-3), then field (two-digit SOC major), then SOC',
            families: Object.fromEntries(SCORING_GROUPS.map((g) => [g.id, { name: g.name, blsFamilies: g.blsFamilies }])),
            excluded: 'The 60 scored SOCs: 47 Kelley SOCs (src/data.ts initialJobs through MAP_TITLE_TO_SOC) and the 13 Business & Finance SOCs in src/data/ai_scores_bls.json.',
            taskRules: {
                'own-code': "The occupation's own .00 tasks, first 5 in O*NET file order.",
                'sub-codes': "No .00 task list: one task from each O*NET sub-code in turn, each in O*NET file order. A task whose text exactly repeats another sub-code's task is skipped (identical text is kept once, under the first sub-code in the occupations data, e.g. 19-3039.03 repeats 19-3039.02).",
                combined:
                    'No O*NET code of its own: the split O*NET codes it maps to (scripts/lib/blsTasks.ts ONET_CODES_FOR_SOC), taken in turn the same way, as for 13-2020.',
                'no-tasks': 'No O*NET tasks anywhere: not scored, stays "not scored yet".',
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
