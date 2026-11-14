/**
 * The scoring plan for all 830 occupations, one set of rules (scripts/lib/
 * scorePlanAll.ts → data/bls_score_plan_all.json). No API call: --plan only
 * reads committed files.
 *
 * Checks: one row per occupation; the 770 rows of the 2026-11-07 plan are byte
 * for byte as they were, followed by the 13 business-finance and 47 kelley
 * rows; 830 = 783 scorable + 47 no-task; the committed file is exactly what
 * --plan writes; every task is a verbatim O*NET row; the combine rule covers
 * every O*NET code with tasks that no BLS occupation owns; every published
 * entry's promptSha256 is its plan row's; --batch kelley's controls re-score
 * published prompts; and --plan makes zero network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initialJobs } from '../data';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import {
    BF_TARGET_SOCS,
    ONET_CODES_FOR_SOC,
    ONET_SPLIT_CODES_WITHOUT_TASKS,
    TASK_STATEMENTS_PATH,
    loadPlanInputs,
    planAll,
} from '../../scripts/lib/blsTasks';
import {
    KELLEY_CONTROL_SOCS,
    PLAN_ALL_PATH,
    applyFilter,
    batchKey,
    countPlan,
    loadAllInputs,
    parsePlanFilter,
    planAllFields,
    planAllFile,
    promptFor,
    scoredSocs,
    sha256,
} from '../../scripts/lib/scorePlanAll';
import { ONET_SPLIT_CODE_TITLES } from '../config/onetSplitCodes';
import crypto from 'crypto';

const ROOT = path.resolve(__dirname, '../..');
const inputs = loadAllInputs(ROOT);
const kelleySocs = new Set(initialJobs.map((j) => MAP_TITLE_TO_SOC[j.title]));
const scored = scoredSocs(kelleySocs);
const entries = planAllFields(inputs, kelleySocs);
const counts = countPlan(entries, Object.keys(inputs.occupations).length);
const bySoc = new Map(entries.map((e) => [e.soc, e]));
/** The rows of the first plan (2026-11-07): no batch. */
const firstPlan = entries.filter((e) => !e.batch);
const PUBLISHED = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores_bls.json'), 'utf-8')).scores as Record<string, { promptSha256: string; tasks: { taskName: string; aiCapabilityScore: number; humanCriticalityScore: number }[] }>;
const statementLines = fs.readFileSync(path.join(ROOT, TASK_STATEMENTS_PATH), 'utf-8').split('\n');

/** O*NET codes with at least one task row, from the raw file. */
const taskCounts = new Map<string, number>();
for (const line of statementLines.slice(1)) {
    const code = line.split('\t')[0];
    if (/^\d{2}-\d{4}\.\d{2}$/.test(code)) taskCounts.set(code, (taskCounts.get(code) ?? 0) + 1);
}
const onetCodes = fs
    .readFileSync(path.join(ROOT, 'data/db_30_1_text/Occupation Data.txt'), 'utf-8')
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t')[0])
    .filter((c) => /^\d{2}-\d{4}\.\d{2}$/.test(c));

