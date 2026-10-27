/**
 * The globe is equal-area: each continent's share of the land, measured on
 * the sphere from the mesh the renderer draws, must be its share of BLS
 * Employment Projections 2025 employment. Shapes and positions are layout;
 * these tests only hold them to "no overlap, no land in the polar caps, every
 * peak on its own continent".
 */

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from 'three';
import { INDEX_CONTINENTS } from '../utils/occupationIndex';
import {
    buildContinentMesh,
    buildGlobeLayout,
    continentAt,
    GLOBE_LAT_LIMIT,
    GLOBE_RADIUS,
    LAND_FRACTION,
    LAND_RADIUS,
    layoutContinents,
    lonSinOf,
    lonSinToLocal,
    pointInPolygon,
    sphericalTrianglesArea,
    unitVector,
} from '../utils/globeLayout';
import { familyTreemap, layoutRegions, WORLD_BOUNDS } from '../utils/worldLayout';
import { getRoleEntries } from '../utils/roles';
import { useStore } from '../store';
import { continentLabelPoint } from '../components/world/globeScene';
import { horizonAlpha, layoutGlobeLabels, type GlobeLabel } from '../components/world/globeLabels';
import { isHiddenLabelPosition } from '../utils/labelLayout';

const continents = layoutContinents();
const mesh = buildContinentMesh(continents);
const totalEp = INDEX_CONTINENTS.reduce((a, c) => a + c.ep.employment2025, 0);
const areas = mesh.ranges.map((r) => sphericalTrianglesArea(mesh.positions, mesh.index, r.start, r.count));
const totalArea = areas.reduce((a, b) => a + b, 0);

describe('continent area on the sphere is EP 2025 employment', () => {
    it('measures each continent\'s share of the land on the generated mesh within 1% of its EP share', () => {
        expect(continents.map((c) => c.code)).toEqual(INDEX_CONTINENTS.map((c) => c.code));
        INDEX_CONTINENTS.forEach((c, i) => {
            const ep = c.ep.employment2025 / totalEp;
            const measured = areas[i] / totalArea;
            expect(Math.abs(measured / ep - 1), `${c.code} ${c.title}: EP ${ep}, sphere ${measured}`).toBeLessThan(0.01);
        });
    });

    it('gives every continent the same share of its cell, so the ocean is taken evenly', () => {
        // Cell area on the unit sphere = Δλ · Δ(sin φ); land should be LAND_FRACTION of it.
        continents.forEach((c, i) => {
            const cell = (c.cell.x1 - c.cell.x0) * (c.cell.z1 - c.cell.z0);
            expect(areas[i] / cell, c.code).toBeCloseTo(LAND_FRACTION, 2);
        });
        // Land is LAND_FRACTION of the band |sin φ| ≤ GLOBE_LAT_LIMIT, i.e. of 4π · GLOBE_LAT_LIMIT.
        expect(totalArea / (4 * Math.PI * GLOBE_LAT_LIMIT)).toBeCloseTo(LAND_FRACTION, 2);
    });

    it('measures the sphere correctly (control: a whole sphere is 4π)', () => {
        // Octahedron, subdivided once and pushed onto the sphere: its spherical triangles tile it exactly.
        const v = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
        const f = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
        expect(sphericalTrianglesArea(v, f)).toBeCloseTo(4 * Math.PI, 10);
    });
});

describe('ocean, poles and overlap', () => {
    it('leaves both polar caps (|sin latitude| > 0.85) without land', () => {
        let maxSin = 0;
        for (let i = 0; i < mesh.positions.length; i += 3) {
            const [, s] = lonSinOf(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
            maxSin = Math.max(maxSin, Math.abs(s));
        }
        expect(maxSin).toBeLessThan(GLOBE_LAT_LIMIT);
    });

    it('keeps continents apart: their generated extents never overlap', () => {
        // Each continent's vertices, as (longitude, sin latitude) boxes.
        const boxes = mesh.ranges.map((_, ci) => {
            let lon0 = Infinity, lon1 = -Infinity, s0 = Infinity, s1 = -Infinity;
            for (let v = 0; v < mesh.region.length; v++) {
                if (mesh.region[v] !== ci) continue;
                const [lon, s] = lonSinOf(mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]);
                lon0 = Math.min(lon0, lon); lon1 = Math.max(lon1, lon);
                s0 = Math.min(s0, s); s1 = Math.max(s1, s);
            }
            return { lon0, lon1, s0, s1 };
        });
        for (let i = 0; i < boxes.length; i++) {
            const a = boxes[i];
            // No continent wraps around the date line (its box would span almost 2π).
            expect(a.lon1 - a.lon0, continents[i].code).toBeLessThan(Math.PI);
            for (let j = i + 1; j < boxes.length; j++) {
                const b = boxes[j];
                const apart = a.lon1 < b.lon0 || b.lon1 < a.lon0 || a.s1 < b.s0 || b.s1 < a.s0;
                expect(apart, `${continents[i].code}/${continents[j].code}`).toBe(true);
            }
        }
    });

    it('finds ocean, not land, between continents and at the poles', () => {
        expect(continentAt(continents, 0, 0.95)).toBeNull();
        expect(continentAt(continents, 1, -0.95)).toBeNull();
        for (const c of continents) {
            expect(continentAt(continents, c.lon, c.sinLat)?.code).toBe(c.code);
            // The corner of its cell is ocean.
            expect(continentAt(continents, c.cell.x0 + 1e-6, -(c.cell.z0 + 1e-6))).toBeNull();
        }
    });

    it('is deterministic and keeps SOC order north to south, west to east', () => {
        expect(layoutContinents()).toEqual(continents);
        expect(continents[0].sinLat).toBeGreaterThan(continents[continents.length - 1].sinLat);
    });

    it('leaves the flat field layout as phase 2 drew it', () => {
        // The globe passes a latitude correction to the treemap; the flat map passes none, which is a scale of 1.
        expect(familyTreemap(WORLD_BOUNDS, () => 1).fields).toEqual(layoutRegions().map((r) => r.rect));
    });
});

