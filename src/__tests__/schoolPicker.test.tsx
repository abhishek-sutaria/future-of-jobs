// @vitest-environment jsdom
/**
 * The hidden IU school picker on the real WorldBar: showing and hiding it
 * (entrance and exit, reduced motion, focus, the live region), Esc, picking a
 * school with the keyboard, the school and field filters together (counts on
 * the info line and in the field list), the empty state and its one-click
 * way out, and a long press on the field picker against a normal tap.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorldBar } from '../components/WorldBar';
import { SCHOOL_ENTER_MS, SCHOOL_FADE_MS, SCHOOL_LEAVE_MS } from '../components/SchoolPicker';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { BROAD_LABELS } from '../utils/labelLevel';
import { WORLD_LEVEL } from '../utils/worldLevel';
import { LONG_PRESS_MS } from '../utils/schoolShortcut';
import { highlightOn, isHighlighted, loadIuSchools, schoolFilterOf, type IuSchool } from '../utils/iuSchools';
import { INDEX_CONTINENT_BY_CODE, OCCUPATION_INDEX, continentOf } from '../utils/occupationIndex';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import slim from '../data/iu_school_jobs.json';
import { bakeStage, rebakeStageColors, STAGE_DIM_EMPHASIS } from '../utils/stageBake';
import type { StageJob } from '../utils/stageLayout';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let reducedMotion = false;
let schools: IuSchool[];

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T & HTMLElement>(sel);
const picker = () => q('[data-school-picker]');
const schoolButton = () => q<HTMLButtonElement>('[data-school-button]');
const fieldPicker = () => q<HTMLButtonElement>('[data-field-picker]')!;
const announcer = () => q('[data-testid="school-announcer"]')!.textContent;
const kelley = () => schools.find((s) => s.id === 'kelley')!;
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const toggle = () => act(async () => useWorldStore.getState().toggleSchools());
const keyOn = (target: EventTarget, key: string) =>
    act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

/** jsdom has no PointerEvent: a MouseEvent of the pointer type, carrying pointerType. */
const pointer = (type: string, target: Element, pointerType: string, x = 10, y = 10) => act(async () => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    target.dispatchEvent(e);
});

