/**
 * The published BLS scores (scripts/generate_bls_scores.ts →
 * src/data/ai_scores_bls.json): the 13 Business & Finance occupations scored
 * first, then every job in data/bls_score_plan_all.json that has O*NET tasks,
 * and everything they must leave alone.
 *
 * Always checked: the 13 targets come from the data, every task is a verbatim
 * O*NET row, the BLS inputs are the occupation's own, ai_scores.json is byte
 * for byte the published file, and the 50 Kelley roles keep their scores,
 * labels, ranks and colours.
 *
 * Checked once the scores file exists (it is written only after a real
 * claude-sonnet-5 run, never by hand): every planned job with tasks has a
 * score on exactly its planned tasks, the 47 no-task jobs have none, the 13
 * Business & Finance entries are unchanged, every score is a number from 0 to
 * 1, and unscored peaks stay grey. Until then the "pending" block checks that
 * those 13 are still honestly grey.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { useStore } from '../store';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { buildWorldScene } from '../components/world/worldScene';
import { buildStage } from '../utils/stageLayout';
import { familyOf } from '../config/socFamilies';
import { buildRiskScale, normalizeRisk, riskColorRGB, RISK_UNSCORED_RGB } from '../config/theme';
import { OccupationBody } from '../components/OccupationPanel';
import { loadContinentFile } from '../utils/occupationIndex';
import {
    BLS_SCORE_RISK,
    BLS_SCORES_META,
    SCORE_COUNTS,
    SCORE_COVERAGE,
    blsScoreFor,
    compareWithKelley,
    fullyScoredFields,
    loadAllBlsScores,
    parseBlsScores,
} from '../utils/blsScores';
import {
    BF_TARGET_SOCS,
    CONTROL_JOB_IDS,
    GROWTH_MISMATCH_NOTE,
    TASKS_PER_ROLE,
    TASK_STATEMENTS_PATH,
    loadPlanInputs,
    planAll,
    uncoveredBusinessFinanceSocs,
    type RolePlan,
} from '../../scripts/lib/blsTasks';
import kelley50 from './fixtures/kelley50_published.json';

const ROOT = path.resolve(__dirname, '../..');
const SCORES_PATH = path.join(ROOT, 'src/data/ai_scores_bls.json');
const PRESENT = fs.existsSync(SCORES_PATH);

/** SHA-256 of src/data/ai_scores.json as published (commit 0c1918d). */
const PUBLISHED_SHA256 = 'df8d9f41388c625576cd9afd66af2c85befb7fcfe7c12d9d89babe05abffadc4';

/**
 * SHA-256 of the 13 Business & Finance entries as scored on 2026-11-01
 * (JSON.stringify of [soc, entry] pairs in SOC order, file at commit 0ffdb7a).
 */
const BF_ENTRIES_SHA256 = '545be8cc011b20a56fef3eff80cc63b84cc8aca83bb69ea2715780d5c6621bb7';

interface PlanAllJob {
    soc: string;
    field: string;
    taskRule: 'own-code' | 'sub-codes' | 'combined' | 'no-tasks';
    selectionRule?: string;
    onetCodes: string[];
    employment: number;
    projectedGrowth: number;
    promptSha256?: string;
    tasks: { name: string; onetCode: string; taskId: number }[];
}
const PLAN_ALL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/bls_score_plan_all.json'), 'utf-8')) as { jobs: PlanAllJob[] };
const PLANNED = PLAN_ALL.jobs.filter((j) => j.taskRule !== 'no-tasks');
const NO_TASK_JOBS = PLAN_ALL.jobs.filter((j) => j.taskRule === 'no-tasks');
/** Every SOC that should carry a published BLS score: the 13, then every planned job with tasks. */
const EXPECTED_SCORED = [...BF_TARGET_SOCS, ...PLANNED.map((j) => j.soc)].sort();

