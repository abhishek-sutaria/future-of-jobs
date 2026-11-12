// @vitest-environment jsdom
/**
 * The IU school's look on the map and its job list, on the real WorldBar:
 * - the school list opens below its button (above only with no room below),
 *   on its own layer, never over the button, with the picked school marked
 *   (check, crimson, aria-selected); arrows move, Enter picks, Esc closes;
 * - the school chip counts exactly the roles the map lights, opens a list of
 *   them with their risk, and a tap on one goes through worldStore.openRole,
 *   the very call a tap on its peak makes; Esc, the close button or a tap
 *   outside close it; on a phone it is a bottom sheet under the bar;
 * - hiding the picker drops the chip and list;
 * - what sinks and greys (only the school; the Kelley filter's look is
 *   untouched), the sliced sunk bake, and reduced motion.
 * No Claude call anywhere: fetch is stubbed and must never be reached.
 */

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorldBar } from '../components/WorldBar';
import { SCHOOL_ENTER_MS } from '../components/SchoolPicker';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { BROAD_LABELS } from '../utils/labelLevel';
import { WORLD_LEVEL, fieldLevel } from '../utils/worldLevel';
import { isHighlighted, loadIuSchools, schoolFilterOf, type IuSchool } from '../utils/iuSchools';
import { roleRisk } from '../utils/roles';
import { percentOf } from '../utils/scoreRounding';
import { buildWorldScene } from '../components/world/worldScene';
import { buildStage, type StageJob } from '../utils/stageLayout';
import { LIST_GAP, listPlacement, peakFilterTargets, ringPulse, riskText, schoolChipLabel, WORLD_DIM_EMPHASIS } from '../utils/schoolLook';
import { bakeStage, bakeSunkHeights, SCHOOL_SINK, SCHOOL_SINK_SECONDS, sinkEase, sinkStep, surfaceHeight } from '../utils/stageBake';
import { stageFragmentShader } from '../components/world/stageShaders';
import { peakFragmentShader, peakVertexShader } from '../components/world/worldShaders';
import { Z } from '../config/layers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let narrow = false;
let schools: IuSchool[];
const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel);
const schoolButton = () => q<HTMLButtonElement>('[data-school-button]')!;
const schoolList = () => q('[role="listbox"][aria-label="IU schools"]');
const chip = () => q<HTMLButtonElement>('[data-testid="school-chip"]');
const jobsList = () => q('[data-school-jobs-list]');
const kelley = () => schools.find((s) => s.id === 'kelley')!;
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const keyOn = (target: EventTarget, key: string) =>
    act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
const pointerDown = (target: Element) => act(async () => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
});

async function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<WorldBar />));
}

async function showPicker(withKelley = false) {
    await act(async () => useWorldStore.getState().toggleSchools());
    await tick(SCHOOL_ENTER_MS);
    if (withKelley) await act(async () => useWorldStore.getState().setSchool(schoolFilterOf(kelley())));
}

/** Lays out the school button at `top` (36px tall) and gives the list a height: jsdom has no layout. */
function layout(buttonTop: number, listHeight: number, viewport: number) {
    window.innerHeight = viewport;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.hasAttribute('data-school-button')) return { top: buttonTop, bottom: buttonTop + 36, left: 160, right: 370, width: 210, height: 36, x: 160, y: buttonTop, toJSON: () => ({}) } as DOMRect;
        if (this.hasAttribute('data-world-bar')) return { top: 112, bottom: 300, left: 16, right: 374, width: 358, height: 188, x: 16, y: 112, toJSON: () => ({}) } as DOMRect;
        return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) { return this.getAttribute('role') === 'listbox' ? listHeight : 0; },
    });
}

beforeAll(async () => {
    window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width') ? narrow : false,
        media: query, onchange: null,
        addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    schools = await loadIuSchools();
});

