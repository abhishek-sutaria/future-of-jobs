/**
 * Where the 22 continents and their peaks sit on the terrain.
 *
 * Region SIZE is data: each region's area is proportional to its BLS
 * Employment Projections 2025 summary row (all workers, self-employed
 * included). Region POSITION and SHAPE are layout only, in two levels: an
 * ordered treemap of the five BLS job families (config/socFamilies.ts, SOC
 * User Guide Table 6), each sized by the sum of its fields' rows, then each
 * family's fields inside its block, in SOC order. So neighbours share a
 * family, and every rectangle stays close to square. Inside a region, peaks
 * sit on an even grid in SOC order; only their height carries data.
 *
 * Pure (no three.js, no DOM) so it can be unit-tested.
 */

import { INDEX_CONTINENTS } from './occupationIndex';
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
 * `itemCost` (TreemapOptions) scores item k drawn as a cell; by default it is
 * the squared log aspect ratio. A family block passes the cost of laying its
 * own fields out inside that cell, so the blocks are shaped for what goes in
 * them.
 */
const MAX_STACK = 3;

export interface TreemapOptions {
    /**
     * How long one unit of x is, relative to one unit of z, at depth z
     * (default 1). Only the aspect-ratio cost reads it, so it changes which
     * cuts are chosen, never any area. The globe passes cos²(latitude): in
     * equal-area coordinates a cell near a pole is narrower and taller on the
     * sphere than it looks in the plane.
     */
    xScaleAt?: (z: number) => number;
    /**
     * Cost of item k drawn as `cell` (its x0 is not meaningful, only its size
     * and depth). Default: the squared log aspect ratio, x scaled by xScaleAt.
     */
    itemCost?: (k: number, cell: Rect) => number;
}

/** Squared log aspect ratio of a cell, with x scaled by xScaleAt at the cell's middle depth. */
export function cellAspectCost(cell: Rect, xScaleAt: (z: number) => number = () => 1): number {
    return Math.log(aspect(rectWidth(cell) * xScaleAt((cell.z0 + cell.z1) / 2), rectDepth(cell))) ** 2;
}