beforeAll(async () => {
    window.matchMedia = ((query: string) => ({
        matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
        media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    schools = await loadIuSchools();
});

beforeEach(async () => {
    vi.useFakeTimers();
    reducedMotion = false;
    useStore.getState().setSelectedJob(null);
    useWorldStore.setState({ ...WORLD_LEVEL, focusRequestId: 0, kelleyZoom: false, labels: BROAD_LABELS, kelleyOnly: false, selectedOccupationSoc: null, schoolsRevealed: false, school: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<WorldBar />));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

afterAll(() => vi.restoreAllMocks());

describe('showing and hiding', () => {
    it('is not on screen, nor hinted at, until asked for', () => {
        expect(picker()).toBeNull();
        expect(container.textContent).not.toMatch(/IU|school/i);
        expect(useWorldStore.getState().fieldPickerMounted).toBe(true);
    });

    it('slides in beside the field picker with its shimmer and sparks, takes focus, and says so', async () => {
        await toggle();
        expect(picker()!.dataset.phase).toBe('enter');
        expect(picker()!.className).toContain('iu-school--enter');
        expect(picker()!.querySelectorAll('.iu-school__spark').length).toBeGreaterThan(4);
        expect(picker()!.querySelector('.iu-school__shimmer')).not.toBeNull();
        expect(document.activeElement).toBe(schoolButton());
        expect(announcer()).toMatch(/IU school filter shown/);
        // Labelled "IU school", with its value.
        const name = schoolButton()!.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ');
        expect(name).toBe('IU school All IU schools');
        // Beside the field picker: in its row, right after it.
        const row = q('[data-testid="world-bar-nav"]')!;
        expect(row.contains(picker())).toBe(true);
        expect(fieldPicker().compareDocumentPosition(picker()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await tick(SCHOOL_ENTER_MS);
        expect(picker()!.dataset.phase).toBe('shown');
        expect(picker()!.querySelector('.iu-school__spark, .iu-school__shimmer')).toBeNull();
    });

    it('the same again hides it with a short exit, drops the school and puts focus back on the field picker', async () => {
        await toggle();
        await tick(SCHOOL_ENTER_MS);
        await act(async () => useWorldStore.getState().setSchool(schoolFilterOf(kelley())));
        await toggle();
        expect(useWorldStore.getState().school).toBeNull();
        expect(picker()!.dataset.phase).toBe('leave');
        expect(picker()!.className).toContain('iu-school--leave');
        expect(picker()!.querySelector('.iu-school__spark')).toBeNull();
        expect(document.activeElement).toBe(fieldPicker());
        expect(announcer()).toMatch(/hidden/);
        await tick(SCHOOL_LEAVE_MS);
        expect(picker()).toBeNull();
    });

    it('with reduced motion it only fades, no shimmer or sparks', async () => {
        reducedMotion = true;
        await toggle();
        expect(picker()!.className).toContain('iu-school--fade-in');
        expect(picker()!.className).not.toContain('iu-school--enter');
        expect(picker()!.querySelector('.iu-school__spark, .iu-school__shimmer')).toBeNull();
        await tick(SCHOOL_FADE_MS);
        expect(picker()!.dataset.phase).toBe('shown');
        await toggle();
        expect(picker()!.className).toContain('iu-school--fade-out');
        await tick(SCHOOL_FADE_MS);
        expect(picker()).toBeNull();
    });

    it('Esc on it hides it and clears the school, without going up a level', async () => {
        await act(async () => useWorldStore.getState().focusContinent('13'));
        await toggle();
        await tick(SCHOOL_ENTER_MS);
        await act(async () => useWorldStore.getState().setSchool(schoolFilterOf(kelley())));
        await keyOn(schoolButton()!, 'Escape');
        expect(useWorldStore.getState()).toMatchObject({ schoolsRevealed: false, school: null, focusedContinent: '13' });
        expect(document.activeElement).toBe(fieldPicker());
    });
});

describe('picking a school', () => {
    beforeEach(async () => {
        await toggle();
        await tick(SCHOOL_ENTER_MS);
    });

    it('lists only schools with jobs, each with its count, and picks one with the keyboard', async () => {
        await keyOn(schoolButton()!, 'ArrowDown');
        const options = [...container.querySelectorAll<HTMLButtonElement>('[role="listbox"][aria-label="IU schools"] [role="option"]')];
        expect(options.map((o) => o.textContent)).toEqual([
            'All IU schools · no filter',
            ...slim.schools.map((s) => `${s.name}${s.jobs.length} occupations`),
        ]);
        expect(options.some((o) => o.textContent?.includes('School of Nursing'))).toBe(false);
        expect(document.activeElement).toBe(options[0]);
        const kelleyAt = options.findIndex((o) => o.textContent?.startsWith('Kelley'));
        for (let i = 0; i < kelleyAt; i++) await keyOn(document.activeElement!, 'ArrowDown');
        expect(document.activeElement).toBe(options[kelleyAt]);
        await act(async () => (document.activeElement as HTMLButtonElement).click());
        expect(useWorldStore.getState().school?.id).toBe('kelley');
        expect(schoolButton()!.textContent).toContain('Kelley School of Business');
        expect(document.activeElement).toBe(schoolButton());
        expect(announcer()).toBe(`Kelley School of Business: ${kelley().jobs.length} occupations stand out.`);
    });

    it('works with the field: counts at the world, in a field, and in the field list', async () => {
        await act(async () => useWorldStore.getState().setSchool(schoolFilterOf(kelley())));
        expect(q('[data-testid="school-count"]')!.textContent).toBe(`${kelley().jobs.length} occupations · Kelley School of Business`);

        const inField = OCCUPATION_INDEX.occupations.filter((o) => continentOf(o.soc) === '13');
        const matches = inField.filter((o) => kelley().jobs.includes(o.soc)).length;
        expect(matches).toBeGreaterThan(0);
        await act(async () => useWorldStore.getState().focusContinent('13'));
        expect(q('[data-testid="world-bar-info"] [data-testid="school-count"]')!.textContent)
            .toBe(`${matches} of ${INDEX_CONTINENT_BY_CODE.get('13')!.occupationCount} occupations · Kelley School of Business`);

        await act(async () => fieldPicker().click());
        const badges = [...container.querySelectorAll('[data-testid="field-school-count"]')].map((b) => Number.parseInt(b.textContent!, 10));
        expect(badges.reduce((a, b) => a + b, 0)).toBe(kelley().jobs.length);
    });

    it('when nothing matches, says so with a one-click way to clear the school', async () => {
        await act(async () => useWorldStore.getState().setSchool(schoolFilterOf(kelley())));
        await act(async () => useWorldStore.getState().focusContinent('29'));
        const empty = q('[data-testid="school-empty"]')!;
        expect(empty.textContent).toContain(`No Kelley School of Business jobs in ${CONTINENT_DISPLAY_NAMES['29']}.`);
        await act(async () => q<HTMLButtonElement>('[data-testid="school-clear"]')!.click());
        expect(useWorldStore.getState().school).toBeNull();
        expect(useWorldStore.getState().schoolsRevealed).toBe(true);
        expect(q('[data-testid="school-empty"]')).toBeNull();
    });
});

describe('long press on the field picker', () => {
    it('a long press shows the school picker without opening the field list; a tap still opens it', async () => {
        const fp = fieldPicker();
        await pointer('pointerdown', fp, 'touch');
        await tick(LONG_PRESS_MS);
        await pointer('pointerup', fp, 'touch');
        await act(async () => fp.click());
        expect(useWorldStore.getState().schoolsRevealed).toBe(true);
        expect(fp.getAttribute('aria-expanded')).toBe('false');
        await tick(SCHOOL_ENTER_MS);

        await pointer('pointerdown', fp, 'touch');
        await tick(120);
        await pointer('pointerup', fp, 'touch');
        await act(async () => fp.click());
        expect(fp.getAttribute('aria-expanded')).toBe('true');
        expect(useWorldStore.getState().schoolsRevealed).toBe(true);
    });

    it('a second long press hides it again; no callout or text selection on the way', async () => {
        const fp = fieldPicker();
        expect(fp.className).toMatch(/select-none/);
        expect(fp.className).toMatch(/\[-webkit-touch-callout:none\]/);
        for (let i = 0; i < 2; i++) {
            await pointer('pointerdown', fp, 'touch');
            const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            act(() => { fp.dispatchEvent(menu); });
            expect(menu.defaultPrevented).toBe(true);
            await tick(LONG_PRESS_MS);
            await pointer('pointerup', fp, 'touch');
            await act(async () => fp.click());
            await tick(SCHOOL_ENTER_MS);
        }
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
        expect(picker()).toBeNull();
    });
});

describe('what stands out on the map', () => {
    const kelleyRole = { kind: 'kelley' as const, soc: '13-2011' };
    const blsRole = { kind: 'bls' as const, soc: '29-1141' };

    it('a school keeps its jobs (scored or not) and dims the rest; with the Kelley filter, both must pass', () => {
        const filter = schoolFilterOf({ id: 'x', name: 'X', jobs: ['13-2011', '25-1199'] });
        expect(highlightOn({ kelleyOnly: false, school: null })).toBe(false);
        expect(isHighlighted({ kelleyOnly: false, school: null }, blsRole)).toBe(true);
        expect(isHighlighted({ kelleyOnly: false, school: filter }, kelleyRole)).toBe(true);
        expect(isHighlighted({ kelleyOnly: false, school: filter }, blsRole)).toBe(false);
        // 25-1199 Postsecondary Teachers, All Other is one of the 47 "Not scored" jobs.
        expect(isHighlighted({ kelleyOnly: false, school: filter }, { kind: 'bls', soc: '25-1199' })).toBe(true);
        expect(isHighlighted({ kelleyOnly: true, school: filter }, { kind: 'bls', soc: '25-1199' })).toBe(false);
        expect(isHighlighted({ kelleyOnly: true, school: filter }, kelleyRole)).toBe(true);
    });

    it('a field re-colours in place for a new school: its jobs at full colour, the rest dimmed, heights unchanged', () => {
        const job = (key: string, x: number, soc: string): StageJob => ({ key, code: '13', x, z: 0, sigma: 1, ep2025: 1000, ep2035: 1000, color: [1, 0, 0], kelley: false, soc });
        const stage = { jobs: [job('a', -6, '13-2011'), job('b', 6, '15-1252')], outline: { x0: -10, z0: -5, x1: 10, z1: 5 } };
        const bake = bakeStage(stage, { x: 40, z: 20 }, 'smoothmax', 2);
        const heights = bake.heights.slice();
        const alphaAt = (x: number) => {
            const col = Math.round(((x - stage.outline.x0) / 20) * (bake.cols - 1));
            const row = Math.round((bake.rows - 1) / 2);
            return bake.colors[(row * bake.cols + col) * 4 + 3];
        };
        rebakeStageColors(stage, bake, (j) => j.soc === '13-2011');
        expect(alphaAt(-6)).toBe(255);
        expect(alphaAt(6)).toBe(Math.round(255 * STAGE_DIM_EMPHASIS));
        rebakeStageColors(stage, bake, (j) => j.soc === '15-1252');
        expect(alphaAt(-6)).toBe(Math.round(255 * STAGE_DIM_EMPHASIS));
        expect(alphaAt(6)).toBe(255);
        expect(bake.heights).toEqual(heights);
    });

    it('is never saved: a fresh store starts hidden with no school', () => {
        expect(useWorldStore.getInitialState()).toMatchObject({ schoolsRevealed: false, school: null });
        const storage = JSON.stringify({ ...localStorage });
        expect(storage).not.toMatch(/school/i);
    });
});
