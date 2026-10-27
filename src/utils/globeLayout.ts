/**
 * Where the 22 continents and their peaks sit on the globe.
 *
 * SIZE is data, and the globe is equal-area. The two-level treemap of the
 * flat map (worldLayout.familyTreemap: the five BLS job families, then each
 * family's fields in SOC order) runs in Lambert cylindrical equal-area
 * coordinates: x = longitude, y = sin(latitude). That projection keeps area
 * exactly (a cell Δλ × Δy covers R²·Δλ·Δy of the sphere), so a continent's
 * share of the land is its share of BLS Employment Projections 2025
 * employment. The treemap only fills |sin(latitude)| ≤ GLOBE_LAT_LIMIT, so
 * both polar caps are ocean.
 *
 * Ocean: every continent keeps the same fraction (LAND_FRACTION) of its
 * treemap cell and leaves the rest to the sea around it, so the shares stay
 * proportional.
 *
 * SHAPE and POSITION are layout only: a coastline is a rounded rectangle with
 * a little deterministic noise, inset until its area is exactly LAND_FRACTION
 * of its cell. Peaks sit on the phase-2 even grid (layoutRegionPeaks) inside
 * each continent; only their height carries data.
 *
 * Pure (no three.js, no DOM) so it can be unit-tested; the renderer draws the
 * mesh buildContinentMesh returns, and the area test measures that same mesh.
 */

import { INDEX_CONTINENTS } from './occupationIndex';
import type { RoleEntry } from './roles';
import { familyTreemap, layoutRegionPeaks, type FamilyLayout, type PeakPlacement, type Rect } from './worldLayout';

/** Ocean radius in world units. Chosen so the land holds about as much area as the flat map did. */
export const GLOBE_RADIUS = 20;
/** Continents are a thin plateau this far above the ocean. */
export const LAND_LIFT = 0.08;
export const LAND_RADIUS = GLOBE_RADIUS + LAND_LIFT;
/** The treemap fills |sin(latitude)| ≤ this (about ±58°); above it is polar ocean. */
export const GLOBE_LAT_LIMIT = 0.85;
/** Share of its treemap cell each continent keeps as land; the rest is ocean. The same for every continent. */
export const LAND_FRACTION = 0.72;

/**
 * Treemap bounds in equal-area coordinates: x = longitude, z = −sin(latitude).
 * The treemap reads its rows from z0 down, so SOC order runs north to south
 * and west to east.
 */
export const GLOBE_TREEMAP_BOUNDS: Readonly<Rect> = { x0: -Math.PI, z0: -GLOBE_LAT_LIMIT, x1: Math.PI, z1: GLOBE_LAT_LIMIT };

/** Corner radius of a coastline, as a share of its shorter half-side. */
const CORNER = 0.42;
/** Coastline wiggle, as a share of the shorter half-side. */
const COAST_NOISE = 0.09;
const COAST_HARMONICS: ReadonlyArray<readonly [number, number]> = [[3, 1], [5, 0.6], [7, 0.45], [11, 0.3], [17, 0.18]];
const HARMONIC_SUM = COAST_HARMONICS.reduce((a, [, w]) => a + w, 0);

export interface GlobeContinent {
    /** Two-digit SOC major code. */
    code: string;
    /** EP 2025 summary-row employment that sized the continent. */
    ep2025: number;
    /** Treemap cell (x = longitude, z = −sin latitude). */
    cell: Rect;
    /** Centre of the cell. */
    lon: number;
    sinLat: number;
    cosLat: number;
    /**
     * Coastline, counter-clockwise, in the continent's local frame: u east,
     * v north, in radians of arc on the unit sphere at the centre. The frame is
     * (λ − λc)·cos φc, (sin φ − sin φc) / cos φc: a linear map of the
     * equal-area plane with determinant 1, so it keeps area too.
     */
    coast: Float64Array;
    /** Ocean margin left on every side, local frame. */
    margin: number;
    /** Half-sizes of the land's rounded rectangle before the coastline noise, local frame. */
    halfU: number;
    halfV: number;
    /** Coastline wiggle amplitude, local frame. */
    noise: number;
    /** Largest centre-to-coast distance, local frame. */
    reach: number;
}

/** Local frame → equal-area coordinates (longitude, sin latitude). */
export function localToLonSin(c: GlobeContinent, u: number, v: number): [number, number] {
    return [c.lon + u / c.cosLat, c.sinLat + v * c.cosLat];
}

