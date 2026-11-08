/**
 * The panel for an occupation without AI scores. Every number it shows must be
 * a published value from src/data/occupations/ (or the year/version labels
 * around them), and it must never show an AI score, real or placeholder.
 *
 * Rendered to static markup and read back with jsdom, for every occupation
 * outside the 50 Kelley roles that has no published score: once every planned
 * job is scored, only the "All Other" jobs O*NET gives no tasks (scored panels
 * are tested in blsScores.test and blsScoresSlim.test).
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Each of these renders every unscored panel; allow for a slow CI runner.
const ALL_PANELS = { timeout: 60_000 };
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { OccupationBody } from '../components/OccupationPanel';
import { RolePay } from '../components/RolePay';
import { INDEX_CONTINENTS, OCCUPATION_INDEX, loadContinentFile, type OccupationEntry } from '../utils/occupationIndex';
import { getRoleEntries } from '../utils/roles';
import { useStore } from '../store';
import { formatCount, formatGrowth, NO_TASKS_NOTE, NOT_SCORED_TITLE, WORKERS_NOTE, AI_SOON_TITLE } from '../utils/roleFormat';
import { formatAnnualWage, formatHourlyWage, WAGES_META } from '../utils/wages';
import { peakEmploymentAt } from '../components/world/worldScene';
import { YEAR_MAX, YEAR_MIN } from '../config/constants';
import nationalEmployment from '../data/national_employment.json';
import { BLS_SCORE_RISK, SCORE_COUNTS } from '../utils/blsScores';
import fs from 'fs';
import path from 'path';

const PLAN_ALL = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/bls_score_plan_all.json'), 'utf-8')) as {
    jobs: { soc: string; taskRule: string }[];
};

const byS = new Map<string, OccupationEntry>();
const unscored = getRoleEntries(useStore.getState().jobs).filter((e) => e.kind === 'bls' && !e.scored);

beforeAll(async () => {
    for (const c of INDEX_CONTINENTS) {
        const file = await loadContinentFile(c.code);
        for (const o of Object.values(file.occupations)) byS.set(o.soc, o);
    }
});

function render(o: OccupationEntry) {
    const html = renderToStaticMarkup(<OccupationBody occupation={o} onClose={() => {}} />);
    return new JSDOM(`<body>${html}</body>`).window.document;
}

/** Visible text plus every hover title and aria-label, with O*NET's own prose removed. */
function readableNumbers(doc: Document): { text: string; numbers: number[] } {
    const titles = [...doc.querySelectorAll('[title],[aria-label]')]
        .map((el) => `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`);
    doc.querySelectorAll('[data-testid="description"],[data-testid="task-text"]').forEach((el) => el.remove());
    doc.querySelectorAll('svg').forEach((el) => el.remove());
    // Text nodes joined with spaces, so adjacent elements never fuse into one number.
    const parts: string[] = [];
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '');
    const text = `${parts.join(' ')} ${titles.join(' ')}`.replace(/\s+/g, ' ');
    const numbers = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, '')));
    return { text, numbers };
}

/** Every number the panel may legitimately show for this occupation. */
function allowedNumbers(o: OccupationEntry): Set<number> {
    const allowed = new Set<number>([YEAR_MIN, YEAR_MAX, YEAR_MIN % 100, YEAR_MAX % 100, 50, 30.1, 2025]);
    // The coverage sentence's counts, all from the data (utils/blsScores scoreCounts).
    for (const v of [SCORE_COUNTS.scored, SCORE_COUNTS.total, SCORE_COUNTS.kelleySocs, SCORE_COUNTS.bls]) allowed.add(v);
    for (const part of o.soc.split('-')) allowed.add(Number(part));
    for (const v of [o.employment, o.annualMedian, o.annualMean, o.hourlyMedian, o.hourlyMean]) if (v != null) allowed.add(v);
    if (Object.values(o.topcoded).some(Boolean)) {
        allowed.add(WAGES_META.topcode.annual);
        allowed.add(WAGES_META.topcode.hourly);
    }
    if (o.ep) {
        allowed.add(o.ep.employment2025);
        allowed.add(o.ep.employment2035);
        allowed.add(Math.abs(o.ep.percentChange));
    }
    return allowed;
}