describe('which occupations are planned', () => {
    it('one row per occupation, every one of the 830, by one set of rules', () => {
        expect(Object.keys(inputs.occupations)).toHaveLength(830);
        expect(entries).toHaveLength(830);
        expect(bySoc.size).toBe(830);
    });

    it('the 60 SOCs scored before the family batches are in their own batches: 47 kelley + 13 business-finance', () => {
        expect(kelleySocs.size).toBe(47);
        expect(scored.size).toBe(60);
        for (const soc of BF_TARGET_SOCS) expect(kelleySocs.has(soc)).toBe(false);
        expect(entries.filter((e) => e.batch === 'kelley').map((e) => e.soc).sort()).toEqual([...kelleySocs].sort());
        expect(entries.filter((e) => e.batch === 'business-finance').map((e) => e.soc).sort()).toEqual([...BF_TARGET_SOCS]);
        for (const e of firstPlan) expect(scored.has(e.soc), e.soc).toBe(false);
    });

    it('the 770 rows of the first plan (2026-11-07) are byte for byte as they were, and come first', () => {
        expect(firstPlan).toHaveLength(770);
        expect(entries.slice(0, 770)).toEqual(firstPlan);
        // SHA-256 of the 770 rows exactly as committed in 0646d77..1527e09, before the kelley rows were added.
        const hash = crypto.createHash('sha256').update(firstPlan.map((r) => JSON.stringify(r, null, 2)).join('\n')).digest('hex');
        expect(hash).toBe('49ff8ad0d3205816b7b800360a78a4a289ba588e6ec025eaf058829f43d7fd19');
        for (const e of firstPlan) expect(e).not.toHaveProperty('batch');
    });

    it('830 = 783 scorable + 47 no-task; the first plan counted as the owner did; the two new batches', () => {
        expect([counts.rows, counts.scorable, counts.noTasks]).toEqual([830, 783, 47]);
        expect([1, 2, 3].map((f) => counts.byFamily[f].toDo)).toEqual([320, 71, 379]);
        expect([1, 2, 3].map((f) => counts.byFamily[f].plannable)).toEqual([301, 66, 356]);
        expect([1, 2, 3].map((f) => counts.byFamily[f].noTasks)).toEqual([19, 5, 23]);
        expect(counts.byBatch['business-finance']).toEqual({ jobs: 13, byRule: { 'own-code': 11, 'sub-codes': 1, combined: 1, 'no-tasks': 0 } });
        expect(counts.byBatch.kelley).toEqual({ jobs: 47, byRule: { 'own-code': 44, 'sub-codes': 2, combined: 1, 'no-tasks': 0 } });
        expect(counts.byRule).toEqual({ 'own-code': 748, 'sub-codes': 23, combined: 12, 'no-tasks': 47 });
    });

    it('sorts each part by family, then field, then SOC; --family takes only first-plan rows', () => {
        const key = (e: (typeof entries)[number]) => `${e.family}|${e.field}|${e.soc}`;
        for (const part of [firstPlan, entries.filter((e) => e.batch === 'business-finance'), entries.filter((e) => e.batch === 'kelley')]) {
            expect(part.map(key)).toEqual(part.map(key).sort());
        }
        expect(entries.map((e) => e.batch ?? '')).toEqual([...Array(770).fill(''), ...Array(13).fill('business-finance'), ...Array(47).fill('kelley')]);
        expect(applyFilter(entries, { family: 2 }).every((e) => e.field === '41' || e.field === '43')).toBe(true);
        // Kelley 41-xxxx SOCs are in family 2 but never in a --family 2 run.
        expect(applyFilter(entries, { family: 2 })).toHaveLength(71);
        expect(applyFilter(entries, { family: 1 })).toHaveLength(320);
        expect(applyFilter(entries, { fields: ['13'] }).every((e) => !e.batch)).toBe(true);
        expect(applyFilter(entries, { batch: 'kelley' }).map((e) => e.soc).sort()).toEqual([...kelleySocs].sort());
    });
});

describe('every published entry is its plan row', () => {
    it('each entry in ai_scores_bls.json has the promptSha256 of its plan row (736 today, 783 after --batch kelley)', () => {
        const socs = Object.keys(PUBLISHED);
        expect(socs.length).toBeGreaterThanOrEqual(736);
        for (const soc of socs) {
            const row = bySoc.get(soc)!;
            expect(row, soc).toBeDefined();
            expect(PUBLISHED[soc].promptSha256, soc).toBe(row.promptSha256);
            expect(PUBLISHED[soc].tasks.map((t) => t.taskName), soc).toEqual(row.tasks.map((t) => t.name));
        }
        // Every scorable row outside the kelley batch is published.
        for (const e of entries.filter((x) => x.taskRule !== 'no-tasks' && x.batch !== 'kelley')) expect(PUBLISHED[e.soc], e.soc).toBeDefined();
    });

    it('the business-finance rows are the 2026-11-01 plan (data/bls_scoring_plan.json), task for task', () => {
        const plans = planAll(loadPlanInputs(ROOT));
        for (const p of plans) {
            const row = bySoc.get(p.soc)!;
            expect(row.batch, p.soc).toBe('business-finance');
            expect(row.tasks, p.soc).toEqual(p.tasks);
            expect([row.employment, row.projectedGrowth, row.selectionRule], p.soc).toEqual([p.employment, p.projectedGrowth, p.rule]);
        }
    });
});

