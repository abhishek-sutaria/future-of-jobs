/**
 * Where the 22 continents and their peaks sit on the terrain.
 *
 * Region SIZE is data: each region's area is proportional to its BLS
 * Employment Projections 2025 summary row (all workers, self-employed
 * included). Region POSITION and SHAPE are layout only, in two levels: an
 * ordered treemap of the five BLS job families (config/socFamilies.ts, SOC
 * User Guide Table 6), each sized by the sum of its fields' rows, then each
 * family's fields inside its block, in SOC order. So neighbours share a
 * family, and every rectangle stays close to square. Inside a region, each
 * SOC minor group gets its own block by the same treemap, sized by its number
 * of jobs, and its peaks sit on an even grid in SOC order; only their height
 * carries data. Families and fields are drawn from these same positions,
 * magnified (utils/stageMap), so this is the one layout for all three levels.
 *
 * Pure (no three.js, no DOM) so it can be unit-tested.
 */

import { INDEX_CONTINENTS, INDEX_OCCUPATION_BY_SOC } from './occupationIndex';
import { familyOf, SOC_FAMILIES, type SocFamily } from '../config/socFamilies';
import type { RoleEntry } from './roles';

export interface Rect {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

/** World-space rectangle the regions fill. The camera looks from +z toward -z, so SOC order reads left to right, far to near. */
export const WORLD_BOUNDS: Readonly<Rect> = { x0: -32, z0: -28, x1: 32, z1: 28 };

export const rectWidth = (r: Rect) => r.x1 - r.x0;
export const rectDepth = (r: Rect) => r.z1 - r.z0;
export const rectArea = (r: Rect) => rectWidth(r) * rectDepth(r);

const aspect = (w: number, h: number) => Math.max(w / h, h / w);

/**
 * Ordered treemap: rows of columns. The items are cut, in order, into rows
 * that span the full width; each row is cut into columns; a column stacks up
 * to MAX_STACK consecutive items. Both cuts are chosen by dynamic programming
 * to minimise the summed squared log aspect ratio, so every region stays close
 * to square without reordering anything. Reading order is row by row, column
 * by column, top to bottom (far to near).
 *
 * Every rectangle's area is exactly its share of the total weight: the layout
 * only decides where each region goes and what shape it has.
 *
 * `itemCost` scores item k drawn as a w × d rectangle; by default it is the
 * squared log aspect ratio. A family block passes the cost of laying its own
 * fields out inside that rectangle, so the blocks are shaped for what goes in
 * them.
 */
const MAX_STACK = 3;

const aspectCost = (w: number, d: number) => Math.log(aspect(w, d)) ** 2;

export function orderedTreemap(
    weights: readonly number[],
    bounds: Rect,
    itemCost: (k: number, w: number, d: number) => number = (_k, w, d) => aspectCost(w, d),
): Rect[] {
    const n = weights.length;
    const width = rectWidth(bounds);
    const total = weights.reduce((a, b) => a + b, 0);
    if (n === 0 || !(total > 0) || weights.some((w) => !(w > 0))) throw new Error('orderedTreemap needs positive weights');
    const areaPerUnit = rectArea(bounds) / total;
    const prefix = [0];
    for (const w of weights) prefix.push(prefix[prefix.length - 1] + w);
    const sum = (i: number, j: number) => prefix[j] - prefix[i];

    // Items i..j-1 stacked in one column of the given depth.
    const columnCost = (i: number, j: number, depth: number) => {
        const colWidth = (sum(i, j) * areaPerUnit) / depth;
        let c = 0;
        for (let k = i; k < j; k++) c += itemCost(k, colWidth, (weights[k] * areaPerUnit) / colWidth);
        return c;
    };

    // Best split of items i..j-1 (one row) into columns.
    const rowPlan = (i: number, j: number) => {
        const depth = (sum(i, j) * areaPerUnit) / width;
        const m = j - i;
        const best = [0, ...new Array<number>(m).fill(Infinity)];
        const prev = new Array<number>(m + 1).fill(0);
        for (let b = 1; b <= m; b++) {
            for (let a = Math.max(0, b - MAX_STACK); a < b; a++) {
                const c = best[a] + columnCost(i + a, i + b, depth);
                if (c < best[b]) {
                    best[b] = c;
                    prev[b] = a;
                }
            }
        }
        const cols: [number, number][] = [];
        for (let b = m; b > 0; b = prev[b]) cols.unshift([i + prev[b], i + b]);
        return { cost: best[m], cols, depth };
    };

    const best = [0, ...new Array<number>(n).fill(Infinity)];
    const prev = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
        for (let i = 0; i < j; i++) {
            const c = best[i] + rowPlan(i, j).cost;
            if (c < best[j]) {
                best[j] = c;
                prev[j] = i;
            }
        }
    }
    const rows: [number, number][] = [];
    for (let j = n; j > 0; j = prev[j]) rows.unshift([prev[j], j]);