describe('unscored occupation panel: numbers', () => {
    it('covers every occupation outside the Kelley roles', () => {
        // 830 occupations, less the Kelley SOCs and every one with a published score.
        expect(unscored).toHaveLength(OCCUPATION_INDEX.occupations.length - SCORE_COUNTS.kelleySocs - BLS_SCORE_RISK.size);
        for (const e of unscored) expect(byS.has(e.soc), e.soc).toBe(true);
    });

    it('shows Art Directors exactly as published (EP workers, OEWS pay and its base)', () => {
        const o = byS.get('27-1011')!;
        const doc = render(o);
        const workers = doc.querySelector('[data-testid="workers"]')!;
        expect(workers.textContent).toBe('140,200 workers');
        expect(o.ep!.employment2025).toBe(140200);
        expect(workers.closest('button')!.getAttribute('title')).toBe('All workers in 2025, including self-employed. BLS Employment Projections.');
        const pay = doc.querySelector('[data-testid="pay-line"]')!;
        expect(pay.textContent).toContain(`${formatAnnualWage(o.annualMedian!)} median annual pay`);
        expect(pay.getAttribute('title')).toBe('Pay is from 53,070 payroll employees (BLS OEWS May 2025); self-employed are not included.');
        expect(o.employment).toBe(53070);
        expect(doc.querySelector('[data-testid="growth"]')!.textContent).toBe(formatGrowth(o.ep!.percentChange));
    });

    it('shows hourly pay only for Actors, never an annualised figure', () => {
        const o = byS.get('27-2011')!;
        expect(o.hourlyOnly).toBe(true);
        const pay = render(o).querySelector('[data-testid="pay-line"]')!;
        expect(pay.textContent).toContain(`${formatHourlyWage(o.hourlyMedian!)} median hourly pay`);
        expect(pay.textContent).toContain(`${formatHourlyWage(o.hourlyMean!)}/hr mean`);
        expect(pay.textContent).not.toMatch(/annual/);
    });

    it('shows only dataset numbers on every unscored panel', ALL_PANELS, () => {
        for (const e of unscored) {
            const o = byS.get(e.soc)!;
            const doc = render(o);
            const { text, numbers } = readableNumbers(doc);
            const allowed = allowedNumbers(o);
            for (const n of numbers) expect(allowed.has(n), `${o.soc} ${o.title}: ${n} in "${text.slice(0, 200)}"`).toBe(true);
            if (o.ep) {
                expect(text).toContain(`${formatCount(o.ep.employment2025)} workers`);
                expect(text).toContain(formatGrowth(o.ep.percentChange));
                expect(text).toContain(`${formatCount(o.ep.employment2035)} in ${YEAR_MAX}`);
            }
            expect(text).toContain(WORKERS_NOTE);
        }
    });

    it('lists each O*NET task verbatim, or says there is no list', ALL_PANELS, () => {
        let withoutTasks = 0;
        for (const e of unscored) {
            const o = byS.get(e.soc)!;
            const doc = render(o);
            const shown = [...doc.querySelectorAll('[data-testid="task-text"]')].map((el) => el.textContent);
            expect(shown).toEqual(o.tasks.map((t) => t.text));
            if (o.tasks.length === 0) {
                withoutTasks++;
                expect(doc.querySelector('[data-testid="no-tasks"]')!.textContent).toBe(NO_TASKS_NOTE);
                expect(doc.querySelector('[data-testid="task-list"]')).toBeNull();
            }
            if (o.description) expect(doc.querySelector('[data-testid="description"]')!.textContent).toBe(o.description);
        }
        // From the data: 59 occupations have no O*NET task list of their own.
        // 13-1020 is one of them but is represented by its two Kelley titles,
        // which keep their own tasks. 13-2020 and the plan's "combined" jobs
        // are scored on their split O*NET codes' tasks, so they leave this list
        // once scored (their panels are tested in blsScores.test). Every other
        // one is a planned "no-tasks" job and stays unscored.
        const counts = OCCUPATION_INDEX._meta.counts;
        const noTaskSocs = OCCUPATION_INDEX.occupations.filter((occ) => occ.taskCount === 0).map((occ) => occ.soc);
        expect(noTaskSocs).toHaveLength(counts.occupations - counts.withTasks);
        const kelleySocs = new Set(getRoleEntries(useStore.getState().jobs).filter((e) => e.kind === 'kelley').map((e) => e.soc));
        const elsewhere = noTaskSocs.filter((soc) => kelleySocs.has(soc) || BLS_SCORE_RISK.has(soc));
        const combined = PLAN_ALL.jobs.filter((j) => j.taskRule === 'combined').map((j) => j.soc);
        const planNoTasks = PLAN_ALL.jobs.filter((j) => j.taskRule === 'no-tasks').map((j) => j.soc);
        expect(combined).toHaveLength(10);
        const scoredCombined = combined.filter((soc) => BLS_SCORE_RISK.has(soc));
        expect(elsewhere).toEqual(['13-1020', ...(BLS_SCORE_RISK.has('13-2020') ? ['13-2020'] : []), ...scoredCombined].sort());
        expect(withoutTasks).toBe(noTaskSocs.length - elsewhere.length);
        // Unscored with no tasks = the plan's no-tasks jobs, plus any combined job not yet scored.
        expect(noTaskSocs.filter((soc) => !elsewhere.includes(soc)).sort()).toEqual(
            [...planNoTasks, ...combined.filter((soc) => !BLS_SCORE_RISK.has(soc))].sort(),
        );
        expect(byS.get('13-1020')!.tasks).toEqual([]);
    });
});

