/**
 * The Business & Finance scores (scripts/generate_bls_scores.ts →
 * src/data/ai_scores_bls.json) and everything they must leave alone.
 *
 * Always checked: the 13 targets come from the data, every task is a verbatim
 * O*NET row, the BLS inputs are the occupation's own, ai_scores.json is byte
 * for byte the published file, and the 50 Kelley roles keep their scores,
 * labels, ranks and colours.
 *
 * Checked once the scores file exists (it is written only after a real
 * claude-sonnet-5 run through the app proxy, never by hand): every score is a
 * number from 0 to 1 on the planned tasks, all 32 occupations in the field
 * resolve to a score, and no peak in the field is grey at any level. Until then
 * the "pending" block checks that those 13 are still honestly grey.
 */

import { describe, it, expect } from 'vitest';
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
    BLS_SCORES,
    BLS_SCORES_META,
    BUSINESS_FINANCE_FULLY_SCORED,
    SCORE_COVERAGE,
    compareWithKelley,
    fullyScoredFields,
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

const jobs = useStore.getState().jobs;
const kelleySocs = new Set(jobs.map((j) => MAP_TITLE_TO_SOC[j.title]));
const inputs = loadPlanInputs(ROOT);
const plans = planAll(inputs);
const planBySoc = new Map(plans.map((p) => [p.soc, p]));
const statementLines = fs.readFileSync(path.join(ROOT, TASK_STATEMENTS_PATH), 'utf-8').split('\n');
const fieldSocs = Object.keys(inputs.occupations);
const scene = buildWorldScene(jobs);
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
    it('never holds a partial set', () => {
        expect([0, BF_TARGET_SOCS.length]).toContain(BLS_SCORES.size);
        expect(PRESENT).toBe(BLS_SCORES.size > 0);
        expect(BUSINESS_FINANCE_FULLY_SCORED).toBe(PRESENT);
    });

    it('scores no occupation outside Business & Finance', () => {
        for (const soc of BLS_SCORES.keys()) expect(BF_TARGET_SOCS).toContain(soc);
        expect(fullyScoredFields().filter((c) => c !== '13')).toEqual([]);
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
        expect(BLS_SCORES_META?.model).toBe('claude-sonnet-5');
    });

    it('has all 13, each on its planned tasks, every score a number from 0 to 1', () => {
        expect(Object.keys(file.scores).sort()).toEqual([...BF_TARGET_SOCS]);
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
        expect(BLS_SCORES.size).toBe(13);
    });

    it('every one of the 32 occupations in the field resolves to a score', () => {
        for (const soc of fieldSocs) expect(kelleySocs.has(soc) || BLS_SCORES.has(soc), soc).toBe(true);
        expect(fullyScoredFields()).toEqual(['13']);
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

    it('colours a scored BLS hill from its own Automation Risk, on the Kelley scale', () => {
        const scale = buildRiskScale(jobs.map((j) => j.automationCostIndex));
        for (const p of scene.peaksByContinent.get('13')!.filter((p) => p.entry.kind === 'bls')) {
            const s = BLS_SCORES.get(p.entry.soc)!;
            expect(sameColor(p.color, riskColorRGB(normalizeRisk(s.automationCostIndex, scale)))).toBe(true);
        }
    });

    it('leaves every other field exactly as it was: no scored BLS occupation outside 13', () => {
        for (const p of scene.peaks.filter((p) => p.entry.kind === 'bls' && p.entry.continent !== '13')) {
            expect(p.entry.scored).toBe(false);
            expect(sameColor(p.color, RISK_UNSCORED_RGB)).toBe(true);
        }
    });

    it('each panel shows the published scores, rank, provenance and tasks, and no Claude feature', async () => {
        const continent = await loadContinentFile('13');
        for (const soc of BF_TARGET_SOCS) {
            const html = renderToStaticMarkup(<OccupationBody occupation={continent.occupations[soc]} onClose={() => {}} />);
            const doc = new JSDOM(`<body>${html}</body>`).window.document;
            const s = BLS_SCORES.get(soc)!;
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
            const c = compareWithKelley(BLS_SCORES.get(soc)!)!;
            expect([c.riskHigherThan, c.humanHigherThan, c.resilienceLabel], soc).toEqual(expected[soc]);
        }
    });

    it('13-1199 ties one published role at 0.77, and the tie is not counted as lower', () => {
        const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores.json'), 'utf-8')) as {
            scores: Record<string, { tasks: { humanCriticalityScore: number }[] }>;
        };
        // Whole hundredths summed as integers, so this count has no float error of its own.
        const totals = Object.values(published.scores).map((a) => a.tasks.reduce((sum, t) => sum + Math.round(t.humanCriticalityScore * 100), 0));
        const target = BLS_SCORES.get('13-1199')!.tasks.reduce((sum, t) => sum + Math.round(t.humanCriticalityScore * 100), 0);
        expect(target).toBe(385);
        expect(totals.filter((t) => t === target)).toHaveLength(1);
        expect(totals.filter((t) => t < target)).toHaveLength(45);
        expect(compareWithKelley(BLS_SCORES.get('13-1199')!)!.humanHigherThan).toBe(45);
    });

    it('wording says scores cover the 50 Kelley roles plus all of Business & Finance', () => {
        expect(SCORE_COVERAGE.short).toBe('the 50 Kelley roles plus all of Business & Finance');
    });
});
