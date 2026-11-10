/**
 * Bakes a stage into textures the terrain mesh displaces itself from: the live
 * Terrain.tsx surface, minus its 50-peak uniform limit, so a stage of 8 jobs and
 * one of 378 go down the same pipeline. The textures cover the stage's own
 * rectangle, texel for vertex, so the mesh ends exactly on its edge.
 *
 * Two height layers, 2025 and 2035, on one fixed scale for the stage: the largest
 * employment on the path across its jobs reaches the live view's tallest hill, the
 * same rule the whole map uses. So every hill rises or falls with its own BLS
 * number, and one in 2025 may sit a little under full height. Moving the slider
 * only mixes the two layers in the shader, so it costs one uniform at any job
 * count. Colour does not depend on the year and is baked once.
 *
 * Pure: arrays in, arrays out. Gaussians are separable, so each job costs one
 * exp per row and column of its window, not one per texel.
 */

import { SHADER, YEAR_MAX, YEAR_MIN } from '../config/constants';
import type { Stage, StageJob } from './stageLayout';
import { rectDepth, rectWidth, type Rect } from './worldLayout';

/** Live Terrain.tsx: height clamp at the top of the range, times its height scale. */
export const STAGE_MIN_HEIGHT = SHADER.HEIGHT_CLAMP_MIN * SHADER.HEIGHT_SCALE;
export const STAGE_PEAK_HEIGHT = SHADER.HEIGHT_CLAMP_MAX * SHADER.HEIGHT_SCALE;
/** Colour of bare ground, where no job's colour reaches (SHADER_COLORS.TERRAIN_DEFAULT). */
const BARE_GROUND = [0.05, 0.1, 0.2] as const;
/** Below this summed weight the live shader falls back to bare ground. */
const MIN_COLOR_WEIGHT = 0.001;
/** Emphasis of a job the Kelley or school filter leaves out, as on the world map. */
export const STAGE_DIM_EMPHASIS = 0.22;
/** A hill's height is negligible this many sigmas out. */
const HEIGHT_REACH = 3.6;
/** Live colour weights use twice the height's variance; past this many sigmas their sum is under MIN_COLOR_WEIGHT. */
const COLOR_REACH = 5.3;

export type StageBlend = 'sum' | 'smoothmax';

/**
 * How overlapping hills combine. The live shader adds them, which is fine at 50
 * jobs. On the densest stage (Management, Business, Science & Arts, 378 peaks)
 * adding inflates the median job to more than twice its height, and clearly
 * smaller jobs stand taller than larger neighbours. Smooth max at power 2 keeps
 * jobs near their own height and every stage's top at the live 12.5. A higher
 * power is truer still but cuts every hill apart, so small hills read as a
 * field of dots rather than a landscape. A lone hill is the same either way.
 */
export const STAGE_BLEND: StageBlend = 'smoothmax';
export const STAGE_BLEND_POWER = 2;
/** The most a packed height can hold, in world units. Nothing bakes near it: smooth max tops out at the peak height. */
export const STAGE_HEIGHT_RANGE = 16;

export interface StageBake {
    /** The stage rectangle the textures cover, in stage units. */
    rect: Rect;
    /** Vertices along x (columns) and along z (rows), and texels along each side of each texture. */
    cols: number;
    rows: number;
    /** Height at 2025 then 2035, in world units, for each texel. Row 0 is the near (+z) edge, as the mesh's v = 0. */
    heights: Float32Array;
    /** Blended colour (RGB) and filter emphasis (A: Kelley and/or school filter), 0 to 255, for each texel. */
    colors: Uint8Array;
}

/**
 * The stage's fixed height scale: the largest employment any of its jobs reaches
 * on the 2025 to 2035 path. Each job's path is a straight line, so that is at one
 * end of it. One value for both baked layers, and so for pins and labels too.
 */
export function stageMaxEmployment(jobs: readonly StageJob[]): number {
    return jobs.reduce((max, j) => Math.max(max, j.ep2025, j.ep2035), 0);
}

/** A job's hill height along the path (0 = 2025, 1 = 2035): the live linear formula, on the stage's fixed scale. */
export function stageJobHeight(job: StageJob, atYear: number, maxEmployment: number): number {
    const employment = job.ep2025 + (job.ep2035 - job.ep2025) * atYear;
    const share = maxEmployment > 0 ? Math.max(0, employment) / maxEmployment : 0;
    return STAGE_MIN_HEIGHT + share * (STAGE_PEAK_HEIGHT - STAGE_MIN_HEIGHT);
}

/**
 * Mesh segments along each side of a stage: the long side gets `longSide` and
 * the short side its share, so texels are square and a hill is round.
 */
export function stageSegments(rect: Rect, longSide: number): { x: number; z: number } {
    const w = rectWidth(rect);
    const d = rectDepth(rect);
    const long = Math.max(w, d);
    return { x: Math.max(8, Math.round((longSide * w) / long)), z: Math.max(8, Math.round((longSide * d) / long)) };
}

