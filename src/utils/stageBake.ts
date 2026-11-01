/**
 * Bakes a stage into textures the terrain mesh displaces itself from: the live
 * Terrain.tsx surface, minus its 50-peak uniform limit, so a stage of 8 jobs and
 * one of 375 go down the same pipeline.
 *
 * Two height layers, 2025 and 2035, each already scaled so that year's largest
 * job reaches the live view's tallest hill. Moving the slider only mixes the two
 * in the shader, so it costs one uniform at any job count. Colour does not
 * depend on the year and is baked once.
 *
 * Pure: arrays in, arrays out. Gaussians are separable, so each job costs one
 * exp per row and column of its window, not one per texel.
 */

import { SCENE, SHADER, YEAR_MAX, YEAR_MIN } from '../config/constants';
import type { Stage, StageJob } from './stageLayout';

/** Live Terrain.tsx: height clamp at the top of the range, times its height scale. */
export const STAGE_MIN_HEIGHT = SHADER.HEIGHT_CLAMP_MIN * SHADER.HEIGHT_SCALE;
export const STAGE_PEAK_HEIGHT = SHADER.HEIGHT_CLAMP_MAX * SHADER.HEIGHT_SCALE;
/** Colour of bare ground, where no job's colour reaches (SHADER_COLORS.TERRAIN_DEFAULT). */
const BARE_GROUND = [0.05, 0.1, 0.2] as const;
/** Below this summed weight the live shader falls back to bare ground. */
const MIN_COLOR_WEIGHT = 0.001;
/** Emphasis of a non-Kelley job under the Kelley filter, as on the world map. */
export const STAGE_DIM_EMPHASIS = 0.22;
/** A hill's height is negligible this many sigmas out. */
const HEIGHT_REACH = 3.6;
/** Live colour weights use twice the height's variance; past this many sigmas their sum is under MIN_COLOR_WEIGHT. */
const COLOR_REACH = 5.3;

export type StageBlend = 'sum' | 'smoothmax';

/**
 * How overlapping hills combine. The live shader adds them, which is fine at 50
 * jobs. On the densest stage (Management family, 378 peaks) adding inflates the
 * median job to 2.09 times its height, and clearly smaller jobs stand taller than
 * larger neighbours in 139 of 882 neighbouring pairs. Smooth max at power 2
 * brings those to 1.13 and 71, and keeps the valleys soft: a higher power is
 * truer still (1.00 and 49 at 4) but cuts every hill apart, and small hills read
 * as a field of dots rather than a landscape. A lone hill is the same either way.
 */
export const STAGE_BLEND: StageBlend = 'smoothmax';
export const STAGE_BLEND_POWER = 2;
/** The most a packed height can hold, in world units. Nothing bakes near it: smooth max tops out at the peak height. */
export const STAGE_HEIGHT_RANGE = 16;

export interface StageBake {
    /** Vertices along one side of the mesh, and texels along one side of each texture. */
    size: number;
    /** Height at 2025 then 2035, in world units, for each texel. */
    heights: Float32Array;
    /** Blended colour (RGB) and Kelley emphasis (A), 0 to 255, for each texel. */
    colors: Uint8Array;
}

/** A job's hill height in `year`: the live linear formula, with the stage's largest job as its reference. */
export function stageJobHeight(job: StageJob, atYear: number, maxEmployment: number): number {
    const employment = job.ep2025 + (job.ep2035 - job.ep2025) * atYear;
    const share = maxEmployment > 0 ? Math.max(0, employment) / maxEmployment : 0;
    return STAGE_MIN_HEIGHT + share * (STAGE_PEAK_HEIGHT - STAGE_MIN_HEIGHT);
}

const texel = (index: number, size: number) => (index / (size - 1) - 0.5) * SCENE.PLANE_SIZE;

/** World z of texel row `row`: the mesh lies rotated, so its v axis runs along -z, as the live one does. */
const rowOfZ = (z: number, size: number) => (0.5 - z / SCENE.PLANE_SIZE) * (size - 1);
const columnOfX = (x: number, size: number) => (0.5 + x / SCENE.PLANE_SIZE) * (size - 1);