    const rects: Rect[] = new Array(n);
    let z = bounds.z0;
    for (const [i, j] of rows) {
        const { cols, depth } = rowPlan(i, j);
        let x = bounds.x0;
        for (const [a, b] of cols) {
            const colWidth = (sum(a, b) * areaPerUnit) / depth;
            let zz = z;
            for (let k = a; k < b; k++) {
                const d = (weights[k] * areaPerUnit) / colWidth;
                rects[k] = { x0: x, z0: zz, x1: x + colWidth, z1: zz + d };
                zz += d;
            }
            x += colWidth;
        }
        z += depth;
    }
    return rects;
}

export interface RegionLayout {
    /** Two-digit SOC major code. */
    code: string;
    rect: Rect;
    cx: number;
    cz: number;
    /** EP 2025 summary-row employment that sized the region. */
    ep2025: number;
    /** BLS job family (SocFamily.id) the region sits in. */
    family: number;
}

export interface FamilyLayout {
    family: SocFamily;
    /** The block the family's regions tile exactly. */
    rect: Rect;
    /** Sum of its regions' EP 2025 summary rows. */
    ep2025: number;
    /** Its regions' SOC major codes, in SOC order. */
    codes: string[];
}

/** The five family blocks, in family order, sized by their fields' EP 2025 summary rows. */
export function layoutFamilies(bounds: Rect = WORLD_BOUNDS): FamilyLayout[] {
    const families = SOC_FAMILIES.map((family) => ({ family, ep2025: 0, codes: [] as string[] }));
    for (const c of INDEX_CONTINENTS) {
        const f = families[familyOf(c.code).id - 1];
        f.ep2025 += c.ep.employment2025;
        f.codes.push(c.code);
    }
    const used = families.filter((f) => f.codes.length > 0);
    const fieldWeights = used.map((f) => f.codes.map((code) => INDEX_CONTINENTS.find((c) => c.code === code)!.ep.employment2025));
    // A block is as good as the fields laid out inside it.
    const blockCost = (k: number, w: number, d: number) =>
        orderedTreemap(fieldWeights[k], { x0: 0, z0: 0, x1: w, z1: d }).reduce((c, r) => c + aspectCost(rectWidth(r), rectDepth(r)), 0);
    return orderedTreemap(used.map((f) => f.ep2025), bounds, blockCost).map((rect, i) => ({ ...used[i], rect }));
}

/**
 * The 22 regions, in SOC order, sized by their EP 2025 summary rows: each
 * family block is cut, by the same ordered treemap, among its own fields.
 * A field's area is its share of the family times the family's share of the
 * world, which is its share of the world.
 */