/** Stage x of column `col`, and stage z of row `row` (row 0 at the near edge, z1). */
const columnX = (rect: Rect, cols: number, col: number) => rect.x0 + (col / (cols - 1)) * rectWidth(rect);
const rowZ = (rect: Rect, rows: number, row: number) => rect.z1 - (row / (rows - 1)) * rectDepth(rect);

/** Gaussian falloff along one axis of a job's window, written into `out`. */
function falloff(center: number, first: number, last: number, at: (i: number) => number, twoVariance: number, out: Float32Array): void {
    for (let i = first; i <= last; i++) {
        const d = at(i) - center;
        out[i] = Math.exp(-(d * d) / twoVariance);
    }
}

/** First and last index within `reach` of `center` on an axis from `start` with `step` per index (step may be negative). */
function window1D(center: number, reach: number, start: number, step: number, count: number): [number, number] {
    const a = (center - reach - start) / step;
    const b = (center + reach - start) / step;
    return [Math.max(0, Math.ceil(Math.min(a, b))), Math.min(count - 1, Math.floor(Math.max(a, b)))];
}

/**
 * The surface for one year. `sum` adds neighbouring hills, as the live shader
 * does; `smoothmax` lets the taller hill win where they overlap, by summing
 * heights to the power `power` and taking the root.
 */
function bakeLayer(jobs: readonly StageJob[], bake: Omit<StageBake, 'heights' | 'colors'>, atYear: number, blend: StageBlend, power: number, out: Float32Array, offset: number): void {
    const { rect, cols, rows } = bake;
    const maxEmployment = stageMaxEmployment(jobs);
    const stepX = rectWidth(rect) / (cols - 1);
    const stepZ = -rectDepth(rect) / (rows - 1);
    const across = new Float32Array(cols);
    const along = new Float32Array(rows);
    const sum = new Float32Array(cols * rows);
    const atX = (i: number) => columnX(rect, cols, i);
    const atZ = (i: number) => rowZ(rect, rows, i);
    for (const job of jobs) {
        const reach = job.sigma * HEIGHT_REACH;
        const twoVariance = (2 * job.sigma * job.sigma) / (blend === 'sum' ? 1 : power);
        const height = stageJobHeight(job, atYear, maxEmployment);
        const amount = blend === 'sum' ? height : height ** power;
        const [x0, x1] = window1D(job.x, reach, rect.x0, stepX, cols);
        const [y0, y1] = window1D(job.z, reach, rect.z1, stepZ, rows);
        falloff(job.x, x0, x1, atX, twoVariance, across);
        falloff(job.z, y0, y1, atZ, twoVariance, along);
        for (let y = y0; y <= y1; y++) {
            const row = y * cols;
            const inRow = amount * along[y];
            for (let x = x0; x <= x1; x++) sum[row + x] += inRow * across[x];
        }
    }
    for (let i = 0; i < sum.length; i++) out[i * 2 + offset] = blend === 'sum' ? sum[i] : sum[i] ** (1 / power);
}

/** Which jobs keep full colour while a filter is on. Before the school filter it was always the Kelley roles. */
export type StageEmphasis = (job: StageJob) => boolean;
const kelleyEmphasis: StageEmphasis = (job) => job.kelley;

function bakeColors(jobs: readonly StageJob[], bake: Omit<StageBake, 'heights' | 'colors'>, out: Uint8Array, emphasized: StageEmphasis): void {
    const { rect, cols, rows } = bake;
    const count = cols * rows;
    const r = new Float32Array(count);
    const g = new Float32Array(count);
    const b = new Float32Array(count);
    const emphasis = new Float32Array(count);
    const total = new Float32Array(count);
    const stepX = rectWidth(rect) / (cols - 1);
    const stepZ = -rectDepth(rect) / (rows - 1);
    const across = new Float32Array(cols);
    const along = new Float32Array(rows);
    const atX = (i: number) => columnX(rect, cols, i);
    const atZ = (i: number) => rowZ(rect, rows, i);
    for (const job of jobs) {
        const reach = job.sigma * COLOR_REACH;
        const twoVariance = 4 * job.sigma * job.sigma;
        const [x0, x1] = window1D(job.x, reach, rect.x0, stepX, cols);
        const [y0, y1] = window1D(job.z, reach, rect.z1, stepZ, rows);
        falloff(job.x, x0, x1, atX, twoVariance, across);
        falloff(job.z, y0, y1, atZ, twoVariance, along);
        const [cr, cg, cb] = job.color;
        const shine = emphasized(job) ? 1 : STAGE_DIM_EMPHASIS;
        for (let y = y0; y <= y1; y++) {
            const row = y * cols;
            for (let x = x0; x <= x1; x++) {
                const w = along[y] * across[x];
                const i = row + x;
                r[i] += cr * w;
                g[i] += cg * w;
                b[i] += cb * w;
                emphasis[i] += shine * w;
                total[i] += w;
            }
        }
    }
    for (let i = 0; i < count; i++) {
        const w = total[i];
        const bare = w < MIN_COLOR_WEIGHT;
        out[i * 4] = Math.round(255 * (bare ? BARE_GROUND[0] : r[i] / w));
        out[i * 4 + 1] = Math.round(255 * (bare ? BARE_GROUND[1] : g[i] / w));
        out[i * 4 + 2] = Math.round(255 * (bare ? BARE_GROUND[2] : b[i] / w));
        out[i * 4 + 3] = Math.round(255 * (bare ? STAGE_DIM_EMPHASIS : emphasis[i] / w));
    }
}

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/**
 * How much of the surface stands at a point: 0 on the stage's edge, 1 from
 * `band` inside it. The band is the strip REGION_INSET leaves empty round every
 * field, magnified, so the hills come down to the ground at a clean edge and no
 * job's own height is touched.
 */