/** Equal-area coordinates → the continent's local frame. */
export function lonSinToLocal(c: GlobeContinent, lon: number, sinLat: number): [number, number] {
    return [(lon - c.lon) * c.cosLat, (sinLat - c.sinLat) / c.cosLat];
}

/** Unit vector for a longitude and sin(latitude). Longitude 0 faces +z, north is +y. */
export function unitVector(lon: number, sinLat: number): [number, number, number] {
    const cos = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
    return [cos * Math.sin(lon), sinLat, cos * Math.cos(lon)];
}

/** Longitude and sin(latitude) of a point (any length, not the origin). */
export function lonSinOf(x: number, y: number, z: number): [number, number] {
    return [Math.atan2(x, z), y / Math.hypot(x, y, z)];
}

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Point and outward normal at arc length t along a rounded rectangle (counter-clockwise from the right edge). */
function roundedRectAt(a: number, b: number, r: number, t: number): [number, number, number, number] {
    const sa = 2 * (a - r);
    const sb = 2 * (b - r);
    const arc = (Math.PI / 2) * r;
    const corner = (cx: number, cy: number, from: number, s: number): [number, number, number, number] => {
        const th = from + s / Math.max(r, 1e-12);
        return [cx + r * Math.cos(th), cy + r * Math.sin(th), Math.cos(th), Math.sin(th)];
    };
    if (t < sb) return [a, -(b - r) + t, 1, 0];
    t -= sb;
    if (t < arc) return corner(a - r, b - r, 0, t);
    t -= arc;
    if (t < sa) return [a - r - t, b, 0, 1];
    t -= sa;
    if (t < arc) return corner(-(a - r), b - r, Math.PI / 2, t);
    t -= arc;
    if (t < sb) return [-a, b - r - t, -1, 0];
    t -= sb;
    if (t < arc) return corner(-(a - r), -(b - r), Math.PI, t);
    t -= arc;
    if (t < sa) return [-(a - r) + t, -b, 0, -1];
    t -= sa;
    return corner(a - r, -(b - r), (3 * Math.PI) / 2, Math.min(t, arc));
}