describe('unscored occupation panel: no AI score', () => {
    it('never renders a numeric AI score, a placeholder, or a score-based action', ALL_PANELS, () => {
        for (const e of unscored) {
            const doc = render(byS.get(e.soc)!);
            const { text } = readableNumbers(doc);
            const o = byS.get(e.soc)!;
            const soon = doc.querySelector('[data-testid="ai-soon"]')!.textContent;
            // No O*NET tasks: nothing to score, so it says "Not scored" and why.
            if (o.tasks.length === 0) {
                expect(soon, e.soc).toContain(NOT_SCORED_TITLE);
                expect(soon, e.soc).toContain('O*NET lists no tasks');
                expect(soon, e.soc).not.toContain(AI_SOON_TITLE);
            } else {
                expect(soon, e.soc).toContain(AI_SOON_TITLE);
            }
            expect(text).not.toMatch(/\d+\s*%\s*(risk|human)/i);
            expect(text).not.toMatch(/Automation Risk|Human Criticality|Human Resilience|Job Security/);
            expect(text).not.toMatch(/\bAnalyze\b|Roadmap|Scenario|Defend this task|Build on this/);
            // The one percentage on the panel is the BLS growth figure.
            expect((text.match(/%/g) ?? []).length, e.title).toBe(byS.get(e.soc)!.ep ? 1 : 0);
        }
    });
});

describe('Kelley pay line', () => {
    it('keeps its wording and names its payroll base (the whole SOC, never the 3D split)', () => {
        const doc = new JSDOM(`<body>${renderToStaticMarkup(<RolePay title="Marketing Manager" />)}</body>`).window.document;
        const pay = doc.querySelector('[data-testid="pay-line"]')!;
        const emp = (nationalEmployment as unknown as Record<string, { employment: number }>)['11-2021'].employment;
        expect(pay.getAttribute('title')).toBe(`Pay is from ${formatCount(emp)} payroll employees (BLS OEWS May 2025); self-employed are not included.`);
        expect(pay.textContent).toMatch(/median annual pay/);
    });
});

describe('3D labels', () => {
    it('show the published EP level at 2025 and 2035', () => {
        for (const e of unscored) {
            expect(peakEmploymentAt(e, YEAR_MIN)).toBe(e.ep2025);
            expect(peakEmploymentAt(e, YEAR_MAX)).toBe(e.ep2035);
        }
    });
});