export function stageEdgeTaper(rect: Rect, band: number, x: number, z: number): number {
    const edge = Math.min(x - rect.x0, rect.x1 - x, z - rect.z0, rect.z1 - z);
    return band > 0 ? smoothstep(0, band, edge) : 1;
}

export function bakeStage(
    stage: Pick<Stage, 'jobs' | 'outline'>,
    segments: { x: number; z: number },
    blend: StageBlend,
    power: number,
    edgeBand = 0,
    emphasized: StageEmphasis = kelleyEmphasis,
): StageBake {
    const shape = { rect: stage.outline, cols: segments.x + 1, rows: segments.z + 1 };
    const heights = new Float32Array(shape.cols * shape.rows * 2);
    const colors = new Uint8Array(shape.cols * shape.rows * 4);
    bakeLayer(stage.jobs, shape, 0, blend, power, heights, 0);
    bakeLayer(stage.jobs, shape, 1, blend, power, heights, 1);
    if (edgeBand > 0) {
        for (let row = 0; row < shape.rows; row++) {
            const z = rowZ(shape.rect, shape.rows, row);
            for (let col = 0; col < shape.cols; col++) {
                const k = stageEdgeTaper(shape.rect, edgeBand, columnX(shape.rect, shape.cols, col), z);
                if (k >= 1) continue;
                const i = (row * shape.cols + col) * 2;
                heights[i] *= k;
                heights[i + 1] *= k;
            }
        }
    }
    bakeColors(stage.jobs, shape, colors, emphasized);
    return { ...shape, heights, colors };
}

/**
 * Re-bakes only the colour texture's emphasis (and colour, which does not
 * change) in place, for a filter that changed while the stage is up. Heights
 * are untouched, so nothing moves.
 */
export function rebakeStageColors(stage: Pick<Stage, 'jobs'>, bake: StageBake, emphasized: StageEmphasis): void {
    bakeColors(stage.jobs, bake, bake.colors, emphasized);
}

/** Two 16-bit heights in the four 8-bit channels of each texel, for a GPU that cannot read float textures in a vertex shader. */
export function packHeights(heights: Float32Array): Uint8Array {
    const out = new Uint8Array(heights.length * 2);
    for (let i = 0; i < heights.length; i++) {
        const value = Math.round((Math.min(STAGE_HEIGHT_RANGE, Math.max(0, heights[i])) / STAGE_HEIGHT_RANGE) * 65535);
        out[i * 2] = value >> 8;
        out[i * 2 + 1] = value & 255;
    }
    return out;
}

/** Where a view ray meets the surface. Marches down from above the tallest hill; null if it misses the disc. */
export function rayToSurface(
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
    groundY: number,
    height: (x: number, z: number) => number,
): { x: number; z: number } | null {
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    if (dy >= 0) return null;
    const top = groundY + STAGE_PEAK_HEIGHT + 1;
    const start = oy > top ? (top - oy) / dy : 0;
    const end = (groundY - oy) / dy;
    const steps = 48;
    let previous = start;
    for (let i = 0; i <= steps; i++) {
        const t = start + ((end - start) * i) / steps;
        const x = ox + dx * t;
        const z = oz + dz * t;
        if (oy + dy * t <= groundY + height(x, z)) {
            // Between the last point above the surface and this one below it.
            const mid = (previous + t) / 2;
            return { x: ox + dx * mid, z: oz + dz * mid };
        }
        previous = t;
    }
    return { x: ox + dx * end, z: oz + dz * end };
}

/** How far through the 2025 to 2035 path a slider year is. */
export const yearMix = (year: number): number => Math.max(0, Math.min(1, (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)));

/** The drawn surface at a stage point, in world units above the ground. What pins stand on. */
export function surfaceHeight(bake: StageBake, x: number, z: number, mix: number): number {
    const { rect, cols, rows, heights } = bake;
    const cx = Math.max(0, Math.min(cols - 1.001, ((x - rect.x0) / rectWidth(rect)) * (cols - 1)));
    const cy = Math.max(0, Math.min(rows - 1.001, ((rect.z1 - z) / rectDepth(rect)) * (rows - 1)));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const at = (col: number, row: number) => {
        const i = (row * cols + col) * 2;
        return heights[i] + (heights[i + 1] - heights[i]) * mix;
    };
    const near = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const far = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return near + (far - near) * fy;
}