export function layoutRegions(bounds: Rect = WORLD_BOUNDS): RegionLayout[] {
    const byCode = new Map(INDEX_CONTINENTS.map((c) => [c.code, c]));
    const out = new Map<string, RegionLayout>();
    for (const f of layoutFamilies(bounds)) {
        const weights = f.codes.map((code) => byCode.get(code)!.ep.employment2025);
        orderedTreemap(weights, f.rect).forEach((rect, i) => {
            const code = f.codes[i];
            out.set(code, { code, rect, cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, ep2025: weights[i], family: f.family.id });
        });
    }
    return INDEX_CONTINENTS.map((c) => out.get(c.code)!);
}

export interface PeakPlacement {
    key: string;
    x: number;
    z: number;
    /** Footprint radius of the peak (layout, not data). */
    radius: number;
}

/** A SOC minor group's block inside its field: its own rectangle, its jobs in SOC order. */
export interface MinorGroupLayout {
    /** Two-digit SOC major code of the field. */
    code: string;
    /** SOC minor group code, e.g. "51-4000". */
    minor: string;
    /** Official BLS title of the minor group. */
    title: string;
    rect: Rect;
    keys: string[];
}

/** Jobs stand at least this far inside their field's edge, so neighbouring fields' peaks never touch. */
export const REGION_INSET = 0.5;
/** Neighbouring peaks overlap a little so a region reads as one landscape, not a pin board. */
const PEAK_OVERLAP = 1.3;
const PEAK_RADIUS_MAX = 3;

/** The even grid for n jobs in a w x d rectangle: closest to square cells, with as few empty ones as possible. */
function bestGrid(n: number, w: number, d: number): { cols: number; rows: number; score: number } {
    let best = { cols: 1, rows: n, score: Infinity };
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const score = aspect(w / cols, d / rows) + (rows * cols - n) / n;
        if (score < best.score) best = { cols, rows, score };
    }
    return best;
}

/** Even grid inside the rectangle, row by row in the given order; the last row is centred. */
function gridPeaks(rect: Rect, keys: readonly string[]): PeakPlacement[] {
    const n = keys.length;
    if (n === 0) return [];
    const w = Math.max(0.1, rectWidth(rect));
    const d = Math.max(0.1, rectDepth(rect));
    const grid = bestGrid(n, w, d);
    const cw = w / grid.cols;
    const cd = d / grid.rows;
    const radius = Math.min(PEAK_RADIUS_MAX, 0.5 * Math.min(cw, cd) * PEAK_OVERLAP);

    return keys.map((key, i) => {
        const row = Math.floor(i / grid.cols);
        const inRow = row === grid.rows - 1 ? n - row * grid.cols : grid.cols;
        const col = i - row * grid.cols;
        const rowOffset = ((grid.cols - inRow) * cw) / 2;
        return {
            key,
            x: rect.x0 + rowOffset + (col + 0.5) * cw,
            z: rect.z0 + (row + 0.5) * cd,
            radius,
        };
    });
}

/**
 * A field's jobs, grouped so related jobs sit together: each SOC minor group
 * gets its own block, cut from the field (inset by REGION_INSET) by the same
 * ordered treemap as the families and fields, sized by its number of jobs.
 * Inside a block its jobs stand on an even grid in SOC order. Each block is
 * shaped for the grid it holds, so cells stay close to square.
 *
 * `groups` are the field's minor groups in SOC order, each with its jobs'
 * keys in SOC order; empty groups are left out.
 */