describe('the kelley batch', () => {
    const kelleyRows = entries.filter((e) => e.batch === 'kelley');

    it('plans each Kelley SOC exactly like any other job: BLS title, OEWS May 2025 employment, EP 2025-35 growth', () => {
        for (const e of kelleyRows) {
            const occ = inputs.occupations[e.soc];
            expect([e.title, e.employment, e.projectedGrowth], e.soc).toEqual([occ.title, occ.employment, occ.ep!.percentChange]);
            expect(e.tasks.length, e.soc).toBe(5);
        }
    });

    it('13-1020 (Wholesale & Retail Buyer, Purchasing Agent) is combined from 13-1021, 13-1022 and 13-1023', () => {
        expect(bySoc.get('13-1020')!.taskRule).toBe('combined');
        expect(bySoc.get('13-1020')!.onetCodes).toEqual(['13-1021.00', '13-1022.00', '13-1023.00']);
    });

    it('its five controls are published business-finance jobs whose plan prompt is the published one', async () => {
        expect(KELLEY_CONTROL_SOCS).toHaveLength(5);
        const { publishedBlsControls } = await import('../../scripts/generate_bls_scores');
        const controls = publishedBlsControls(entries, PUBLISHED as never);
        expect(controls.map((c) => c.key)).toEqual([...KELLEY_CONTROL_SOCS]);
        for (const c of controls) {
            const row = bySoc.get(c.key)!;
            expect(row.batch).toBe('business-finance');
            expect(sha256(promptFor({ ...c.job, tasks: c.job.taskNames.map((name) => ({ name })) }))).toBe(PUBLISHED[c.key].promptSha256);
            expect(c.published).toBe(PUBLISHED[c.key]);
        }
        // All three task rules and the risk range of the 13 are covered.
        expect(new Set(KELLEY_CONTROL_SOCS.map((soc) => bySoc.get(soc)!.taskRule))).toEqual(new Set(['own-code', 'sub-codes', 'combined']));
    });
});

describe('the committed plan file', () => {
    it('is exactly what --plan writes from the data', () => {
        const committed = fs.readFileSync(path.join(ROOT, PLAN_ALL_PATH), 'utf-8');
        expect(committed).toBe(JSON.stringify(planAllFile(entries, counts), null, 2) + '\n');
    });
});

describe('tasks', () => {
    it('every planned task is a verbatim row of O*NET Task Statements.txt, from a listed code', () => {
        for (const e of entries) {
            for (const t of e.tasks) {
                const cols = statementLines[t.line - 1].replace(/\r$/, '').split('\t');
                expect(cols[0], `${e.soc} line ${t.line}`).toBe(t.onetCode);
                expect(Number(cols[1])).toBe(t.taskId);
                expect(cols[2].trim()).toBe(t.name);
                expect(e.onetCodes).toContain(t.onetCode);
            }
            expect(new Set(e.tasks.map((t) => t.taskId)).size, e.soc).toBe(e.tasks.length);
        }
    });

    it('own-code jobs take their first 5 .00 tasks in O*NET file order', () => {
        for (const e of entries.filter((x) => x.taskRule === 'own-code')) {
            const fileRows = inputs.statements.get(`${e.soc}.00`)!;
            expect(e.tasks.map((t) => t.line), e.soc).toEqual(fileRows.slice(0, 5).map((r) => r.line));
        }
    });

    it('every job with tasks has 5, except Shampooers, whose O*NET list has only 4', () => {
        expect(counts.fewerThanFiveTasks).toEqual(['39-5093']);
        expect(inputs.statements.get('39-5093.00')).toHaveLength(4);
        expect(bySoc.get('39-5093')!.tasks).toHaveLength(4);
    });

    it('every prompt hash is the SHA-256 of the prompt rebuilt from the plan', () => {
        for (const e of entries.filter((x) => x.taskRule !== 'no-tasks')) {
            const prompt = promptFor(e);
            expect(e.promptLength, e.soc).toBe(prompt.length);
            expect(e.promptSha256, e.soc).toBe(sha256(prompt));
        }
    });
});

