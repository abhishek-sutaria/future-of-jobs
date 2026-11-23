// @vitest-environment jsdom
/**
 * The Career Paths screen (components/careerPaths), rendered for real:
 *   - its cards and arrows are exactly getCareerPaths(soc): same targets, same
 *     order, same directions, on the desktop lanes and the stacked phone
 *     layout, before and after "Show 10 more" (Accountants and Auditors,
 *     Registered Nurses, Electricians);
 *   - it never calls /api/claude (fetch is spied on through every action);
 *   - a missing wage says "no data", a mixed Job Zone goes under "Level not
 *     available", a job with no links says so and draws no arrow;
 *   - the trail walks and walks back; Esc closes it (a role panel underneath
 *     never sees the key) and focus returns to the button that opened it;
 *   - the header button is there on desktop and on a phone, and the panels'
 *     "Career paths" button opens the view on that job;
 *   - the honest labels: title, subtitle, the source line and O*NET's credit
 *     line word for word.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import CareerPathsView from '../components/careerPaths/CareerPathsView';
import { CareerPathsHost } from '../components/careerPaths/CareerPathsHost';
import { OpenCareerPathsButton } from '../components/careerPaths/OpenCareerPathsButton';
import { useWorldStore } from '../worldStore';
import { useStore } from '../store';
import { aiExposureFor, CAREER_PATHS_SOURCE, getCareerPaths, payChangeFor } from '../utils/careerPaths';
import { roleScaleFor } from '../utils/allRoleScale';
import { INDEX_OCCUPATION_BY_SOC } from '../utils/occupationIndex';
import {
    CAREER_PATHS_SOURCE_LINE,
    CAREER_PATHS_SUBTITLE,
    CAREER_PATHS_TITLE,
    cardFor,
    DEFAULT_SHOWN,
    groupOf,
    NO_RELATED_TEXT,
    payChangeExact,
    SHOW_MORE_STEP,
    type CareerGroupId,
} from '../utils/careerPathsView';
import { RISK_UNSCORED_HEX } from '../config/theme';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DESKTOP = 1376; // a 1440 window's content width
const PHONE = 358; // a 390 phone's content width
let root: Root;
let container: HTMLDivElement;
let fetchSpy: ReturnType<typeof vi.fn>;
let phone = false;

const q = <T extends Element = HTMLElement>(sel: string) => container.ownerDocument.querySelector<T & HTMLElement>(sel);
const qa = (sel: string) => [...container.ownerDocument.querySelectorAll<HTMLElement>(sel)];
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function until(cond: () => unknown, what: string) {
    for (let i = 0; i < 200; i++) {
        if (cond()) return;
        await tick();
    }
    throw new Error(`timed out waiting for ${what}`);
}
const loaded = () => until(() => q('[data-testid="career-count"]') || q('[data-testid="career-no-links"]'), 'the related jobs');
const centreSoc = () => q('[data-testid="career-centre"]')?.getAttribute('data-soc');
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });

async function openOn(soc: string, width: number) {
    useWorldStore.setState({ careerPathsOpen: true, careerTrail: [soc], careerRoleKey: null });
    await act(async () => root.render(<CareerPathsView layoutWidth={width} />));
    await loaded();
}

beforeAll(() => {
    window.matchMedia = ((query: string) => ({
        matches: query.includes('prefers-reduced-motion') ? true : query.includes('max-width: 767px') ? phone : false,
        media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
    phone = false;
    fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    useStore.getState().setSelectedJob(null);
    useWorldStore.setState({ careerPathsOpen: false, careerTrail: [], careerRoleKey: null, selectedOccupationSoc: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

/** The rendered cards (and on desktop the arrows) against the stored links, link by link. */
async function expectExactlyTheData(soc: string, shown: number, layout: 'desktop' | 'stacked') {
    const cp = (await getCareerPaths(soc))!;
    const want = cp.links.slice(0, shown);
    expect(q('[data-career-paths]')!.getAttribute('data-layout')).toBe(layout);
    expect(centreSoc()).toBe(soc);
    const cards = qa('[data-career-card]');
    expect(cards.map((c) => c.dataset.careerCard).sort()).toEqual(want.map((l) => l.to).sort());
    for (const c of cards) expect(c.dataset.group).toBe(groupOf(want.find((l) => l.to === c.dataset.careerCard)!));
    // Each group is a list, in O*NET's order; the lists come in the layout's order.
    const order: CareerGroupId[] = layout === 'desktop' ? ['down', 'same', 'up', 'none'] : ['up', 'same', 'down', 'none'];
    for (const g of order) {
        const inList = qa(`[data-career-list="${g}"] [data-career-card]`).map((c) => c.dataset.careerCard);
        expect(inList, `${soc} ${g}`).toEqual(want.filter((l) => groupOf(l) === g).map((l) => l.to));
    }
    const listOrder = qa('[data-career-list]').map((l) => l.dataset.careerList);
    expect(listOrder).toEqual(order.filter((g) => want.some((l) => groupOf(l) === g)));
    if (layout === 'desktop') {
        const arrows = qa('[data-career-arrow]');
        expect(arrows.map((a) => a.dataset.careerArrow).sort()).toEqual(want.map((l) => l.to).sort());
        for (const a of arrows) expect(a.dataset.group).toBe(groupOf(want.find((l) => l.to === a.dataset.careerArrow)!));
    } else {
        expect(qa('[data-career-arrow]')).toHaveLength(0);
    }
    expect(q('[data-testid="career-count"]')!.textContent).toBe(`Showing ${want.length} of ${cp.links.length} related jobs, most related first (O*NET's order).`);
}

