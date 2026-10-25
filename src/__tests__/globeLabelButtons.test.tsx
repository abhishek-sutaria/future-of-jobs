// @vitest-environment jsdom
/**
 * Continent names on the globe are buttons that open their own continent.
 * They used to be pointer-events: none, so a tap on a name went through to
 * whatever land lay under it (a name may sit a label-width off its
 * continent, and the globe keeps turning): tapping "Education" opened
 * Architecture & Engineering. These tests place the names with the same pass
 * GlobeMarkers runs (a real three.js camera), click every visible one, and
 * find names that overlap a different continent to show they still open
 * their own.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PerspectiveCamera, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { ContinentLabelButton } from '../components/world/ContinentLabelButton';
import { continentLabelPoint } from '../components/world/globeScene';
import { layoutGlobeLabels, type GlobeLabel } from '../components/world/globeLabels';
import { useWorldView } from '../components/world/worldCamera';
import { worldPointer } from '../components/world/worldPointer';
import { useWorldStore } from '../worldStore';
import { continentAt, LAND_RADIUS, layoutContinents, lonSinOf, unitVector } from '../utils/globeLayout';
import { isHiddenLabelPosition } from '../utils/labelLayout';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const continents = layoutContinents();
// Measured chip sizes: desktop names are about 90×27 px, phone chips about 62×24.
const SCREENS = [
    { name: 'desktop', w: 1440, h: 900, fov: 45, half: { x: 48, y: 13 }, band: { top: 190, bottom: 170 } },
    { name: '390px', w: 390, h: 844, fov: 70, half: { x: 31, y: 12 }, band: { top: 300, bottom: 270 } },
];
const DIRECTIONS = Array.from({ length: 12 }, (_, i) => ({ lon: (i / 12) * 2 * Math.PI - Math.PI, lat: i % 2 ? 0.35 : -0.2 }));

interface Placed { code: string; x: number; y: number; hx: number; hy: number }

function placeLabels(s: (typeof SCREENS)[number], lon: number, lat: number) {
    const camera = new PerspectiveCamera(s.fov, s.w / s.h, 0.1, 1000);
    const [x, y, z] = unitVector(lon, Math.sin(lat));
    camera.position.set(x * 80, y * 80, z * 80);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const labels: GlobeLabel[] = continents.map((c) => {
        const anchor = continentLabelPoint(c);
        const l = Math.hypot(...anchor);
        return { id: c.code, n: [anchor[0] / l, anchor[1] / l, anchor[2] / l], anchor, halfWidth: s.half.x, halfHeight: s.half.y, slack: 2 };
    });
    const out = new Map<string, [number, number]>();
    layoutGlobeLabels(labels, new Map(continents.map((c) => [c.code, c.ep2025])), camera, s.w, s.h, s.band, out, new Map(), new Map());
    const placed: Placed[] = [];
    for (const [code, pos] of out) if (!isHiddenLabelPosition(pos)) placed.push({ code, x: pos[0], y: pos[1], hx: s.half.x, hy: s.half.y });
    return { camera, placed };
}

/** The continent a pass-through tap at screen point (x, y) would have hit, or null for ocean / sky. */
function landUnder(camera: PerspectiveCamera, w: number, h: number, x: number, y: number): string | null {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), camera);
    const p = ray.ray.intersectSphere(new Sphere(new Vector3(), LAND_RADIUS), new Vector3());
    if (!p) return null;
    const [lon, s] = lonSinOf(p.x, p.y, p.z);
    return continentAt(continents, lon, s)?.code ?? null;
}

let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterAll(() => act(() => root.unmount()));
afterEach(() => {
    useWorldStore.setState({ focusedContinent: null });
    useWorldView.setState({ view: 'globe', moving: false });
    worldPointer.hoverRegion = null;
    worldPointer.overLabel = false;
});

async function clickLabel(code: string): Promise<string | null> {
    useWorldStore.setState({ focusedContinent: null });
    await act(async () => root.render(<ContinentLabelButton code={code} expanded={false} onHover={() => {}} />));
    const button = container.querySelector<HTMLButtonElement>(`button[data-continent="${code}"]`)!;
    await act(async () => button.click());
    return useWorldStore.getState().focusedContinent;
}

describe('continent names on the globe are buttons for their own continent', () => {
    it('opens the clicked name\'s continent, for every visible name, from every side, at desktop and 390px', async () => {
        let clicked = 0;
        for (const s of SCREENS) {
            for (const d of DIRECTIONS) {
                const { placed } = placeLabels(s, d.lon, d.lat);
                expect(placed.length, `${s.name} ${d.lon.toFixed(2)}`).toBeGreaterThan(2);
                for (const p of placed) {
                    expect(await clickLabel(p.code)).toBe(p.code);
                    clicked++;
                }
            }
        }
        expect(clicked).toBeGreaterThan(150);
    });

    it('opens its own continent even where the name sits over a different continent', async () => {
        const cases: Array<{ code: string; under: string; where: string }> = [];
        for (const s of SCREENS) {
            for (const d of DIRECTIONS) {
                const { camera, placed } = placeLabels(s, d.lon, d.lat);
                for (const p of placed) {
                    // Sample the name's box; any land of another continent under it is what a pass-through tap would have opened.
                    for (const fx of [-0.9, -0.45, 0, 0.45, 0.9]) {
                        for (const fy of [-0.8, 0, 0.8]) {
                            const under = landUnder(camera, s.w, s.h, p.x + fx * p.hx, p.y + fy * p.hy);
                            if (under && under !== p.code && !cases.some((c) => c.code === p.code && c.under === under)) {
                                cases.push({ code: p.code, under, where: `${s.name} lon ${d.lon.toFixed(2)}` });
                            }
                        }
                    }
                }
            }
        }
        // The situation the review hit is common, not a corner case.
        expect(cases.length).toBeGreaterThan(10);
        expect(cases.some((c) => c.code === '25')).toBe(true); // Education
        for (const c of cases) {
            const opened = await clickLabel(c.code);
            expect(opened, `${c.where}: name ${c.code} over ${c.under}`).toBe(c.code);
            expect(opened).not.toBe(c.under);
        }
    });

    it('lights its continent\'s coastline and holds the globe still on hover and focus', async () => {
        await act(async () => root.render(<ContinentLabelButton code="25" expanded={false} onHover={() => {}} />));
        const button = container.querySelector<HTMLButtonElement>('button[data-continent="25"]')!;
        expect(button.getAttribute('aria-label')).toBe('Education: open this field');
        await act(async () => button.focus());
        expect(worldPointer.hoverRegion).toBe('25');
        expect(worldPointer.overLabel).toBe(true);
        await act(async () => button.blur());
        expect(worldPointer.hoverRegion).toBeNull();
        expect(worldPointer.overLabel).toBe(false);
        // Pointer hover uses native listeners: the label sits in drei's own React
        // root, where React's emulated onPointerEnter is dropped when the pointer
        // comes off the canvas.
        let hovered = false;
        await act(async () => root.render(<ContinentLabelButton code="25" expanded={false} onHover={(on) => { hovered = on; }} />));
        await act(async () => button.dispatchEvent(new Event('pointerenter')));
        expect(hovered).toBe(true);
        expect(worldPointer.hoverRegion).toBe('25');
        await act(async () => button.dispatchEvent(new Event('pointerleave')));
        expect(hovered).toBe(false);
        expect(worldPointer.hoverRegion).toBeNull();
    });

    it('does nothing while the camera is already flying', async () => {
        useWorldView.setState({ moving: true });
        expect(await clickLabel('25')).toBeNull();
    });
});