beforeEach(() => {
    vi.useFakeTimers();
    narrow = false;
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    useStore.getState().setSelectedJob(null);
    useWorldStore.setState({ ...WORLD_LEVEL, focusRequestId: 0, kelleyZoom: false, labels: BROAD_LABELS, kelleyOnly: false, selectedOccupationSoc: null, schoolsRevealed: false, school: null });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    expect(fetchSpy).not.toHaveBeenCalled();
});

describe('the school list, opened again with a school picked', () => {
    it('opens below the button on its own layer, never over it, and marks the picked school', async () => {
        await render();
        await showPicker(true);
        layout(142, 416, 900);
        await act(async () => schoolButton().click());
        const list = schoolList()!;
        expect(list.dataset.placement).toBe('below');
        expect(list.className).toMatch(/\btop-full\b/);
        expect(list.className).toMatch(/\bmt-1\.5\b/);
        // Above the rows under the picker (the chip and the info line), which once painted over it.
        expect(list.className).toMatch(/\bz-30\b/);
        expect(q('[data-school-picker]')!.className).toMatch(/\bz-30\b/);
        // Where it starts: under the button's foot, so the two never overlap.
        const button = schoolButton().getBoundingClientRect();
        expect(button.bottom + LIST_GAP).toBeGreaterThan(button.bottom);

        const options = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
        const picked = options.filter((o) => o.getAttribute('aria-selected') === 'true');
        expect(picked).toHaveLength(1);
        expect(picked[0].textContent).toContain('Kelley School of Business');
        expect(picked[0].querySelector('[data-testid="school-check"]')).not.toBeNull();
        expect(picked[0].className).toContain('bg-[#990000]');
        expect(list.querySelectorAll('[data-testid="school-check"]')).toHaveLength(1);
    });

    it('opens above only when there is no room below and more above', async () => {
        await render();
        await showPicker(true);
        layout(800, 416, 900);
        await act(async () => schoolButton().click());
        expect(schoolList()!.dataset.placement).toBe('above');
        expect(schoolList()!.className).toMatch(/\bbottom-full\b/);
    });

    it('listPlacement: below when it fits or below is roomier; above otherwise; the list never covers the button', () => {
        const at = (top: number) => ({ top, bottom: top + 36 });
        expect(listPlacement(at(142), 416, 900)).toBe('below');
        expect(listPlacement(at(200), 416, 500)).toBe('below'); // fits nowhere, more room below
        expect(listPlacement(at(800), 416, 900)).toBe('above');
        for (const [top, h, vh] of [[142, 416, 900], [800, 416, 900], [300, 200, 600]]) {
            const b = at(top);
            const where = listPlacement(b, h, vh);
            const list = where === 'below' ? { top: b.bottom + LIST_GAP, bottom: b.bottom + LIST_GAP + h } : { top: b.top - LIST_GAP - h, bottom: b.top - LIST_GAP };
            expect(list.bottom <= b.top || list.top >= b.bottom).toBe(true);
        }
    });

    it('arrows move, Enter picks, Esc closes the list, and a second Esc hides the picker', async () => {
        await render();
        await showPicker(true);
        await keyOn(schoolButton(), 'ArrowDown');
        // Lands on the picked school.
        expect(document.activeElement?.textContent).toContain('Kelley School of Business');
        await keyOn(document.activeElement!, 'ArrowDown');
        expect(document.activeElement?.textContent).toContain('Luddy');
        await keyOn(document.activeElement!, 'ArrowUp');
        await keyOn(document.activeElement!, 'ArrowUp');
        expect(document.activeElement?.textContent).toContain('Jacobs');
        await keyOn(document.activeElement!, 'Enter');
        expect(useWorldStore.getState().school?.id).toBe('jacobs');
        expect(schoolList()).toBeNull();
        expect(document.activeElement).toBe(schoolButton());

        await keyOn(schoolButton(), 'ArrowDown');
        expect(schoolList()).not.toBeNull();
        await keyOn(document.activeElement!, 'Escape');
        expect(schoolList()).toBeNull();
        expect(useWorldStore.getState()).toMatchObject({ schoolsRevealed: true, school: { id: 'jacobs' } });
        await keyOn(schoolButton(), 'Escape');
        expect(useWorldStore.getState()).toMatchObject({ schoolsRevealed: false, school: null });
    });
});