/** Shoelace area of a closed polygon given as [x0, y0, x1, y1, …]. */
export function polygonArea(xy: ArrayLike<number>): number {
    let s = 0;
    const n = xy.length / 2;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        s += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1];
    }
    return s / 2;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(xy: ArrayLike<number>, x: number, y: number): boolean {
    let inside = false;
    const n = xy.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = xy[2 * i];
        const yi = xy[2 * i + 1];
        const xj = xy[2 * j];
        const yj = xy[2 * j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

interface Coast {
    xy: Float64Array;
    halfU: number;
    halfV: number;
    noise: number;
}

function coastline(halfCellU: number, halfCellV: number, margin: number, samples: number, phases: readonly number[]): Coast {
    const a = halfCellU - margin;
    const b = halfCellV - margin;
    const r = CORNER * Math.min(a, b);
    const perimeter = 4 * (a - r) + 4 * (b - r) + 2 * Math.PI * r;
    const noise = COAST_NOISE * Math.min(a, b);
    const xy = new Float64Array(samples * 2);
    for (let i = 0; i < samples; i++) {
        const f = i / samples;
        const [x, y, nx, ny] = roundedRectAt(a, b, r, f * perimeter);
        let d = 0;
        COAST_HARMONICS.forEach(([h, w], k) => {
            d += w * Math.sin(2 * Math.PI * h * f + phases[k]);
        });
        d *= noise / HARMONIC_SUM;
        xy[2 * i] = x + nx * d;
        xy[2 * i + 1] = y + ny * d;
    }
    return { xy, halfU: a, halfV: b, noise };
}

/** Coastline samples: about one every 0.8° of arc, within sensible bounds. */
function coastSamples(halfCellU: number, halfCellV: number): number {
    const perimeter = 4 * (halfCellU + halfCellV);
    return Math.min(180, Math.max(72, Math.round(perimeter / 0.014)));
}

/**
 * The 22 continents in SOC order. Each is sized by its EP 2025 summary row
 * (through its treemap cell) and keeps exactly LAND_FRACTION of that cell.
 */
/** cos²(latitude) = 1 − sin²(latitude) = 1 − z²: how much shorter a unit of longitude is than a unit of z on the sphere. */
const globeXScale = (z: number) => 1 - z * z;

/** The five BLS job families' cells on the globe (equal-area coordinates); each holds its continents' cells exactly. */
export function layoutGlobeFamilies(): FamilyLayout[] {
    return familyTreemap(GLOBE_TREEMAP_BOUNDS, globeXScale).families;
}

export function layoutContinents(): GlobeContinent[] {
    const weights = INDEX_CONTINENTS.map((c) => c.ep.employment2025);
    const cells = familyTreemap(GLOBE_TREEMAP_BOUNDS, globeXScale).fields;
    return cells.map((cell, i) => {
        const code = INDEX_CONTINENTS[i].code;
        const lon = (cell.x0 + cell.x1) / 2;
        const sinLat = -(cell.z0 + cell.z1) / 2;
        const cosLat = Math.sqrt(1 - sinLat * sinLat);
        const halfCellU = ((cell.x1 - cell.x0) / 2) * cosLat;
        const halfCellV = (cell.z1 - cell.z0) / 2 / cosLat;
        const target = LAND_FRACTION * (cell.x1 - cell.x0) * (cell.z1 - cell.z0);
        const rand = mulberry32(Number(code) * 2654435761);
        const phases = COAST_HARMONICS.map(() => rand() * 2 * Math.PI);
        const samples = coastSamples(halfCellU, halfCellV);
        // The land shrinks as the margin grows: bisect for the margin whose
        // coastline encloses exactly the target area.
        let lo = 0;
        let hi = Math.min(halfCellU, halfCellV);
        for (let k = 0; k < 64; k++) {
            const mid = (lo + hi) / 2;
            if (polygonArea(coastline(halfCellU, halfCellV, mid, samples, phases).xy) > target) lo = mid;
            else hi = mid;
        }
        const margin = (lo + hi) / 2;
        const coast = coastline(halfCellU, halfCellV, margin, samples, phases);
        let reach = 0;
        for (let k = 0; k < coast.xy.length; k += 2) reach = Math.max(reach, Math.hypot(coast.xy[k], coast.xy[k + 1]));
        return {
            code,
            ep2025: weights[i],
            cell,
            lon,
            sinLat,
            cosLat,
            coast: coast.xy,
            margin,
            halfU: coast.halfU,
            halfV: coast.halfV,
            noise: coast.noise,
            reach,
        };
    });
}

export interface ContinentMesh {
    /** xyz per vertex, on the sphere of radius LAND_RADIUS. */
    positions: Float32Array;
    /** Continent index (SOC order) per vertex. */
    region: Float32Array;
    /** Distance to the coast per vertex, world units (drives the shoreline glow). */
    shore: Float32Array;
    index: Uint32Array;
    /** First triangle (index offset / 3) and triangle count of each continent, in SOC order. */
    ranges: Array<{ start: number; count: number }>;
}

/**
 * One merged mesh for all continents, drawn in a single call. Each continent
 * is a fan of rings from its centre out to its coastline, built in the local
 * frame and mapped onto the sphere, so the triangles follow its curvature.
 */
export function buildContinentMesh(continents: readonly GlobeContinent[], radius = LAND_RADIUS): ContinentMesh {
    const pos: number[] = [];
    const region: number[] = [];
    const shore: number[] = [];
    const index: number[] = [];
    const ranges: Array<{ start: number; count: number }> = [];
    continents.forEach((c, ci) => {
        const startTri = index.length / 3;
        const n = c.coast.length / 2;
        // About one ring per 4° of arc from the centre to the coast.
        const rings = Math.min(10, Math.max(3, Math.ceil(c.reach / 0.065)));
        const base = pos.length / 3;
        const push = (u: number, v: number, toCoast: number) => {
            const [lon, s] = localToLonSin(c, u, v);
            const [x, y, z] = unitVector(lon, s);
            pos.push(x * radius, y * radius, z * radius);
            region.push(ci);
            shore.push(toCoast * radius);
        };
        push(0, 0, Math.min(c.halfU, c.halfV));
        for (let k = 1; k <= rings; k++) {
            const f = k / rings;
            for (let i = 0; i < n; i++) {
                const u = c.coast[2 * i];
                const v = c.coast[2 * i + 1];
                push(u * f, v * f, (1 - f) * Math.hypot(u, v));
            }
        }
        const ring = (k: number, i: number) => base + 1 + (k - 1) * n + (i % n);
        for (let i = 0; i < n; i++) index.push(base, ring(1, i), ring(1, i + 1));
        for (let k = 1; k < rings; k++) {
            for (let i = 0; i < n; i++) {
                const a = ring(k, i);
                const b = ring(k, i + 1);
                const d = ring(k + 1, i);
                const e = ring(k + 1, i + 1);
                index.push(a, d, e, a, e, b);
            }
        }
        ranges.push({ start: startTri, count: index.length / 3 - startTri });
    });
    return {
        positions: new Float32Array(pos),
        region: new Float32Array(region),
        shore: new Float32Array(shore),
        index: new Uint32Array(index),
        ranges,
    };
}

/**
 * Area on the unit sphere of the geodesic triangles listed in `index`
 * (positions of any radius are projected onto the unit sphere first).
 * Van Oosterom & Strackee's formula for the solid angle of a triangle.
 */
export function sphericalTrianglesArea(positions: ArrayLike<number>, index: ArrayLike<number>, firstTri = 0, triCount = index.length / 3): number {
    let total = 0;
    const p = (i: number) => {
        const x = positions[3 * i];
        const y = positions[3 * i + 1];
        const z = positions[3 * i + 2];
        const l = Math.hypot(x, y, z);
        return [x / l, y / l, z / l] as const;
    };
    for (let t = firstTri; t < firstTri + triCount; t++) {
        const a = p(index[3 * t]);
        const b = p(index[3 * t + 1]);
        const c = p(index[3 * t + 2]);
        const triple = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const bc = b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
        const ca = c[0] * a[0] + c[1] * a[1] + c[2] * a[2];
        total += 2 * Math.atan2(Math.abs(triple), 1 + ab + bc + ca);
    }
    return total;
}

export interface GlobePeakPlacement {
    key: string;
    lon: number;
    sinLat: number;
    /** Footprint radius, world units (layout, not data). */
    radius: number;
}

/** Peaks inside a continent: the phase-2 even grid, laid out in the continent's local frame and mapped onto the sphere. */
export function layoutContinentPeaks(c: GlobeContinent, keys: readonly string[], radius = GLOBE_RADIUS): GlobePeakPlacement[] {
    // The grid's rectangle stays clear of the rounded corners' and the
    // wiggle's reach, so every peak stands on land.
    const inset = c.noise + 0.12 * CORNER * Math.min(c.halfU, c.halfV);
    const rect: Rect = {
        x0: -(c.halfU - inset) * radius,
        z0: -(c.halfV - inset) * radius,
        x1: (c.halfU - inset) * radius,
        z1: (c.halfV - inset) * radius,
    };
    return layoutRegionPeaks(rect, keys).map((p: PeakPlacement) => {
        const [lon, sinLat] = localToLonSin(c, p.x / radius, -p.z / radius);
        return { key: p.key, lon, sinLat, radius: p.radius };
    });
}

export interface GlobeLayout {
    /** The five BLS job families' cells (equal-area coordinates), in family order. */
    families: FamilyLayout[];
    continents: GlobeContinent[];
    continentByCode: Map<string, GlobeContinent>;
    peaksByContinent: Map<string, GlobePeakPlacement[]>;
}

export function buildGlobeLayout(entries: readonly RoleEntry[]): GlobeLayout {
    const continents = layoutContinents();
    const continentByCode = new Map(continents.map((c) => [c.code, c]));
    const keysByContinent = new Map<string, string[]>();
    for (const e of entries) {
        const list = keysByContinent.get(e.continent);
        if (list) list.push(e.key);
        else keysByContinent.set(e.continent, [e.key]);
    }
    const peaksByContinent = new Map<string, GlobePeakPlacement[]>();
    for (const c of continents) peaksByContinent.set(c.code, layoutContinentPeaks(c, keysByContinent.get(c.code) ?? []));
    return { families: layoutGlobeFamilies(), continents, continentByCode, peaksByContinent };
}

/** Continent whose land contains the point (longitude, sin latitude), or null for ocean. */
export function continentAt(continents: readonly GlobeContinent[], lon: number, sinLat: number): GlobeContinent | null {
    const z = -sinLat;
    for (const c of continents) {
        if (lon < c.cell.x0 || lon > c.cell.x1 || z < c.cell.z0 || z > c.cell.z1) continue;
        const [u, v] = lonSinToLocal(c, lon, sinLat);
        return pointInPolygon(c.coast, u, v) ? c : null;
    }
    return null;
}
