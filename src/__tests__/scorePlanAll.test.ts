/**
 * The scoring plan for every unscored occupation (scripts/lib/scorePlanAll.ts →
 * data/bls_score_plan_all.json). No API call: --plan only reads committed files.
 *
 * Checks: the 60 scored SOCs stay out; 830 = scored + plannable + no-task; the
 * committed file is exactly what --plan writes; every task is a verbatim O*NET
 * row; the combine rule covers every O*NET code with tasks that no BLS
 * occupation owns; the 13 Business & Finance prompts rebuild to their stored
 * promptSha256; and --plan makes zero network calls.
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

const ROOT = path.resolve(__dirname, '../..');
const inputs = loadAllInputs(ROOT);
const kelleySocs = new Set(initialJobs.map((j) => MAP_TITLE_TO_SOC[j.title]));
const scored = scoredSocs(kelleySocs);
const entries = planAllFields(inputs, scored);
const counts = countPlan(entries, Object.keys(inputs.occupations).length, scored.size);
const bySoc = new Map(entries.map((e) => [e.soc, e]));
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
    it('keeps the 60 scored SOCs out: 47 Kelley + 13 Business & Finance', () => {
        expect(kelleySocs.size).toBe(47);
        expect(scored.size).toBe(60);
        for (const soc of BF_TARGET_SOCS) expect(kelleySocs.has(soc)).toBe(false);
        for (const soc of scored) {
            expect(inputs.occupations[soc], soc).toBeDefined();
            expect(bySoc.has(soc), soc).toBe(false);
        }
    });

    it('plans every other occupation exactly once', () => {
        expect(Object.keys(inputs.occupations)).toHaveLength(830);
        expect(entries).toHaveLength(770);
        expect(bySoc.size).toBe(770);
        expect(new Set([...bySoc.keys(), ...scored]).size).toBe(830);
    });

    it('830 = scored + plannable + no-task, per family as the owner counted', () => {
        expect(counts.scored + counts.plannable + counts.noTasks).toBe(830);
        expect([counts.scored, counts.plannable, counts.noTasks]).toEqual([60, 723, 47]);
        expect([1, 2, 3].map((f) => counts.byFamily[f].toDo)).toEqual([320, 71, 379]);
        expect([1, 2, 3].map((f) => counts.byFamily[f].noTasks)).toEqual([19, 5, 23]);
        expect(counts.byRule).toEqual({ 'own-code': 693, 'sub-codes': 20, combined: 10, 'no-tasks': 47 });
    });

    it('sorts by family, then field, then SOC', () => {
        const key = (e: (typeof entries)[number]) => `${e.family}|${e.field}|${e.soc}`;
        expect(entries.map(key)).toEqual(entries.map(key).sort());
        expect(applyFilter(entries, { family: 2 }).every((e) => e.field === '41' || e.field === '43')).toBe(true);
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
            '13-1021.00': 'BLS 13-1020, a Kelley SOC (already scored)',
            '13-1022.00': 'BLS 13-1020, a Kelley SOC (already scored)',
            '13-1023.00': 'BLS 13-1020, a Kelley SOC (already scored)',
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