export function layoutRegionPeaks(
    region: Rect,
    groups: readonly { minor: string; title: string; keys: readonly string[] }[],
    code = '',
): { groups: MinorGroupLayout[]; peaks: PeakPlacement[] } {
    const filled = groups.filter((g) => g.keys.length > 0);
    if (filled.length === 0) return { groups: [], peaks: [] };
    const inner: Rect = {
        x0: region.x0 + REGION_INSET,
        z0: region.z0 + REGION_INSET,
        x1: Math.max(region.x0 + REGION_INSET + 0.1, region.x1 - REGION_INSET),
        z1: Math.max(region.z0 + REGION_INSET + 0.1, region.z1 - REGION_INSET),
    };
    const counts = filled.map((g) => g.keys.length);
    const gridCost = (k: number, w: number, d: number) => {
        const grid = bestGrid(counts[k], w, d);
        return Math.log(aspect(w / grid.cols, d / grid.rows)) ** 2 + (grid.rows * grid.cols - counts[k]) / counts[k];
    };
    const rects = orderedTreemap(counts, inner, gridCost);
    const out = filled.map((g, i): MinorGroupLayout => ({ code, minor: g.minor, title: g.title, rect: rects[i], keys: [...g.keys] }));
    return { groups: out, peaks: out.flatMap((g) => gridPeaks(g.rect, g.keys)) };
}

/** A field's entries as its minor groups, in SOC order. Entries arrive in SOC order (buildRoleEntries). */
export function minorGroupsOf(code: string, entries: readonly Pick<RoleEntry, 'key' | 'soc'>[]): { minor: string; title: string; keys: string[] }[] {
    const minors = INDEX_CONTINENTS.find((c) => c.code === code)?.minorGroups ?? [];
    const groups = minors.map((m) => ({ minor: m.soc, title: m.title, keys: [] as string[] })).sort((a, b) => a.minor.localeCompare(b.minor));
    const byMinor = new Map(groups.map((g) => [g.minor, g]));
    for (const e of entries) {
        const minor = INDEX_OCCUPATION_BY_SOC.get(e.soc)?.minor;
        const group = minor ? byMinor.get(minor) : undefined;
        if (!group) throw new Error(`${e.soc} is in none of field ${code}'s minor groups`);
        group.keys.push(e.key);
    }
    return groups.filter((g) => g.keys.length > 0);
}

export interface WorldLayout {
    families: FamilyLayout[];
    regions: RegionLayout[];
    regionByCode: Map<string, RegionLayout>;
    /** Each field's minor-group blocks, in SOC order. */
    minorGroupsByContinent: Map<string, MinorGroupLayout[]>;
    /** Peaks per continent code, in SOC order. */
    peaksByContinent: Map<string, PeakPlacement[]>;
    peakByKey: Map<string, PeakPlacement & { continent: string; minor: string }>;
}

export function buildWorldLayout(entries: readonly RoleEntry[], bounds: Rect = WORLD_BOUNDS): WorldLayout {
    const families = layoutFamilies(bounds);
    const regions = layoutRegions(bounds);
    const regionByCode = new Map(regions.map((r) => [r.code, r]));
    const entriesByContinent = new Map<string, RoleEntry[]>();
    for (const e of entries) {
        const list = entriesByContinent.get(e.continent);
        if (list) list.push(e);
        else entriesByContinent.set(e.continent, [e]);
    }
    const minorGroupsByContinent = new Map<string, MinorGroupLayout[]>();
    const peaksByContinent = new Map<string, PeakPlacement[]>();
    const peakByKey = new Map<string, PeakPlacement & { continent: string; minor: string }>();
    for (const region of regions) {
        const { groups, peaks } = layoutRegionPeaks(region.rect, minorGroupsOf(region.code, entriesByContinent.get(region.code) ?? []), region.code);
        minorGroupsByContinent.set(region.code, groups);
        peaksByContinent.set(region.code, peaks);
        const minorOf = new Map(groups.flatMap((g) => g.keys.map((k) => [k, g.minor] as const)));
        for (const p of peaks) peakByKey.set(p.key, { ...p, continent: region.code, minor: minorOf.get(p.key)! });
    }
    return { families, regions, regionByCode, minorGroupsByContinent, peaksByContinent, peakByKey };
}

/** Region whose rectangle contains the world point, or null. */
export function regionAt(regions: readonly RegionLayout[], x: number, z: number): RegionLayout | null {
    for (const r of regions) {
        if (x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1) return r;
    }
    return null;
}