describe('the school chip and its list', () => {
    it('counts what the map lights, at the world and in a field', async () => {
        await render();
        await showPicker(true);
        const scene = buildWorldScene(useStore.getState().jobs);
        const h = { kelleyOnly: false, school: schoolFilterOf(kelley()) };
        const lit = scene.peaks.filter((p) => isHighlighted(h, p.entry));
        expect(chip()!.textContent).toBe(`${schoolChipLabel(kelley(), lit.length, true)}. Show list`);
        expect(chip()!.textContent).toMatch(/^Kelley · \d+ jobs\./);

        await act(async () => useWorldStore.getState().focusContinent('13'));
        const stage = buildStage(fieldLevel('13'), scene)!;
        const litHere = stage.jobs.filter((j) => isHighlighted(h, { kind: j.kelley ? 'kelley' : 'bls', soc: j.soc }));
        expect(chip()!.textContent).toBe(`Kelley · ${litHere.length} jobs here. Show list`);
        await act(async () => chip()!.click());
        const rows = [...jobsList()!.querySelectorAll<HTMLButtonElement>('[data-school-job]')];
        expect(rows.map((r) => r.dataset.schoolJob).sort()).toEqual(litHere.map((j) => j.key).sort());
    });

    it('lists each job with its risk, rounded as everywhere in the app', async () => {
        await render();
        await showPicker(true);
        await act(async () => chip()!.click());
        const scene = buildWorldScene(useStore.getState().jobs);
        const rows = [...jobsList()!.querySelectorAll<HTMLButtonElement>('[data-school-job]')];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            const peak = scene.peakByKey.get(row.dataset.schoolJob!)!;
            const risk = roleRisk(peak.entry, peak.job);
            expect(row.textContent).toBe(`${peak.entry.title}${riskText(risk)}`);
        }
        expect(riskText(0.725)).toBe(`${percentOf(0.725)}% risk`);
        expect(riskText(null)).toBe('Not scored');
        // Alphabetical, so a job is easy to find.
        const titles = rows.map((r) => scene.peakByKey.get(r.dataset.schoolJob!)!.entry.title);
        expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    });

    it('a tap on a job calls the same openRole a tap on its peak does, with the same entry', async () => {
        await render();
        await showPicker(true);
        const openRole = vi.fn();
        const real = useWorldStore.getState().openRole;
        useWorldStore.setState({ openRole });
        try {
            await act(async () => chip()!.click());
            const row = jobsList()!.querySelector<HTMLButtonElement>('[data-school-job]')!;
            await act(async () => row.click());
            const scene = buildWorldScene(useStore.getState().jobs);
            // WorldMarkers: world.openRole(scene.peakByKey.get(action.key)!.entry)
            expect(openRole).toHaveBeenCalledTimes(1);
            expect(openRole.mock.calls[0][0]).toBe(scene.peakByKey.get(row.dataset.schoolJob!)!.entry);
            expect(jobsList()).toBeNull();
        } finally {
            useWorldStore.setState({ openRole: real });
        }
    });

    it('and that path flies to the job\'s field and opens it (Claude mocked out: no request is made)', async () => {
        await render();
        await showPicker(true);
        await act(async () => chip()!.click());
        const row = [...jobsList()!.querySelectorAll<HTMLButtonElement>('[data-school-job]')].find((r) => r.textContent?.startsWith('Budget Analyst'))!;
        await act(async () => row.click());
        expect(useWorldStore.getState().focusedContinent).toBe('13');
        expect(useStore.getState().selectedJob?.title).toBe('Budget Analyst');
    });

    it('closes with Esc (staying on the level), the close button, or a tap outside', async () => {
        await render();
        await act(async () => useWorldStore.getState().focusContinent('13'));
        await showPicker(true);

        await act(async () => chip()!.click());
        expect(jobsList()).not.toBeNull();
        expect(chip()!.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement?.hasAttribute('data-school-job')).toBe(true);
        await keyOn(document.activeElement!, 'Escape');
        expect(jobsList()).toBeNull();
        expect(useWorldStore.getState().focusedContinent).toBe('13');
        expect(document.activeElement).toBe(chip());

        await act(async () => chip()!.click());
        await act(async () => q<HTMLButtonElement>('[data-testid="school-jobs-close"]')!.click());
        expect(jobsList()).toBeNull();

        await act(async () => chip()!.click());
        await pointerDown(document.body);
        expect(jobsList()).toBeNull();
        expect(useWorldStore.getState().focusedContinent).toBe('13');
    });

    it('is a bottom sheet on a phone, above the year slider, reaching only up to under the bar', async () => {
        narrow = true;
        await render();
        await showPicker(true);
        layout(200, 416, 844);
        // Under the school picker's row, not beside it.
        expect(q('[data-testid="world-bar-school"]')!.contains(chip())).toBe(true);
        await act(async () => chip()!.click());
        const sheet = jobsList()!;
        expect(sheet.dataset.layout).toBe('sheet');
        expect(container.contains(sheet)).toBe(false); // portalled to the body
        expect(sheet.className).toMatch(/\bfixed\b.*\bbottom-0\b|\bbottom-0\b.*\bfixed\b/);
        expect(Number(sheet.style.zIndex)).toBeGreaterThan(Z.timeBar);
        expect(Number(sheet.style.zIndex)).toBeLessThan(Z.detailPanel);
        expect(sheet.style.maxHeight).toBe(`${844 - 300 - 12}px`);
        // A tap inside the sheet does not close it.
        await pointerDown(sheet);
        expect(jobsList()).not.toBeNull();
    });

    it('only exists while a school is picked: hiding the picker takes the chip and the list with it', async () => {
        await render();
        await showPicker(false);
        expect(chip()).toBeNull();
        await act(async () => useWorldStore.getState().setSchool(schoolFilterOf(kelley())));
        await act(async () => chip()!.click());
        expect(jobsList()).not.toBeNull();
        await act(async () => useWorldStore.getState().toggleSchools());
        expect(chip()).toBeNull();
        expect(jobsList()).toBeNull();
    });
});