describe('the combine rule', () => {
    const COMBINED = {
        '13-1020': ['13-1021.00', '13-1022.00', '13-1023.00'],
        '13-2020': ['13-2022.00', '13-2023.00'],
        '21-1018': ['21-1011.00', '21-1014.00'],
        '25-2052': ['25-2055.00', '25-2056.00'],
        '25-9045': ['25-9042.00', '25-9043.00'],
        '29-2010': ['29-2011.00', '29-2012.00'],
        '31-1120': ['31-1121.00', '31-1122.00'],
        '39-7010': ['39-7011.00', '39-7012.00'],
        '47-4090': ['47-4091.00', '47-4099.03'],
        '51-2028': ['51-2022.00', '51-2023.00'],
        '51-2090': ['51-2092.00'],
        '53-1047': ['53-1042.00', '53-1043.00', '53-1044.00'],
    };

    it('combines exactly these jobs, from these O*NET codes, in turn', () => {
        const combined = entries.filter((e) => e.taskRule === 'combined');
        expect(Object.fromEntries(combined.map((e) => [e.soc, e.onetCodes]))).toEqual(COMBINED);
        for (const e of combined) {
            expect(inputs.occupations[e.soc].onetTaskSource, e.soc).toBe('none');
            const order = e.tasks.map((t) => t.onetCode);
            expect(order, e.soc).toEqual(order.map((_, i) => e.onetCodes[i % e.onetCodes.length]));
        }
    });

    it('takes split codes from the same BLS broad group, never codes another BLS job owns', () => {
        for (const [soc, codes] of Object.entries(ONET_CODES_FOR_SOC)) {
            for (const code of [...codes, ...(ONET_SPLIT_CODES_WITHOUT_TASKS[soc] ?? [])]) {
                expect(code.slice(0, 6), `${soc} ${code}`).toBe(soc.slice(0, 6));
                expect(inputs.occupations[code.slice(0, 7)], `${code} is a BLS job of its own`).toBeUndefined();
            }
            for (const code of codes) expect(taskCounts.get(code) ?? 0, code).toBeGreaterThan(0);
            for (const code of ONET_SPLIT_CODES_WITHOUT_TASKS[soc] ?? []) expect(taskCounts.get(code) ?? 0, code).toBe(0);
        }
    });

    it('25-9044 (Teaching Assistants, Postsecondary) is its own BLS job, so 25-9045 does not use it', () => {
        expect(inputs.occupations['25-9044']).toBeDefined();
        expect(bySoc.get('25-9045')!.onetCodes).not.toContain('25-9044.00');
    });

    it('accounts for every O*NET code with tasks that no BLS occupation owns', () => {
        const orphans = onetCodes.filter((c) => !inputs.occupations[c.slice(0, 7)] && (taskCounts.get(c) ?? 0) > 0);
        const used = new Set(Object.values(ONET_CODES_FOR_SOC).flat());
        const accounted: Record<string, string> = {
            '29-2011.01': 'sub-code of 29-2011.00, which has its own tasks',
            '29-2011.02': 'sub-code of 29-2011.00, which has its own tasks',
            '29-2011.04': 'sub-code of 29-2011.00, which has its own tasks',
            '29-2012.01': 'sub-code of 29-2012.00, which has its own tasks',
            '53-1042.01': 'sub-code of 53-1042.00, which has its own tasks',
            '11-1031.00': 'Legislators: no row in OEWS May 2025',
            '45-3031.00': 'Fishing and Hunting Workers: no row in OEWS May 2025',
        };
        const unexplained = orphans.filter((c) => !used.has(c) && !accounted[c]);
        expect(unexplained).toEqual([]);
        for (const c of Object.keys(accounted)) expect(orphans, c).toContain(c);
    });
});