const noClaude = () => {
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/api/claude'))).toEqual([]);
    expect(urls).toEqual([]);
};

describe('cards and arrows are exactly the stored O*NET links', () => {
    const JOBS = [
        ['13-2011', 'Accountants and Auditors'],
        ['29-1141', 'Registered Nurses'],
        ['47-2111', 'Electricians'],
    ] as const;

    it.each(JOBS)('%s %s, desktop lanes, first 10 then "Show 10 more"', async (soc, title) => {
        await openOn(soc, DESKTOP);
        expect(q('[data-testid="career-centre-title"]')!.textContent).toBe(title);
        await expectExactlyTheData(soc, DEFAULT_SHOWN, 'desktop');
        const total = (await getCareerPaths(soc))!.links.length;
        const more = q('[data-testid="career-show-more"]')!;
        expect(more.textContent).toBe(`Show ${Math.min(SHOW_MORE_STEP, total - DEFAULT_SHOWN)} more`);
        await click(more);
        await expectExactlyTheData(soc, DEFAULT_SHOWN + SHOW_MORE_STEP, 'desktop');
        expect(q('[data-testid="career-show-more"]')).toBeNull(); // all shown (20 or fewer links)
        noClaude();
    });

    it.each(JOBS)('%s %s, stacked phone layout', async (soc) => {
        await openOn(soc, PHONE);
        await expectExactlyTheData(soc, DEFAULT_SHOWN, 'stacked');
        await click(q('[data-testid="career-show-more"]')!);
        await expectExactlyTheData(soc, DEFAULT_SHOWN + SHOW_MORE_STEP, 'stacked');
        noClaude();
    });

    it('reads each card as "<title>, <level>, pay <exact change>, AI Exposure <band>"', async () => {
        await openOn('13-2011', DESKTOP);
        const fm = q('[data-career-card="11-3031"]')!;
        const scale = roleScaleFor(useStore.getState().jobs);
        const pay = payChangeFor('13-2011', '11-3031');
        expect(pay?.kind).toBe('change');
        const ai = aiExposureFor('11-3031', scale);
        const band = ai === 'not scored' ? 'not scored' : { safe: 'green', hybrid: 'amber', high: 'red' }[ai.band];
        expect(fm.getAttribute('aria-label')).toBe(`Financial Managers, same level, pay ${payChangeExact(pay!.kind === 'change' ? pay!.difference : 0)}, AI Exposure ${band}`);
        expect(fm.getAttribute('aria-label')).toMatch(/^Financial Managers, same level, pay \+\$\d{1,3},\d{3}, AI Exposure (green|amber|red)$/);
        // The short figure on the card, the exact one in its tooltip.
        const chip = fm.querySelector<HTMLElement>('[data-pay]')!;
        expect(chip.textContent).toMatch(/^\+\$\d+k$/);
        expect(chip.title).toContain(payChangeExact(pay!.kind === 'change' ? pay!.difference : 0));
        // Bookkeeping clerks: a step down, and a pay cut written with a real minus sign.
        expect(q('[data-career-card="43-3031"]')!.getAttribute('aria-label')).toMatch(/^Bookkeeping, Accounting, and Auditing Clerks, step down, pay −\$\d{1,3},\d{3}, AI Exposure (green|amber|red)$/);
    });
});