describe('what the school does to the map', () => {
    const filter = () => schoolFilterOf({ id: 'x', name: 'X', jobs: ['13-2011'] });

    it('the Kelley filter looks exactly as before: dims what it leaves out, never greys or sinks', () => {
        expect(peakFilterTargets({ kelleyOnly: true, school: null }, { kind: 'bls', soc: '29-1141' })).toEqual({ emphasis: WORLD_DIM_EMPHASIS, out: 0 });
        expect(peakFilterTargets({ kelleyOnly: true, school: null }, { kind: 'kelley', soc: '13-2011' })).toEqual({ emphasis: 1, out: 0 });
        expect(WORLD_DIM_EMPHASIS).toBe(0.22);
        // The Kelley mix is the same line as before; the school's grey only runs with uSchool / aOut.
        expect(stageFragmentShader).toContain('mix(baseColor * 0.85, finalColor, mix(1.0, vEmphasis, uKelley))');
        expect(stageFragmentShader).toMatch(/if \(uSchool > 0\.0\)[\s\S]*else \{\s*finalColor = kelleyLook;/);
        expect(peakFragmentShader).toContain('color = mix(TERRAIN_BASE * 0.85, color, vEmph);');
        expect(peakVertexShader).toContain('mix(1.0, 0.2000, aOut)');
    });

    it('a school greys and sinks what it leaves out, and keeps its own jobs whole', () => {
        expect(peakFilterTargets({ kelleyOnly: false, school: filter() }, { kind: 'bls', soc: '29-1141' })).toEqual({ emphasis: 1, out: 1 });
        expect(peakFilterTargets({ kelleyOnly: false, school: filter() }, { kind: 'kelley', soc: '13-2011' })).toEqual({ emphasis: 1, out: 0 });
        expect(peakFilterTargets({ kelleyOnly: false, school: null }, { kind: 'bls', soc: '29-1141' })).toEqual({ emphasis: 1, out: 0 });
    });

    const job = (key: string, x: number, soc: string): StageJob => ({ key, code: '13', x, z: 0, sigma: 1, ep2025: 1000, ep2035: 2000, color: [1, 0, 0], kelley: false, soc });
    const stage = { jobs: [job('a', -6, '13-2011'), job('b', 6, '15-1252'), job('c', 0, '15-1252')], outline: { x0: -10, z0: -5, x1: 10, z1: 5 } };
    const keepA = (j: StageJob) => j.soc === '13-2011';

    it('bakes the sunk layers a slice a frame, to exactly the all-at-once result', () => {
        const bake = bakeStage(stage, { x: 60, z: 30 }, 'smoothmax', 2, 1);
        const once = bakeSunkHeights(stage, bake, 'smoothmax', 2, 1, keepA).step(Infinity)!;
        let clock = 0;
        const sliced = bakeSunkHeights(stage, bake, 'smoothmax', 2, 1, keepA, () => (clock += 1));
        let frames = 0;
        let out: Float32Array | null = null;
        while (!(out = sliced.step(0.5))) frames++;
        expect(frames).toBeGreaterThan(1);
        expect(Array.from(out)).toEqual(Array.from(once));
    });

    it('sunk: the kept job stands as tall, the others drop to SCHOOL_SINK; pins and labels follow the drawn mix', () => {
        const bake = bakeStage(stage, { x: 60, z: 30 }, 'smoothmax', 2);
        bake.sunk = bakeSunkHeights(stage, bake, 'smoothmax', 2, 0, keepA).step(Infinity);
        const at = (x: number, sink: number, year = 0) => {
            bake.sink = sink;
            return surfaceHeight(bake, x, 0, year);
        };
        expect(at(-6, 1)).toBeCloseTo(at(-6, 0), 1);
        expect(at(6, 1) / at(6, 0)).toBeLessThan(SCHOOL_SINK + 0.15);
        expect(at(6, 1) / at(6, 0)).toBeGreaterThan(SCHOOL_SINK - 0.05);
        expect(at(6, 0.5, 1)).toBeCloseTo((at(6, 0, 1) + at(6, 1, 1)) / 2, 5);
        // Nothing sunk: the surface is the plain bake.
        bake.sunk = null;
        bake.sink = 1;
        expect(surfaceHeight(bake, 6, 0, 0)).toBe(at(6, 0));
    });

    it('sinks smoothly over SCHOOL_SINK_SECONDS, at once with reduced motion; the rings pulse only with motion', () => {
        expect(sinkStep(0, 1, SCHOOL_SINK_SECONDS / 4, false)).toBeCloseTo(0.25);
        expect(sinkStep(0.9, 1, 1, false)).toBe(1);
        expect(sinkStep(1, 0, SCHOOL_SINK_SECONDS / 2, false)).toBeCloseTo(0.5);
        expect(sinkStep(0, 1, 1 / 60, true)).toBe(1);
        expect(sinkStep(1, 0, 1 / 60, true)).toBe(0);
        expect(sinkEase(0)).toBe(0);
        expect(sinkEase(1)).toBe(1);
        expect(sinkEase(0.5)).toBe(0.5);
        const moving = [0, 0.3, 0.6, 0.9, 1.2].map((t) => ringPulse(t, false));
        expect(new Set(moving.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
        expect([0, 0.3, 0.6, 0.9, 1.2].map((t) => ringPulse(t, true))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    });
});