describe('no-task jobs', () => {
    const noTask = entries.filter((e) => e.taskRule === 'no-tasks');

    it('are the 47 "All Other" jobs with no O*NET tasks anywhere, never sent', () => {
        expect(noTask).toHaveLength(47);
        expect(noTask.filter((e) => e.family !== 3)).toHaveLength(24);
        for (const e of noTask) {
            expect(e.title, e.soc).toMatch(/All Other/);
            expect(inputs.occupations[e.soc].onetTaskSource).toBe('none');
            expect(onetCodes.filter((c) => c.startsWith(e.soc) && (taskCounts.get(c) ?? 0) > 0), e.soc).toEqual([]);
            expect([e.tasks.length, e.promptLength, e.promptSha256]).toEqual([0, null, null]);
        }
    });
});

describe('split-code titles', () => {
    it('every title the panel shows is O*NET 30.1 Occupation Data.txt word for word, for every split code used', () => {
        const titles = new Map(
            fs.readFileSync(path.join(ROOT, 'data/db_30_1_text/Occupation Data.txt'), 'utf-8').split('\n').slice(1).map((l) => l.split('\t')).map((c) => [c[0], c[1]] as const),
        );
        expect(Object.keys(ONET_SPLIT_CODE_TITLES).sort()).toEqual([...new Set(Object.values(ONET_CODES_FOR_SOC).flat())].sort());
        for (const [code, title] of Object.entries(ONET_SPLIT_CODE_TITLES)) expect(title, code).toBe(titles.get(code));
    });
});

describe('the 13 Business & Finance prompts', () => {
    it('rebuild byte for byte: each matches its stored promptSha256', () => {
        const stored = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores_bls.json'), 'utf-8')).scores;
        const plans = planAll(loadPlanInputs(ROOT));
        expect(plans.map((p) => p.soc)).toEqual([...BF_TARGET_SOCS]);
        for (const p of plans) expect(sha256(promptFor(p)), p.soc).toBe(stored[p.soc].promptSha256);
    });
});

describe('filters', () => {
    it('parses --family and --fields, and refuses bad values', () => {
        expect(parsePlanFilter([])).toEqual({});
        expect(parsePlanFilter(['--family', '1'])).toEqual({ family: 1 });
        expect(parsePlanFilter(['--fields', '17,11,15'])).toEqual({ fields: ['11', '15', '17'] });
        expect(() => parsePlanFilter(['--family', '4'])).toThrow();
        expect(() => parsePlanFilter(['--fields', '55'])).toThrow();
        expect(() => parsePlanFilter(['--family'])).toThrow();
        expect(batchKey({ family: 1 })).toBe('family-1');
        expect(batchKey({ fields: ['11', '15'] })).toBe('fields-11,15');
    });

    it('parses --batch kelley, and refuses business-finance, other names and mixing with --family/--fields', () => {
        expect(parsePlanFilter(['--batch', 'kelley'])).toEqual({ batch: 'kelley' });
        expect(batchKey({ batch: 'kelley' })).toBe('kelley');
        expect(() => parsePlanFilter(['--batch', 'business-finance'])).toThrow(/2026-11-01/);
        expect(() => parsePlanFilter(['--batch', 'all'])).toThrow();
        expect(() => parsePlanFilter(['--batch', 'kelley', '--family', '1'])).toThrow();
        expect(() => parsePlanFilter(['--batch'])).toThrow();
    });
});

describe('--plan', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('makes zero network calls and writes the committed files byte for byte', async () => {
        const fetchStub = vi.fn(() => {
            throw new Error('network call during --plan');
        });
        vi.stubGlobal('fetch', fetchStub);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foj-plan-'));
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const { main } = await import('../../scripts/generate_bls_scores');
            await main(['--plan', '--family', '1'], { planDir: dir });
        } finally {
            log.mockRestore();
        }
        expect(fetchStub).not.toHaveBeenCalled();
        for (const f of ['bls_scoring_plan.json', 'bls_score_plan_all.json']) {
            expect(fs.readFileSync(path.join(dir, f), 'utf-8'), f).toBe(fs.readFileSync(path.join(ROOT, 'data', f), 'utf-8'));
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }, 60_000);
});