describe('peaks on the globe', () => {
    const entries = getRoleEntries(useStore.getState().jobs);
    const globe = buildGlobeLayout(entries);

    it('places every role once, standing on its own continent', () => {
        let n = 0;
        for (const e of entries) {
            const peaks = globe.peaksByContinent.get(e.continent)!;
            const p = peaks.find((q) => q.key === e.key)!;
            expect(p, e.title).toBeTruthy();
            const c = globe.continentByCode.get(e.continent)!;
            const [u, v] = lonSinToLocal(c, p.lon, p.sinLat);
            expect(pointInPolygon(c.coast, u, v), e.title).toBe(true);
            expect(continentAt(globe.continents, p.lon, p.sinLat)?.code, e.title).toBe(e.continent);
            n++;
        }
        expect(n).toBe(entries.length);
    });

    it('stands peaks on the land surface along the normal', () => {
        const c = globe.continents[0];
        const [x, y, z] = unitVector(c.lon, c.sinLat);
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
        expect(LAND_RADIUS).toBeGreaterThan(GLOBE_RADIUS);
    });
});

describe('labels on the globe', () => {
    // The same pass GlobeMarkers runs every frame, with a real camera.
    const labels: GlobeLabel[] = continents.map((c) => {
        const anchor = continentLabelPoint(c);
        const l = Math.hypot(...anchor);
        return { id: c.code, n: [anchor[0] / l, anchor[1] / l, anchor[2] / l], anchor, halfWidth: 45, halfHeight: 11, slack: 2 };
    });
    const weights = new Map(continents.map((c) => [c.code, c.ep2025]));
    const screens = [
        { name: 'desktop', w: 1440, h: 900, fov: 45, band: { top: 190, bottom: 170 } },
        { name: '390px', w: 390, h: 844, fov: 70, band: { top: 300, bottom: 270 } },
    ];

    it('hides every continent label on the far hemisphere, from any side, and shows some on the near one', () => {
        for (const s of screens) {
            for (let i = 0; i < 12; i++) {
                for (const lat of [-0.5, 0.35]) {
                    const lon = (i / 12) * 2 * Math.PI - Math.PI;
                    const camera = new PerspectiveCamera(s.fov, s.w / s.h, 0.1, 1000);
                    const [x, y, z] = unitVector(lon, Math.sin(lat));
                    camera.position.set(x * 80, y * 80, z * 80);
                    camera.lookAt(0, 0, 0);
                    camera.updateMatrixWorld();
                    const out = new Map<string, [number, number]>();
                    const alphas = new Map<string, number>();
                    layoutGlobeLabels(labels, weights, camera, s.w, s.h, s.band, out, new Map(), alphas);
                    let shown = 0;
                    for (const label of labels) {
                        const pos = out.get(label.id);
                        const placed = !!pos && !isHiddenLabelPosition(pos);
                        // Inside the horizon means n · camera direction > R / distance.
                        const facing = (label.n[0] * x + label.n[1] * y + label.n[2] * z) - LAND_RADIUS / 80;
                        if (facing <= 0) {
                            expect(placed, `${s.name} lon ${lon.toFixed(2)}: ${label.id} is behind the globe`).toBe(false);
                            expect(alphas.get(label.id)).toBe(0);
                        }
                        if (placed) {
                            expect(facing).toBeGreaterThan(0);
                            expect(alphas.get(label.id)).toBeGreaterThan(0);
                            shown++;
                        }
                    }
                    expect(shown, `${s.name} lon ${lon.toFixed(2)}`).toBeGreaterThanOrEqual(3);
                }
            }
        }
    });

    it('fades labels toward the horizon', () => {
        expect(horizonAlpha(0, 0, 1, 0, 0, 80)).toBe(1);
        const edge = Math.acos(LAND_RADIUS / 80);
        expect(horizonAlpha(Math.sin(edge - 0.1), 0, Math.cos(edge - 0.1), 0, 0, 80)).toBeGreaterThan(0);
        expect(horizonAlpha(Math.sin(edge - 0.1), 0, Math.cos(edge - 0.1), 0, 0, 80)).toBeLessThan(1);
        expect(horizonAlpha(Math.sin(edge + 0.01), 0, Math.cos(edge + 0.01), 0, 0, 80)).toBe(0);
        expect(horizonAlpha(0, 0, -1, 0, 0, 80)).toBe(0);
    });

    it('hides them all while the camera flies between the globe and a field', () => {
        const camera = new PerspectiveCamera(45, 1.6, 0.1, 1000);
        camera.position.set(0, 0, 80);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const out = new Map<string, [number, number]>();
        layoutGlobeLabels(labels, weights, camera, 1440, 900, { top: 0, bottom: 0 }, out, new Map(), new Map(), true);
        expect([...out.values()].filter((p) => !isHiddenLabelPosition(p))).toEqual([]);
    });
});