const jobs = useStore.getState().jobs;
const kelleySocs = new Set(jobs.map((j) => MAP_TITLE_TO_SOC[j.title]));
const inputs = loadPlanInputs(ROOT);
const plans = planAll(inputs);
const planBySoc = new Map(plans.map((p) => [p.soc, p]));
const statementLines = fs.readFileSync(path.join(ROOT, TASK_STATEMENTS_PATH), 'utf-8').split('\n');
const fieldSocs = Object.keys(inputs.occupations);
const scene = buildWorldScene(jobs);
const OCCUPATION_INDEX_COUNT = new Set(scene.peaks.map((p) => p.entry.soc)).size;
const sameColor = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

describe('the 13 Business & Finance targets', () => {
    it('are exactly the field occupations no Kelley role covers', () => {
        expect(fieldSocs).toHaveLength(32);
        expect(uncoveredBusinessFinanceSocs(inputs.occupations, kelleySocs)).toEqual([...BF_TARGET_SOCS]);
        expect(fieldSocs.filter((s) => kelleySocs.has(s))).toHaveLength(19);
    });

    it('match the committed plan, which the scoring run also checks', () => {
        const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/bls_scoring_plan.json'), 'utf-8'));
        expect(committed.roles).toEqual(plans);
        expect(committed._meta.growthNote).toBe(GROWTH_MISMATCH_NOTE);
    });

    it('each has 5 tasks, every one a verbatim row of O*NET Task Statements.txt', () => {
        for (const plan of plans) {
            expect(plan.tasks, plan.soc).toHaveLength(TASKS_PER_ROLE);
            expect(new Set(plan.tasks.map((t) => t.taskId)).size, plan.soc).toBe(TASKS_PER_ROLE);
            for (const t of plan.tasks) {
                const cols = statementLines[t.line - 1].replace(/\r$/, '').split('\t');
                expect(cols[0], `${plan.soc} line ${t.line}`).toBe(t.onetCode);
                expect(Number(cols[1])).toBe(t.taskId);
                expect(cols[2].trim()).toBe(t.name);
                expect(cols[3]).toBe(t.type);
                expect(plan.onetCodes).toContain(t.onetCode);
            }
        }
    });

    it('takes the first 5 own tasks in O*NET order where the occupation has a .00 list', () => {
        for (const plan of plans.filter((p) => p.rule === 'first-5-onet-order')) {
            const own = inputs.occupations[plan.soc].tasks.filter((t) => t.onetCode === `${plan.soc}.00`);
            expect(plan.tasks.map((t) => t.taskId), plan.soc).toEqual(own.slice(0, 5).map((t) => t.id));
        }
        expect(plans.filter((p) => p.rule === 'first-5-onet-order')).toHaveLength(11);
    });

    it('takes 13-1199 in turn across its four sub-codes', () => {
        const p = planBySoc.get('13-1199')!;
        expect(p.rule).toBe('round-robin-sub-codes');
        expect(p.tasks.map((t) => t.onetCode)).toEqual(['13-1199.04', '13-1199.05', '13-1199.06', '13-1199.07', '13-1199.04']);
        for (const code of p.onetCodes) {
            const first = inputs.occupations['13-1199'].tasks.filter((t) => t.onetCode === code).map((t) => t.id);
            const taken = p.tasks.filter((t) => t.onetCode === code).map((t) => t.taskId);
            expect(taken).toEqual(first.slice(0, taken.length));
        }
    });

    it('takes 13-2020 from the real rows of O*NET 13-2022.00 and 13-2023.00, in turn', () => {
        const p = planBySoc.get('13-2020')!;
        expect(inputs.occupations['13-2020'].onetTaskSource).toBe('none');
        expect(p.rule).toBe('round-robin-onet-codes');
        expect(p.onetCodes).toEqual(['13-2022.00', '13-2023.00']);
        expect(p.tasks.map((t) => t.onetCode)).toEqual(['13-2022.00', '13-2023.00', '13-2022.00', '13-2023.00', '13-2022.00']);
        for (const code of p.onetCodes) {
            const fileRows = statementLines.map((l, i) => ({ cols: l.split('\t'), line: i + 1 })).filter((r) => r.cols[0] === code);
            const taken = p.tasks.filter((t) => t.onetCode === code);
            expect(taken.map((t) => t.line)).toEqual(fileRows.slice(0, taken.length).map((r) => r.line));
        }
    });

    it("uses each occupation's own BLS figures as the prompt inputs", () => {
        for (const plan of plans) {
            const occ = inputs.occupations[plan.soc];
            expect(plan.employment, plan.soc).toBe(occ.employment);
            expect(plan.projectedGrowth, plan.soc).toBe(occ.ep!.percentChange);
            expect(Number.isFinite(plan.projectedGrowth)).toBe(true);
        }
    });

    it('control roles are published Business & Finance Kelley roles', () => {
        for (const id of CONTROL_JOB_IDS) {
            const job = jobs.find((j) => j.id === id)!;
            expect(MAP_TITLE_TO_SOC[job.title].startsWith('13-'), job.title).toBe(true);
        }
    });
});