describe('missing data is said, never guessed', () => {
    it('a target with no published annual wage says "no data"', async () => {
        // Athletes and Sports Competitors -> Dancers: BLS publishes Dancers' pay only by the hour.
        expect(INDEX_OCCUPATION_BY_SOC.get('27-2031')!.annualMedian).toBeNull();
        await openOn('27-2021', DESKTOP);
        const dancers = q('[data-career-card="27-2031"]')!;
        expect(dancers.getAttribute('aria-label')).toMatch(/^Dancers, [a-z ]+, pay no data, AI Exposure /);
        expect(dancers.textContent).toContain('pay: no data');
        expect(dancers.textContent).toContain('Median pay: no data');
        expect(dancers.querySelector<HTMLElement>('[data-pay]')!.title).toContain('no data');
        noClaude();
    });

    it('a target with a mixed Job Zone falls under "Level not available" (dashed arrow)', async () => {
        // Financial Examiners -> Managers, All Other and Financial Specialists, All Other: both mixed in O*NET.
        await openOn('13-2061', DESKTOP);
        const none = qa('[data-career-list="none"] [data-career-card]').map((c) => c.dataset.careerCard);
        expect(none).toEqual(['11-9199', '13-2099']);
        expect(q('[data-career-card="11-9199"]')!.getAttribute('aria-label')).toContain(', level not available, ');
        expect(q('[data-career-arrow="11-9199"] path')!.getAttribute('stroke-dasharray')).toBe('4 4');
        expect(q('[data-career-list="none"]')!.getAttribute('aria-label')).toBe('Level not available, 2 jobs');
    });

    it('a centre job with a mixed Job Zone shows every link as "Level not available", with no step up or down', async () => {
        await openOn('13-1020', DESKTOP); // Buyers and Purchasing Agents
        expect(qa('[data-career-list]').map((l) => l.dataset.careerList)).toEqual(['none']);
        expect(q('[data-testid="career-no-level"]')).not.toBeNull();
        expect(q('[data-testid="career-centre-zone"]')!.textContent).toBe('level not available');
    });

    it('a job with no links says "O*NET lists no related jobs for this one." and draws nothing', async () => {
        await openOn('11-9039', DESKTOP); // Education Administrators, All Other
        expect(q('[data-testid="career-no-links"]')!.textContent).toBe(NO_RELATED_TEXT);
        expect(qa('[data-career-card]')).toHaveLength(0);
        expect(qa('[data-career-arrow]')).toHaveLength(0);
        expect(q('[data-testid="career-centre-ai"]')!.textContent).toBe('not scored');
        expect(q('[data-testid="career-centre-zone"]')!.textContent).toBe('no data');
        noClaude();
    });

    it('an unscored target would read "not scored" in grey (no stored link reaches one: the 47 unscored jobs have no O*NET data)', () => {
        const scale = roleScaleFor(useStore.getState().jobs);
        const card = cardFor('13-2011', { to: '11-9039', tier: 'Supplemental', index: 20, rows: [], jobZone: null, direction: null }, 0, scale);
        expect(card.ai).toEqual({ band: 'not scored', color: RISK_UNSCORED_HEX, percentText: 'not scored' });
        expect(card.ariaLabel).toMatch(/, AI Exposure not scored$/);
    });
});

