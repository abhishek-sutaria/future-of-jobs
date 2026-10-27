/**
 * The panel for an occupation without AI scores. Every number it shows must be
 * a published value from src/data/occupations/ (or the year/version labels
 * around them), and it must never show an AI score, real or placeholder.
 *
 * Rendered to static markup and read back with jsdom, for every one of the
 * 783 occupations outside the 50 Kelley roles.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Each of these renders all 783 panels; allow for a slow CI runner.
const ALL_PANELS = { timeout: 60_000 };
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { OccupationBody } from '../components/OccupationPanel';
import { RolePay } from '../components/RolePay';
import { INDEX_CONTINENTS, loadContinentFile, type OccupationEntry } from '../utils/occupationIndex';
import { getRoleEntries } from '../utils/roles';
import { useStore } from '../store';
import { formatCount, formatGrowth, NO_TASKS_NOTE, WORKERS_NOTE, AI_SOON_TITLE } from '../utils/roleFormat';
import { formatAnnualWage, formatHourlyWage, WAGES_META } from '../utils/wages';
import { peakEmploymentAt } from '../components/world/worldScene';
import { YEAR_MAX, YEAR_MIN } from '../config/constants';
import nationalEmployment from '../data/national_employment.json';

const byS = new Map<string, OccupationEntry>();
const unscored = getRoleEntries(useStore.getState().jobs).filter((e) => e.kind === 'bls');

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
        expect(unscored).toHaveLength(783);
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

    it('shows only dataset numbers on every one of the 783 panels', ALL_PANELS, () => {
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
        // 59 occupations have no O*NET tasks; 13-1020 is one of them but is
        // represented by its two Kelley titles, which keep their own tasks.
        expect(withoutTasks).toBe(58);
        expect(byS.get('13-1020')!.tasks).toEqual([]);
    });
});

describe('unscored occupation panel: no AI score', () => {
    it('never renders a numeric AI score, a placeholder, or a score-based action', ALL_PANELS, () => {
        for (const e of unscored) {
            const doc = render(byS.get(e.soc)!);
            const { text } = readableNumbers(doc);
            expect(doc.querySelector('[data-testid="ai-soon"]')!.textContent).toContain(AI_SOON_TITLE);
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