describe('the 50 published Kelley roles do not change', () => {
    it('src/data/ai_scores.json is byte-identical to the published file', () => {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores.json'))).digest('hex');
        expect(hash).toBe(PUBLISHED_SHA256);
    });

    it('scores, labels and ranks match the published set exactly', () => {
        expect(jobs).toHaveLength(50);
        const now = jobs.map((j) => ({
            id: j.id,
            title: j.title,
            automationCostIndex: j.automationCostIndex,
            humanCriticality: Number((j.tasks.reduce((s, t) => s + t.humanCriticalityScore, 0) / j.tasks.length).toFixed(6)),
            humanResilienceLabel: j.humanResilienceLabel,
            salaryVolatilityLabel: j.salaryVolatilityLabel,
        }));
        expect(now).toEqual(kelley50.roles);
        const byRisk = [...now].sort((a, b) => b.automationCostIndex - a.automationCostIndex || a.id.localeCompare(b.id)).map((r) => r.id);
        const byHuman = [...now].sort((a, b) => b.humanCriticality - a.humanCriticality || a.id.localeCompare(b.id)).map((r) => r.id);
        expect(byRisk).toEqual(kelley50.riskOrder);
        expect(byHuman).toEqual(kelley50.humanOrder);
    });

    it('none of the 13 joins the jobs list or the Kelley filter', () => {
        for (const soc of BF_TARGET_SOCS) expect(kelleySocs.has(soc), soc).toBe(false);
        for (const p of scene.peaks.filter((p) => BF_TARGET_SOCS.includes(p.entry.soc as never))) {
            expect(p.entry.kind).toBe('bls');
            expect(p.job).toBeNull();
        }
    });

    it('Kelley hills keep their colour, on a scale set by the 50 alone', () => {
        const scale = buildRiskScale(jobs.map((j) => j.automationCostIndex));
        for (const p of scene.peaks.filter((p) => p.entry.kind === 'kelley')) {
            expect(sameColor(p.color, riskColorRGB(normalizeRisk(p.job!.automationCostIndex, scale))), p.entry.title).toBe(true);
        }
    });
});

describe('parseBlsScores', () => {
    const base = { version: 5, model: 'claude-sonnet-5', generatedAt: '2026-01-01T00:00:00Z' };
    const task = (ai: number, human: number) => ({ taskName: 'FIXTURE task', aiCapabilityScore: ai, humanCriticalityScore: human, onetCode: '99-0001.00', taskId: 1 });

    it('drops entries with a score outside 0 to 1, a missing number or no tasks', () => {
        const { scores } = parseBlsScores({
            ...base,
            scores: {
                'fixture-ok': { title: 'FIXTURE', scoredAt: base.generatedAt, tasks: [task(0.2, 0.6), task(0.4, 0.8)] },
                'fixture-high': { title: 'FIXTURE', scoredAt: base.generatedAt, tasks: [task(1.2, 0.5)] },
                'fixture-nan': { title: 'FIXTURE', scoredAt: base.generatedAt, tasks: [{ taskName: 'FIXTURE task' }] },
                'fixture-empty': { title: 'FIXTURE', scoredAt: base.generatedAt, tasks: [] },
            },
        });
        expect([...scores.keys()]).toEqual(['fixture-ok']);
        expect(scores.get('fixture-ok')!.automationCostIndex).toBe(0.3);
        expect(scores.get('fixture-ok')!.humanCriticality).toBeCloseTo(0.7, 9);
    });

    it('ignores a file from another schema version or with no model', () => {
        expect(parseBlsScores({ ...base, version: 4, scores: {} }).meta).toBeNull();
        expect(parseBlsScores({ version: 5, scores: {} }).meta).toBeNull();
        expect(parseBlsScores(null).scores.size).toBe(0);
    });
});