describe('walking a path', () => {
    it('a card becomes the centre, the trail grows, and a step walks back', async () => {
        await openOn('13-2011', DESKTOP);
        await click(q('[data-career-card="13-2061"]')!);
        await loaded();
        await until(() => centreSoc() === '13-2061', 'Financial Examiners');
        await click(q('[data-career-card="11-3031"]')!);
        await until(() => centreSoc() === '11-3031', 'Financial Managers');
        await loaded();
        const steps = () => qa('[data-testid="career-trail"] li').map((li) => li.textContent);
        expect(steps()).toEqual(['Accountants and Auditors', 'Financial Examiners', 'Financial Managers']);
        expect(q('[data-testid="career-trail"] [aria-current="step"]')!.textContent).toBe('Financial Managers');
        await expectExactlyTheData('11-3031', DEFAULT_SHOWN, 'desktop');
        // Focus follows the walk to the new centre card.
        expect(document.activeElement).toBe(q('[data-testid="career-centre"]'));
        // Back two steps.
        await click(qa('[data-testid="career-trail"] button')[0]);
        await until(() => centreSoc() === '13-2011', 'back to Accountants and Auditors');
        await loaded();
        expect(steps()).toEqual(['Accountants and Auditors']);
        expect(useWorldStore.getState().careerTrail).toEqual(['13-2011']);
        await expectExactlyTheData('13-2011', DEFAULT_SHOWN, 'desktop');
        noClaude();
    });

    it('search starts a new path; "Open job details" hands over to worldStore.openRole', async () => {
        await openOn('13-2011', DESKTOP);
        const input = q<HTMLInputElement>('[data-career-search]')!;
        await act(async () => {
            input.focus();
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            set.call(input, 'electricians');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.getAttribute('aria-expanded')).toBe('true');
        const first = q('[role="listbox"] [role="option"]')!;
        expect(first.textContent).toContain('Electricians');
        await act(async () => { first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); });
        await until(() => centreSoc() === '47-2111', 'Electricians');
        await loaded();
        expect(useWorldStore.getState().careerTrail).toEqual(['47-2111']);
        noClaude();

        const openRole = vi.fn();
        const realOpenRole = useWorldStore.getState().openRole;
        await act(async () => useWorldStore.setState({ openRole }));
        await click(q('[data-testid="career-open-details"]')!);
        expect(openRole).toHaveBeenCalledTimes(1);
        expect(openRole.mock.calls[0][0]).toMatchObject({ soc: '47-2111', key: 'soc:47-2111' });
        expect(useWorldStore.getState().careerPathsOpen).toBe(false);
        await act(async () => useWorldStore.setState({ openRole: realOpenRole }));
    });
});

