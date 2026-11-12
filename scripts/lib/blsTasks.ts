/**
 * Which O*NET tasks each unscored Business & Finance occupation is scored on,
 * and the BLS inputs that go into its prompt. Pure apart from loadPlanInputs().
 *
 * Rules, matching the published set (scripts/extract_new_jobs.cjs took the first
 * 5 task rows per SOC in O*NET file order):
 *   - An occupation with its own .00 task list: its first 5 tasks in O*NET order.
 *   - An occupation whose tasks come only from sub-codes (13-1199): one task
 *     from each sub-code in turn, in sub-code order, each in O*NET order, so no
 *     single specialty fills all five.
 *   - 13-2020 Property Appraisers and Assessors has no O*NET code of its own.
 *     O*NET lists it as 13-2022.00 and 13-2023.00: their real task rows, read
 *     from the committed Task Statements.txt, taken in turn the same way.
 * No task is ever written or edited here: every name is a verbatim O*NET row.
 */

import fs from 'fs';
import path from 'path';
import { ONET_CODES_FOR_SOC } from '../../src/config/onetSplitCodes';

/** The 13 detailed occupations in SOC major 13 that no Kelley title covers. */
export const BF_TARGET_SOCS = [
    '13-1011', '13-1031', '13-1032', '13-1041', '13-1074', '13-1075', '13-1131',
    '13-1199', '13-2020', '13-2061', '13-2071', '13-2081', '13-2082',
] as const;

/**
 * Control roles: published Business & Finance Kelley roles across the published
 * risk range (average aiCapabilityScore in ai_scores.json, 2026-08-20 set):
 * Financial Analyst 0.30 (lowest of the 20), Project Management Specialist 0.43,
 * Management Consultant 0.56 (middle), Loan Officer 0.64, Credit Analyst 0.73
 * (highest of the 20).
 */
export const CONTROL_JOB_IDS = ['job-4', 'job-46', 'job-6', 'job-28', 'job-23'] as const;

/**
 * Growth sensitivity (report only): the two Business & Finance Kelley roles
 * whose published growth input (BLS OOH 2024–34, data.ts) is furthest from
 * their BLS EP 2025–35 change: Personal Financial Advisor (10 vs 1.4) and
 * Financial Risk Analyst (3 vs 7.4). Re-scored with the EP figure to show how
 * much the vintage the 13 use can move a score. Never published.
 */
export const SENSITIVITY_JOB_IDS = ['job-22', 'job-51'] as const;

export const TASKS_PER_ROLE = 5;

/**
 * The combine rule's table lives in src/config/onetSplitCodes.ts, so the app
 * can name a combined job's O*NET codes too. Re-exported here unchanged.
 */
export { ONET_CODES_FOR_SOC, ONET_SPLIT_CODES_WITHOUT_TASKS } from '../../src/config/onetSplitCodes';
export const TASK_STATEMENTS_PATH = 'data/db_30_1_text/Task Statements.txt';
export const OCCUPATIONS_13_PATH = 'src/data/occupations/13.json';

/** The prompt names its growth figure like this (src/utils/taskScoring.ts). */
export const PROMPT_GROWTH_LABEL =
    'BLS Occupational Outlook 2024-2034 projected employment change for this occupation group (10-year total)';
export const GROWTH_SOURCE = 'BLS Employment Projections 2025–35, Table 1.2, percent change (src/data/occupations/13.json ep.percentChange)';
export const GROWTH_MISMATCH_NOTE =
    'Vintage mismatch: the shared prompt calls this figure the BLS Occupational Outlook 2024-2034 change; the value passed is the BLS Employment Projections 2025-2035 change, the only projection the repository holds for these occupations. Both are 10-year totals in percent from the same BLS programme. The prompt text was not changed, so the method matches the published set.';

export interface PlannedTask {
    /** Verbatim O*NET task text, the name sent to Claude. */
    name: string;
    onetCode: string;
    taskId: number;
    type: string;
    /** 1-based line in Task Statements.txt (line 1 is the header). */
    line: number;
}

export type SelectionRule = 'first-5-onet-order' | 'round-robin-sub-codes' | 'round-robin-onet-codes';

export interface RolePlan {
    soc: string;
    title: string;
    /** OEWS May 2025 national employment, the "US employment level" in the prompt. */
    employment: number;
    /** BLS EP 2025–35 percent change, the growth figure in the prompt. */
    projectedGrowth: number;
    rule: SelectionRule;
    onetCodes: string[];
    tasks: PlannedTask[];
}

interface OccupationTaskRow {
    id: number;
    text: string;
    type: string;
    onetCode: string;
    line: number;
}

export interface OccupationRow {
    soc: string;
    title: string;
    employment: number | null;
    ep: { percentChange: number } | null;
    onetTaskSource: '.00' | 'sub-codes' | 'none';
    onetSubCodes: { code: string }[];
    tasks: OccupationTaskRow[];
}