describe('scores file: either absent or complete', () => {
    it('never holds a partial set: nothing, or the 13 plus every planned job with tasks', () => {
        expect([0, EXPECTED_SCORED.length]).toContain(BLS_SCORE_RISK.size);
        expect(PRESENT).toBe(BLS_SCORE_RISK.size > 0);
        if (PRESENT) expect([...BLS_SCORE_RISK.keys()].sort()).toEqual(EXPECTED_SCORED);
        expect(BLS_SCORES_META?.count ?? 0).toBe(BLS_SCORE_RISK.size);
    });

    it('scores no Kelley SOC, no job outside the plan and none of the no-task jobs', () => {
        const allowed = new Set(EXPECTED_SCORED);
        for (const soc of BLS_SCORE_RISK.keys()) {
            expect(allowed.has(soc), soc).toBe(true);
            expect(kelleySocs.has(soc), soc).toBe(false);
        }
        expect(NO_TASK_JOBS).toHaveLength(47);
        for (const j of NO_TASK_JOBS) expect(BLS_SCORE_RISK.has(j.soc), j.soc).toBe(false);
        // A field is fully scored exactly when none of its jobs is a no-task job.
        const noTaskFields = new Set(NO_TASK_JOBS.map((j) => j.field));
        const expectedFull = PRESENT ? [...new Set(scene.peaks.map((p) => p.entry.continent))].filter((c) => !noTaskFields.has(c)).sort() : [];
        expect(fullyScoredFields().sort()).toEqual(expectedFull);
    });
});

describe.runIf(!PRESENT)('before the scoring run (no ai_scores_bls.json yet)', () => {
    it('leaves the 13 grey and says scores cover the 50 Kelley roles only', () => {
        const field = scene.peaksByContinent.get('13')!;
        const grey = field.filter((p) => sameColor(p.color, RISK_UNSCORED_RGB));
        expect(grey.map((p) => p.entry.soc).sort()).toEqual([...BF_TARGET_SOCS]);
        expect(SCORE_COVERAGE.short).toBe('the 50 Kelley roles');
    });
});