describe('opening and closing', () => {
    it('Esc closes the view (a role panel underneath never sees it) and focus returns to the opener', async () => {
        const opener = document.createElement('button');
        opener.textContent = 'opener';
        document.body.appendChild(opener);
        opener.focus();
        const panelEsc = vi.fn();
        document.addEventListener('keydown', panelEsc);
        await act(async () => root.render(<CareerPathsHost />));
        await act(async () => useWorldStore.getState().openCareerPaths('29-1141'));
        await until(() => q('[data-career-paths]'), 'the lazy view');
        await loaded();
        expect(document.activeElement).not.toBe(opener);
        await act(async () => {
            (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        expect(useWorldStore.getState().careerPathsOpen).toBe(false);
        expect(q('[data-career-paths]')).toBeNull();
        expect(document.activeElement).toBe(opener);
        expect(panelEsc).not.toHaveBeenCalled();
        document.removeEventListener('keydown', panelEsc);
        // Reopening returns to the same job.
        await act(async () => useWorldStore.getState().openCareerPaths());
        await until(() => q('[data-career-paths]'), 'the view again');
        expect(useWorldStore.getState().careerTrail).toEqual(['29-1141']);
        noClaude();
    });

    it('the header has a Career Paths button on desktop and on a phone; it opens the view with no Claude call', async () => {
        const { Header } = await import('../components/Header');
        const props = { economyData: null, loadingEconomy: false, onOpenSkillsModal: () => {}, onOpenStartupIdeasModal: () => {}, onStartTour: () => {}, onOpenStudentGuide: () => {}, onOpenHealthCheck: () => {}, onShowMethodology: () => {} };
        for (const isPhone of [false, true]) {
            phone = isPhone;
            const html = renderToStaticMarkup(<Header {...props} />);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const b = doc.querySelector('[data-testid="header-career-paths"]')!;
            expect(b, isPhone ? 'phone' : 'desktop').not.toBeNull();
            expect(b.getAttribute('aria-label')).toBe('Career Paths');
            // Label beside the icon from 1024px up, the icon alone (named by aria-label) below.
            expect(b.querySelector('svg')).not.toBeNull();
            expect(b.querySelector('span')!.textContent).toBe('Career Paths');
            expect(b.querySelector('span')!.className).toBe('hidden lg:inline');
        }
        phone = false;
        await act(async () => root.render(<Header {...props} />));
        await click(q('[data-testid="header-career-paths"]')!);
        expect(useWorldStore.getState().careerPathsOpen).toBe(true);
        expect(useWorldStore.getState().careerTrail).toEqual([]);
        noClaude();
    });

    it('a panel\'s "Career paths" button opens the view on its job (and the Kelley title for "Open job details")', async () => {
        await act(async () => root.render(<OpenCareerPathsButton soc="13-2011" roleKey="job-1" />));
        await click(q('[data-testid="panel-career-paths"]')!);
        expect(useWorldStore.getState()).toMatchObject({ careerPathsOpen: true, careerTrail: ['13-2011'], careerRoleKey: 'job-1' });
        noClaude();
    });

    it('both role panels carry the button', async () => {
        const { JobDetailPanel } = await import('../components/JobDetailPanel');
        const { OccupationBody } = await import('../components/OccupationPanel');
        const { loadContinentFile } = await import('../utils/occupationIndex');
        const kelley = useStore.getState().jobs[0];
        const panel = renderToStaticMarkup(
            <JobDetailPanel job={kelley} occupation={null} analysisResult={null} analysisLoading={false} analysisError={null} missingApiKey={false} onClose={() => {}} onSetAnalysisResult={() => {}} onSetAnalysisLoading={() => {}} onShowMethodology={() => {}} />,
        );
        expect(panel).toContain('data-testid="panel-career-paths"');
        const unscored = (await loadContinentFile('11')).occupations['11-9039'];
        expect(renderToStaticMarkup(<OccupationBody occupation={unscored} onClose={() => {}} />)).toContain('data-testid="panel-career-paths"');
    });
});

describe('honest labels', () => {
    it('title, subtitle, source line and O*NET\'s credit line, always on screen', async () => {
        for (const width of [DESKTOP, PHONE]) {
            await openOn('13-2011', width);
            const dialog = q('[data-career-paths]')!;
            expect(dialog.getAttribute('role')).toBe('dialog');
            expect(dialog.getAttribute('aria-modal')).toBe('true');
            expect(dialog.querySelector('h2')!.textContent).toBe(CAREER_PATHS_TITLE);
            expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(CAREER_PATHS_SUBTITLE);
            expect(q('[data-testid="career-source-line"]')!.textContent).toBe(
                'Related jobs and levels: O*NET 30.1 (similar skills and work, not records of actual job moves). Pay: BLS OEWS May 2025 median annual wage. AI Exposure: this site\'s scores.',
            );
            expect(CAREER_PATHS_SOURCE_LINE).toBe(q('[data-testid="career-source-line"]')!.textContent);
            // The source line sits in the footer, outside the scrolling content.
            expect(q('[data-testid="career-source-line"]')!.closest('footer')).not.toBeNull();
            const credit = q('[data-testid="onet-attribution"]')!;
            expect(credit.textContent).toBe(CAREER_PATHS_SOURCE.attribution);
            expect(credit.textContent).toBe(
                'This page includes information from the O*NET 30.1 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. Future of Jobs has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.',
            );
            expect([...credit.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
                ['O*NET 30.1 Database', 'https://www.onetcenter.org/database.html'],
                ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
            ]);
            act(() => root.unmount());
            root = createRoot(container);
        }
    });
});