/** Gaussian falloff along one axis of a job's window, written into `out`. */
function falloff(center: number, first: number, last: number, size: number, twoVariance: number, out: Float32Array): void {
    for (let i = first; i <= last; i++) {
        const d = texel(i, size) - center;
        out[i] = Math.exp(-(d * d) / twoVariance);
    }
}

function window1D(center: number, reach: number, size: number): [number, number] {
    const step = SCENE.PLANE_SIZE / (size - 1);
    const middle = (center / SCENE.PLANE_SIZE + 0.5) * (size - 1);
    return [Math.max(0, Math.ceil(middle - reach / step)), Math.min(size - 1, Math.floor(middle + reach / step))];
}

/**
 * The surface for one year. `sum` adds neighbouring hills, as the live shader
 * does; `smoothmax` lets the taller hill win where they overlap, by summing
 * heights to the power `power` and taking the root.
 */
function bakeLayer(jobs: readonly StageJob[], sigma: number, size: number, atYear: number, blend: StageBlend, power: number, out: Float32Array, offset: number): void {
    const maxEmployment = jobs.reduce((max, j) => Math.max(max, j.ep2025 + (j.ep2035 - j.ep2025) * atYear), 0);
    const reach = sigma * HEIGHT_REACH;
    const twoVariance = (2 * sigma * sigma) / (blend === 'sum' ? 1 : power);
    const across = new Float32Array(size);
    const along = new Float32Array(size);
    const sum = new Float32Array(size * size);
    for (const job of jobs) {
        const height = stageJobHeight(job, atYear, maxEmployment);
        const amount = blend === 'sum' ? height : height ** power;
        const [x0, x1] = window1D(job.x, reach, size);
        const [y0, y1] = window1D(-job.z, reach, size);
        falloff(job.x, x0, x1, size, twoVariance, across);
        falloff(-job.z, y0, y1, size, twoVariance, along);
        for (let y = y0; y <= y1; y++) {
            const row = y * size;
            const inRow = amount * along[y];
            for (let x = x0; x <= x1; x++) sum[row + x] += inRow * across[x];
        }
    }
    for (let i = 0; i < sum.length; i++) out[i * 2 + offset] = blend === 'sum' ? sum[i] : sum[i] ** (1 / power);
}

function bakeColors(jobs: readonly StageJob[], sigma: number, size: number, out: Uint8Array): void {
    const count = size * size;
    const r = new Float32Array(count);
    const g = new Float32Array(count);
    const b = new Float32Array(count);
    const emphasis = new Float32Array(count);
    const total = new Float32Array(count);
    const reach = sigma * COLOR_REACH;
    const twoVariance = 4 * sigma * sigma;
    const across = new Float32Array(size);
    const along = new Float32Array(size);
    for (const job of jobs) {
        const [x0, x1] = window1D(job.x, reach, size);
        const [y0, y1] = window1D(-job.z, reach, size);
        falloff(job.x, x0, x1, size, twoVariance, across);
        falloff(-job.z, y0, y1, size, twoVariance, along);
        const [cr, cg, cb] = job.color;
        const shine = job.kelley ? 1 : STAGE_DIM_EMPHASIS;
        for (let y = y0; y <= y1; y++) {
            const row = y * size;
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

export function bakeStage(stage: Pick<Stage, 'jobs' | 'sigma'>, segments: number, blend: StageBlend, power: number): StageBake {
    const size = segments + 1;
    const heights = new Float32Array(size * size * 2);
    const colors = new Uint8Array(size * size * 4);
    bakeLayer(stage.jobs, stage.sigma, size, 0, blend, power, heights, 0);
    bakeLayer(stage.jobs, stage.sigma, size, 1, blend, power, heights, 1);
    bakeColors(stage.jobs, stage.sigma, size, colors);
    return { size, heights, colors };
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

/** The drawn surface at a world point, in world units above the ground. What pins stand on. */
export function surfaceHeight(bake: StageBake, x: number, z: number, mix: number): number {
    const { size, heights } = bake;
    const cx = Math.max(0, Math.min(size - 1.001, columnOfX(x, size)));
    const cy = Math.max(0, Math.min(size - 1.001, rowOfZ(z, size)));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const at = (col: number, row: number) => {
        const i = (row * size + col) * 2;
        return heights[i] + (heights[i + 1] - heights[i]) * mix;
    };
    const near = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const far = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return near + (far - near) * fy;
}