/** Buttons, links and headings that name a Claude feature (task text excluded). */
function claudeControls(doc: Document): string[] {
    const features = /analy[sz]e|strategic insight|roadmap|scenario|defend this task|build on this|likely replacements|ask claude|try again/i;
    return [...doc.querySelectorAll('button, a, [role="button"], h2, h3, h4')]
        .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.textContent ?? ''}`.trim())
        .filter((label) => features.test(label));
}

describe('claudeControls', () => {
    it('finds a Claude control but not O*NET task text that starts with "Analyze"', () => {
        const doc = new JSDOM('<body><p data-testid="bls-task-name">Analyze information gathered by investigation.</p><button>Analyze</button><h3>Strategic Insight</h3></body>').window.document;
        expect(claudeControls(doc)).toEqual(['Analyze', 'Strategic Insight']);
        doc.querySelector('button')!.remove();
        doc.querySelector('h3')!.remove();
        expect(claudeControls(doc)).toEqual([]);
    });
});

describe.runIf(PRESENT)('after the scoring run (ai_scores_bls.json)', () => {
    const file = PRESENT ? JSON.parse(fs.readFileSync(SCORES_PATH, 'utf-8')) : null;
    const isSonnet5 = (m: string) => m === 'claude-sonnet-5' || /^claude-sonnet-5-\d{8}$/.test(m);

    it('records model, date, prompt version, inputs and task source', () => {
        expect(file.version).toBe(5);
        expect(file.model).toBe('claude-sonnet-5');
        expect(file.thinking).toBe('disabled');
        expect(file.maxTokens).toBe(4096);
        expect(file.tasksPerRole).toBe(5);
        expect(Number.isNaN(Date.parse(file.generatedAt))).toBe(false);
        expect(file.promptVersion).toContain('buildJobAnalysisPrompt');
        expect(file.taskSource).toContain('O*NET');
        expect(file.inputs.growthNote).toBe(GROWTH_MISMATCH_NOTE);
        expect(file.controlRun.passed).toBe(true);
        expect(file.controlRun.meanAbsGapRiskPoints).toBeLessThanOrEqual(5);
        expect(file.controlRun.meanAbsGapHumanPoints).toBeLessThanOrEqual(5);
        for (const [batch, run] of Object.entries(file.controlRuns as Record<string, { passed: boolean; meanAbsGapRiskPoints: number; meanAbsGapHumanPoints: number; limitPoints: number }>)) {
            expect(run.passed, batch).toBe(true);
            expect(run.meanAbsGapRiskPoints, batch).toBeLessThanOrEqual(run.limitPoints);
            expect(run.meanAbsGapHumanPoints, batch).toBeLessThanOrEqual(run.limitPoints);
        }
        expect(Object.keys(file.controlRuns).sort()).toEqual(['family-1', 'family-2', 'family-3']);
        expect(BLS_SCORES_META?.model).toBe('claude-sonnet-5');
        // The file date is the latest run, never before its last score.
        expect(Date.parse(file.generatedAt)).toBeGreaterThanOrEqual(Date.parse(BLS_SCORES_META!.lastScoredAt!));
    });

    beforeAll(() => loadAllBlsScores());

    it('keeps the 13 Business & Finance entries exactly as scored on 2026-11-01', () => {
        const pairs = [...BF_TARGET_SOCS].sort().map((soc) => [soc, file.scores[soc]]);
        expect(crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex')).toBe(BF_ENTRIES_SHA256);
    });

    it('scores every planned job with tasks on exactly its planned tasks and inputs', () => {
        expect(Object.keys(file.scores).sort()).toEqual(EXPECTED_SCORED);
        for (const job of PLANNED) {
            const entry = file.scores[job.soc];
            expect(isSonnet5(entry.responseModel), job.soc).toBe(true);
            expect(entry.rule, job.soc).toBe(job.selectionRule);
            expect(entry.onetCodes, job.soc).toEqual(job.onetCodes);
            expect(entry.employment, job.soc).toBe(job.employment);
            expect(entry.projectedGrowth, job.soc).toBe(job.projectedGrowth);
            expect(entry.promptSha256, job.soc).toBe(job.promptSha256);
            expect(entry.tasks.map((t: { taskName: string; onetCode: string; taskId: number }) => [t.taskName, t.onetCode, t.taskId]), job.soc)
                .toEqual(job.tasks.map((t) => [t.name, t.onetCode, t.taskId]));
        }
    });

    it('every score in the file is a number from 0 to 1, and the app drops none', () => {
        for (const [soc, entry] of Object.entries(file.scores as Record<string, { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] }>)) {
            expect(entry.tasks.length, soc).toBeGreaterThan(0);
            for (const t of entry.tasks) {
                for (const v of [t.aiCapabilityScore, t.humanCriticalityScore]) {
                    expect(typeof v, soc).toBe('number');
                    expect(v, soc).toBeGreaterThanOrEqual(0);
                    expect(v, soc).toBeLessThanOrEqual(1);
                }
            }
            expect(blsScoreFor(soc), soc).toBeDefined();
        }
        expect(BLS_SCORE_RISK.size).toBe(Object.keys(file.scores).length);
    });

    it('has all 13, each on its planned tasks, every score a number from 0 to 1', () => {
        for (const soc of BF_TARGET_SOCS) {
            const entry = file.scores[soc];
            const plan = planBySoc.get(soc) as RolePlan;
            expect(isSonnet5(entry.responseModel), soc).toBe(true);
            expect(entry.employment).toBe(plan.employment);
            expect(entry.projectedGrowth).toBe(plan.projectedGrowth);
            expect(entry.onetCodes).toEqual(plan.onetCodes);
            expect(entry.tasks.map((t: { taskName: string }) => t.taskName), soc).toEqual(plan.tasks.map((t) => t.name));
            expect(entry.tasks.map((t: { taskId: number }) => t.taskId)).toEqual(plan.tasks.map((t) => t.taskId));
            for (const t of entry.tasks) {
                for (const v of [t.aiCapabilityScore, t.humanCriticalityScore]) {
                    expect(typeof v).toBe('number');
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                }
            }
        }
        for (const soc of BF_TARGET_SOCS) expect(BLS_SCORE_RISK.has(soc), soc).toBe(true);
    });

    it('every one of the 32 occupations in the field resolves to a score', () => {
        for (const soc of fieldSocs) expect(kelleySocs.has(soc) || BLS_SCORE_RISK.has(soc), soc).toBe(true);
        expect(fullyScoredFields()).toContain('13');
    });

    it('no peak in the field is grey: world, Management family, or the field', () => {
        const world = scene.peaksByContinent.get('13')!;
        expect(world).toHaveLength(33); // 32 SOCs, Buyer / Purchasing Agent share 13-1020
        for (const p of world) {
            expect(p.entry.scored, p.entry.title).toBe(true);
            expect(sameColor(p.color, RISK_UNSCORED_RGB), p.entry.title).toBe(false);
        }
        const field = buildStage({ focusedFamily: familyOf('13').id, focusedContinent: '13' }, scene)!;
        const family = buildStage({ focusedFamily: familyOf('13').id, focusedContinent: null }, scene)!;
        for (const stage of [field, family]) {
            const jobsHere = stage.jobs.filter((j) => j.code === '13');
            expect(jobsHere).toHaveLength(33);
            for (const j of jobsHere) expect(sameColor(j.color, RISK_UNSCORED_RGB), j.key).toBe(false);
        }
    });

    it('colours every scored BLS hill from its own Automation Risk, on the Kelley scale', () => {
        const scale = buildRiskScale(jobs.map((j) => j.automationCostIndex));
        const bls = scene.peaks.filter((p) => p.entry.kind === 'bls' && p.entry.scored);
        expect(bls).toHaveLength(EXPECTED_SCORED.length);
        for (const p of bls) {
            const risk = BLS_SCORE_RISK.get(p.entry.soc)!;
            expect(risk, p.entry.soc).toBe(blsScoreFor(p.entry.soc)!.automationCostIndex);
            expect(sameColor(p.color, riskColorRGB(normalizeRisk(risk, scale))), p.entry.soc).toBe(true);
        }
    });

    it('keeps every unscored field the grey: exactly the 47 no-task jobs, at the world and in every field', () => {
        const grey = scene.peaks.filter((p) => p.entry.kind === 'bls' && !p.entry.scored);
        expect(grey.map((p) => p.entry.soc).sort()).toEqual(NO_TASK_JOBS.map((j) => j.soc).sort());
        for (const p of scene.peaks) {
            expect(sameColor(p.color, RISK_UNSCORED_RGB), p.entry.title).toBe(!p.entry.scored);
        }
        for (const code of new Set(NO_TASK_JOBS.map((j) => j.field))) {
            const stage = buildStage({ focusedFamily: familyOf(code).id, focusedContinent: code }, scene)!;
            for (const j of stage.jobs) {
                const peak = scene.peaks.find((p) => p.entry.key === j.key)!;
                expect(sameColor(j.color, RISK_UNSCORED_RGB), j.key).toBe(!peak.entry.scored);
            }
        }
    });

    it('each panel shows the published scores, rank, provenance and tasks, and no Claude feature', async () => {
        const continent = await loadContinentFile('13');
        for (const soc of BF_TARGET_SOCS) {
            const html = renderToStaticMarkup(<OccupationBody occupation={continent.occupations[soc]} onClose={() => {}} />);
            const doc = new JSDOM(`<body>${html}</body>`).window.document;
            const s = blsScoreFor(soc)!;
            expect(doc.querySelector('[data-testid="ai-soon"]'), soc).toBeNull();
            expect(doc.querySelector('[data-testid="bls-risk"]')!.textContent).toContain(`${(s.automationCostIndex * 100).toFixed(0)}%`);
            expect(doc.querySelector('[data-testid="bls-human"]')!.textContent).toContain('Human Criticality');
            expect(doc.querySelector('[data-testid="bls-rank"]')!.textContent).toContain('50 Kelley roles');
            expect(doc.querySelector('[data-testid="bls-provenance"]')!.textContent).toContain('claude-sonnet-5');
            expect([...doc.querySelectorAll('[data-testid="bls-task-name"]')].map((n) => n.textContent).sort())
                .toEqual(planBySoc.get(soc)!.tasks.map((t) => t.name).sort());
            // Controls only: O*NET task text can itself start with "Analyze"
            // (13-1031), so the check is on buttons, links and headings.
            expect(claudeControls(doc), soc).toEqual([]);
            const c = compareWithKelley(s)!;
            expect(c.total).toBe(50);
            expect(doc.querySelector('[data-testid="bls-rank"]')!.textContent).toContain(`human judgment is higher than ${c.humanHigherThan} of them`);
        }
    });

    it('places all 13 among the 50, with human scores compared at a fixed precision', () => {
        const expected: Record<string, [risk: number, human: number, label: string]> = {
            '13-1011': [10, 9, 'At Risk'],
            '13-1031': [44, 3, 'At Risk'],
            '13-1032': [30, 12, 'At Risk'],
            '13-1041': [26, 30, 'High'],
            '13-1074': [1, 38, 'Future-Proof'],
            '13-1075': [3, 47, 'Future-Proof'],
            '13-1131': [11, 30, 'High'],
            '13-1199': [4, 45, 'Future-Proof'],
            '13-2020': [26, 12, 'High'],
            '13-2061': [3, 47, 'Future-Proof'],
            '13-2071': [45, 6, 'At Risk'],
            '13-2081': [48, 0, 'At Risk'],
            '13-2082': [47, 6, 'At Risk'],
        };
        for (const soc of BF_TARGET_SOCS) {
            const c = compareWithKelley(blsScoreFor(soc)!)!;
            expect([c.riskHigherThan, c.humanHigherThan, c.resilienceLabel], soc).toEqual(expected[soc]);
        }
    });

    it('13-1199 ties one published role at 0.77, and the tie is not counted as lower', () => {
        const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores.json'), 'utf-8')) as {
            scores: Record<string, { tasks: { humanCriticalityScore: number }[] }>;
        };
        // Whole hundredths summed as integers, so this count has no float error of its own.
        const totals = Object.values(published.scores).map((a) => a.tasks.reduce((sum, t) => sum + Math.round(t.humanCriticalityScore * 100), 0));
        const target = blsScoreFor('13-1199')!.tasks.reduce((sum, t) => sum + Math.round(t.humanCriticalityScore * 100), 0);
        expect(target).toBe(385);
        expect(totals.filter((t) => t === target)).toHaveLength(1);
        expect(totals.filter((t) => t < target)).toHaveLength(45);
        expect(compareWithKelley(blsScoreFor('13-1199')!)!.humanHigherThan).toBe(45);
    });

    it('wording gives the counts from the data and says why the rest are not scored', () => {
        expect(SCORE_COUNTS.total).toBe(OCCUPATION_INDEX_COUNT);
        expect(SCORE_COUNTS.kelleySocs).toBe(kelleySocs.size);
        expect(SCORE_COUNTS.bls).toBe(EXPECTED_SCORED.length);
        expect(SCORE_COUNTS.scored).toBe(kelleySocs.size + EXPECTED_SCORED.length);
        expect(SCORE_COUNTS.unscored).toBe(NO_TASK_JOBS.length);
        expect(SCORE_COUNTS.unscoredNoTasks).toBe(NO_TASK_JOBS.length);
        expect(SCORE_COUNTS.unscoredAllOther).toBe(NO_TASK_JOBS.length);
        expect(SCORE_COVERAGE.short).toBe(`${SCORE_COUNTS.scored} of ${SCORE_COUNTS.total} occupations`);
        expect(SCORE_COVERAGE.unscoredReason).toBe(`The other ${NO_TASK_JOBS.length} are “All Other” groups for which O*NET lists no tasks, so they are not scored.`);
    });
});