/** Every task row of Task Statements.txt, by O*NET-SOC code, in file order. */
export function parseTaskStatements(text: string): Map<string, PlannedTask[]> {
    const byCode = new Map<string, PlannedTask[]>();
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].replace(/\r$/, '').split('\t');
        if (cols.length < 4) continue;
        const [onetCode, taskId, name, type] = cols;
        if (!/^\d{2}-\d{4}\.\d{2}$/.test(onetCode) || !name.trim()) continue;
        const row: PlannedTask = { name: name.trim(), onetCode, taskId: Number(taskId), type: type.trim(), line: i + 1 };
        const list = byCode.get(onetCode);
        if (list) list.push(row);
        else byCode.set(onetCode, [row]);
    }
    return byCode;
}

/** One task from each list in turn, each list in its own order, up to `n`. */
export function roundRobin<T>(lists: readonly (readonly T[])[], n: number): T[] {
    const out: T[] = [];
    for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++) {
        for (const list of lists) {
            if (out.length >= n) break;
            if (i < list.length) out.push(list[i]);
        }
    }
    return out;
}

const fromOccupationTask = (t: OccupationTaskRow): PlannedTask => ({
    name: t.text,
    onetCode: t.onetCode,
    taskId: t.id,
    type: t.type,
    line: t.line,
});

/** The plan for one occupation. Throws rather than guess when a source is missing. */
export function planRole(occ: OccupationRow, statements: Map<string, PlannedTask[]>): RolePlan {
    if (occ.employment == null) throw new Error(`${occ.soc}: no OEWS employment in 13.json`);
    if (occ.ep == null) throw new Error(`${occ.soc}: no BLS EP projection in 13.json`);
    const base = { soc: occ.soc, title: occ.title, employment: occ.employment, projectedGrowth: occ.ep.percentChange };

    const standIns = ONET_CODES_FOR_SOC[occ.soc];
    if (standIns) {
        if (occ.onetTaskSource !== 'none') throw new Error(`${occ.soc}: expected no O*NET tasks of its own`);
        const lists = standIns.map((code) => {
            const rows = statements.get(code);
            if (!rows || rows.length === 0) throw new Error(`${occ.soc}: no task rows for ${code} in ${TASK_STATEMENTS_PATH}`);
            return rows;
        });
        return { ...base, rule: 'round-robin-onet-codes', onetCodes: [...standIns], tasks: roundRobin(lists, TASKS_PER_ROLE) };
    }

    if (occ.onetTaskSource === '.00') {
        const own = occ.tasks.filter((t) => t.onetCode === `${occ.soc}.00`);
        const tasks = [...own].sort((a, b) => a.line - b.line).slice(0, TASKS_PER_ROLE).map(fromOccupationTask);
        return { ...base, rule: 'first-5-onet-order', onetCodes: [`${occ.soc}.00`], tasks };
    }

    if (occ.onetTaskSource === 'sub-codes') {
        const codes = occ.onetSubCodes.map((s) => s.code);
        const lists = codes.map((code) =>
            occ.tasks.filter((t) => t.onetCode === code).sort((a, b) => a.line - b.line).map(fromOccupationTask),
        );
        return { ...base, rule: 'round-robin-sub-codes', onetCodes: codes, tasks: roundRobin(lists, TASKS_PER_ROLE) };
    }

    throw new Error(`${occ.soc}: no O*NET task source`);
}

export interface PlanInputs {
    occupations: Record<string, OccupationRow>;
    statements: Map<string, PlannedTask[]>;
}

export function loadPlanInputs(root: string): PlanInputs {
    const file = JSON.parse(fs.readFileSync(path.join(root, OCCUPATIONS_13_PATH), 'utf-8'));
    const statements = parseTaskStatements(fs.readFileSync(path.join(root, TASK_STATEMENTS_PATH), 'utf-8'));
    return { occupations: file.occupations, statements };
}

/** Plans for all 13, in SOC order. */
export function planAll(inputs: PlanInputs): RolePlan[] {
    return BF_TARGET_SOCS.map((soc) => {
        const occ = inputs.occupations[soc];
        if (!occ) throw new Error(`${soc} is not in ${OCCUPATIONS_13_PATH}`);
        const plan = planRole(occ, inputs.statements);
        if (plan.tasks.length !== TASKS_PER_ROLE) {
            throw new Error(`${soc}: only ${plan.tasks.length} tasks available, need ${TASKS_PER_ROLE}`);
        }
        return plan;
    });
}

/**
 * The SOCs in major 13 that no Kelley title covers, from the data itself, so the
 * script can refuse to run if they ever differ from BF_TARGET_SOCS.
 */
export function uncoveredBusinessFinanceSocs(occupations: Record<string, OccupationRow>, kelleySocs: Iterable<string>): string[] {
    const covered = new Set(kelleySocs);
    return Object.keys(occupations).filter((soc) => soc.startsWith('13-') && !covered.has(soc)).sort();
}