export function orderedTreemap(weights: readonly number[], bounds: Rect, opts: TreemapOptions = {}): Rect[] {
    const n = weights.length;
    const width = rectWidth(bounds);
    const total = weights.reduce((a, b) => a + b, 0);
    if (n === 0 || !(total > 0) || weights.some((w) => !(w > 0))) throw new Error('orderedTreemap needs positive weights');
    const areaPerUnit = rectArea(bounds) / total;
    const prefix = [0];
    for (const w of weights) prefix.push(prefix[prefix.length - 1] + w);
    const sum = (i: number, j: number) => prefix[j] - prefix[i];
    const xScaleAt = opts.xScaleAt ?? (() => 1);
    const itemCost = opts.itemCost ?? ((_k: number, cell: Rect) => cellAspectCost(cell, xScaleAt));

    // Items i..j-1 stacked in one column of the given depth, from z0 down.
    const columnCost = (i: number, j: number, depth: number, z0: number) => {
        const colWidth = (sum(i, j) * areaPerUnit) / depth;
        let c = 0;
        let z = z0;
        for (let k = i; k < j; k++) {
            const d = (weights[k] * areaPerUnit) / colWidth;
            c += itemCost(k, { x0: 0, z0: z, x1: colWidth, z1: z + d });
            z += d;
        }
        return c;
    };

    // Best split of items i..j-1 (one row) into columns. Rows span the full
    // width, so a row starting at item i always starts at the same depth.
    const rowPlan = (i: number, j: number) => {
        const depth = (sum(i, j) * areaPerUnit) / width;
        const z0 = bounds.z0 + (sum(0, i) * areaPerUnit) / width;
        const m = j - i;
        const best = [0, ...new Array<number>(m).fill(Infinity)];
        const prev = new Array<number>(m + 1).fill(0);
        for (let b = 1; b <= m; b++) {
            for (let a = Math.max(0, b - MAX_STACK); a < b; a++) {
                const c = best[a] + columnCost(i + a, i + b, depth, z0);
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

/**
 * Two-level ordered treemap: the five family blocks, sized by their fields'
 * EP 2025 summary rows, then each block cut among its own fields in SOC
 * order. A field's area is its share of the family times the family's share
 * of the whole, which is its share of the whole. `xScaleAt` is the treemap's
 * (the globe's latitude correction), applied at both levels.
 *
 * Returns the family blocks in family order and the field cells in SOC order
 * (INDEX_CONTINENTS order).
 */
export function familyTreemap(bounds: Rect, xScaleAt?: (z: number) => number): { families: FamilyLayout[]; fields: Rect[] } {
    const families = SOC_FAMILIES.map((family) => ({ family, ep2025: 0, codes: [] as string[], weights: [] as number[] }));
    for (const c of INDEX_CONTINENTS) {
        const f = families[familyOf(c.code).id - 1];
        f.ep2025 += c.ep.employment2025;
        f.codes.push(c.code);
        f.weights.push(c.ep.employment2025);
    }
    const used = families.filter((f) => f.codes.length > 0);
    // A block is as good as the fields laid out inside it.
    const fieldsIn = (k: number, cell: Rect) => orderedTreemap(used[k].weights, cell, { xScaleAt });
    const blockCost = (k: number, cell: Rect) => fieldsIn(k, cell).reduce((c, r) => c + cellAspectCost(r, xScaleAt), 0);
    const blocks = orderedTreemap(used.map((f) => f.ep2025), bounds, { xScaleAt, itemCost: blockCost });
    const byCode = new Map<string, Rect>();
    blocks.forEach((rect, k) => fieldsIn(k, rect).forEach((cell, i) => byCode.set(used[k].codes[i], cell)));
    return {
        families: used.map(({ family, ep2025, codes }, k) => ({ family, ep2025, codes, rect: blocks[k] })),
        fields: INDEX_CONTINENTS.map((c) => byCode.get(c.code)!),
    };
}

/** The five family blocks, in family order, sized by their fields' EP 2025 summary rows. */
export function layoutFamilies(bounds: Rect = WORLD_BOUNDS): FamilyLayout[] {
    return familyTreemap(bounds).families;
}

/** The 22 regions, in SOC order, sized by their EP 2025 summary rows, inside their family blocks (familyTreemap). */
export function layoutRegions(bounds: Rect = WORLD_BOUNDS): RegionLayout[] {
    const { fields } = familyTreemap(bounds);
    return INDEX_CONTINENTS.map((c, i) => {
        const rect = fields[i];
        return {
            code: c.code,
            rect,
            cx: (rect.x0 + rect.x1) / 2,
            cz: (rect.z0 + rect.z1) / 2,
            ep2025: c.ep.employment2025,
            family: familyOf(c.code).id,
        };
    });
}

export interface PeakPlacement {
    key: string;
    x: number;
    z: number;
    /** Footprint radius of the peak (layout, not data). */
    radius: number;
}

const REGION_INSET = 0.5;
/** Neighbouring peaks overlap a little so a region reads as one landscape, not a pin board. */
const PEAK_OVERLAP = 1.3;
const PEAK_RADIUS_MAX = 3;

/** Even grid inside the region, row by row in SOC order; the last row is centred. */
export function layoutRegionPeaks(region: Rect, keys: readonly string[]): PeakPlacement[] {
    const n = keys.length;
    if (n === 0) return [];
    const w = Math.max(0.1, rectWidth(region) - 2 * REGION_INSET);
    const d = Math.max(0.1, rectDepth(region) - 2 * REGION_INSET);

    let best = { cols: 1, rows: n, score: Infinity };
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const score = aspect(w / cols, d / rows) + (rows * cols - n) / n;
        if (score < best.score) best = { cols, rows, score };
    }
    const cw = w / best.cols;
    const cd = d / best.rows;
    const radius = Math.min(PEAK_RADIUS_MAX, 0.5 * Math.min(cw, cd) * PEAK_OVERLAP);

    return keys.map((key, i) => {
        const row = Math.floor(i / best.cols);
        const inRow = row === best.rows - 1 ? n - row * best.cols : best.cols;
        const col = i - row * best.cols;
        const rowOffset = ((best.cols - inRow) * cw) / 2;
        return {
            key,
            x: region.x0 + REGION_INSET + rowOffset + (col + 0.5) * cw,
            z: region.z0 + REGION_INSET + (row + 0.5) * cd,
            radius,
        };
    });
}

export interface WorldLayout {
    families: FamilyLayout[];
    regions: RegionLayout[];
    regionByCode: Map<string, RegionLayout>;
    /** Peaks per continent code, in SOC order. */
    peaksByContinent: Map<string, PeakPlacement[]>;
    peakByKey: Map<string, PeakPlacement & { continent: string }>;
}

export function buildWorldLayout(entries: readonly RoleEntry[], bounds: Rect = WORLD_BOUNDS): WorldLayout {
    const families = layoutFamilies(bounds);
    const regions = layoutRegions(bounds);
    const regionByCode = new Map(regions.map((r) => [r.code, r]));
    const keysByContinent = new Map<string, string[]>();
    for (const e of entries) {
        const list = keysByContinent.get(e.continent);
        if (list) list.push(e.key);
        else keysByContinent.set(e.continent, [e.key]);
    }
    const peaksByContinent = new Map<string, PeakPlacement[]>();
    const peakByKey = new Map<string, PeakPlacement & { continent: string }>();
    for (const region of regions) {
        const peaks = layoutRegionPeaks(region.rect, keysByContinent.get(region.code) ?? []);
        peaksByContinent.set(region.code, peaks);
        for (const p of peaks) peakByKey.set(p.key, { ...p, continent: region.code });
    }
    return { families, regions, regionByCode, peaksByContinent, peakByKey };
}

/** Region whose rectangle contains the world point, or null. */
export function regionAt(regions: readonly RegionLayout[], x: number, z: number): RegionLayout | null {
    for (const r of regions) {
        if (x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1) return r;
    }
    return null;
}
