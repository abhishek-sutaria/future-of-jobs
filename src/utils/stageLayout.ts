/**
 * Where a family's or field's jobs stand on the stage: the live app's disc,
 * whatever the job count. Position is layout only, so it never depends on the
 * year or on any score: the same job lands in the same place every time.
 *
 * Pure, like worldLayout, so it can be tested without a camera.
 */

import { familyOf } from '../config/socFamilies';
import { INDEX_CONTINENT_BY_CODE } from './occupationIndex';
import { RING_SPACING, territoryLayout, type TerritoryOptions } from './terrainMath';
import type { WorldLevel } from './worldLevel';

/** What the stage needs to know about a job. Structurally a ScenePeak. */
export interface StageSource {
    entry: { key: string; title: string; soc: string; continent: string; kind: string; ep2025: number | null; ep2035: number | null };
    color: readonly [number, number, number];
}

export interface StageJob {
    key: string;
    /** The field the job is in. */
    code: string;
    x: number;
    z: number;
    ep2025: number;
    ep2035: number;
    color: readonly [number, number, number];
    kelley: boolean;
}

/** A field's own range of hills on a family's stage, for its name and its clicks. */
export interface StageRange {
    code: string;
    x: number;
    z: number;
}

export interface Stage {
    key: string;
    kind: 'family' | 'field';
    jobs: StageJob[];
    byKey: Map<string, StageJob>;
    /** Gaussian spread of each hill, in world units. */
    sigma: number;
    ranges: StageRange[];
}

/** Job count of the live view, whose spacing and hill width everything else scales from. */
const LIVE_JOBS = 50;
/** The live hill's spread (SHADER.SIGMA_SQ2 = 2 * 2.0^2). */
const LIVE_SIGMA = 2;
/** Narrower than this and the mesh can no longer draw a hill as a hill. */
export const STAGE_SIGMA_MIN = 1.1;
/** Wider than this and a few hills melt into one dome. */
export const STAGE_SIGMA_MAX = 5;
/** A little more air between a family's fields than between a field's groups, so each reads as its own range. */
const FAMILY_GAP_RAD = 0.14;
/** Disc radius past which a pointer is off the stage: where the live edge fade ends. */
export const STAGE_INPUT_RADIUS = 36;

/** The stage a level puts up, by key; null at the world. */
export function stageKey(level: WorldLevel): string | null {
    if (level.focusedContinent) return `field:${level.focusedContinent}`;
    return level.focusedFamily != null ? `family:${level.focusedFamily}` : null;
}

/** Each job's share of the disc scales with the count, so 8 jobs and 375 jobs fill the same footprint. */
export const stageRingSpacing = (jobCount: number): number => RING_SPACING * Math.sqrt(LIVE_JOBS / Math.max(1, jobCount));

/**
 * Hills narrow as jobs crowd in, a little slower than the spacing does (a square
 * root would be 0.5): most occupations are small next to their field's largest,
 * and low hills only run together into one landscape with some extra width.
 */
const SIGMA_DENSITY_EXPONENT = 0.35;

export const stageSigma = (jobCount: number): number =>
    Math.min(STAGE_SIGMA_MAX, Math.max(STAGE_SIGMA_MIN, LIVE_SIGMA * (LIVE_JOBS / Math.max(1, jobCount)) ** SIGMA_DENSITY_EXPONENT));

const bySoc = (a: StageSource, b: StageSource) =>
    a.entry.soc === b.entry.soc ? a.entry.title.localeCompare(b.entry.title) : a.entry.soc.localeCompare(b.entry.soc);

/** A field's jobs by SOC minor group, in SOC order, so related jobs sit together. */
export function minorGroupsOf(code: string, peaks: readonly StageSource[]): StageSource[][] {
    const minors = (INDEX_CONTINENT_BY_CODE.get(code)?.minorGroups ?? []).map((g) => g.soc).sort();
    const groups = minors.map((): StageSource[] => []);
    for (const peak of [...peaks].sort(bySoc)) {
        // The group a SOC is in is the last one that starts at or before it.
        let at = 0;
        for (let i = 0; i < minors.length; i++) if (minors[i] <= peak.entry.soc) at = i;
        (groups[at] ??= []).push(peak);
    }
    return groups.filter((g) => g.length > 0);
}

/** The field a point on the stage belongs to: its nearest job's, if the point is on the disc at all. */
export function stageFieldAt(stage: Pick<Stage, 'jobs'>, x: number, z: number): string | null {
    if (Math.hypot(x, z) > STAGE_INPUT_RADIUS) return null;
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const job of stage.jobs) {
        const d = (job.x - x) ** 2 + (job.z - z) ** 2;
        if (d < bestDistance) {
            bestDistance = d;
            best = job.code;
        }
    }
    return best;
}

/** A level's stage, or null at the world. */
export function buildStage(level: WorldLevel, peaksByContinent: ReadonlyMap<string, readonly StageSource[]>): Stage | null {
    const { focusedContinent: field, focusedFamily: family } = level;
    if (!field && family == null) return null;
    const codes = field ? [field] : [...peaksByContinent.keys()].filter((c) => familyOf(c).id === family).sort();
    const sources = codes.flatMap((c) => peaksByContinent.get(c) ?? []);
    const options: TerritoryOptions = { ringSpacing: stageRingSpacing(sources.length) };
    if (!field) options.gapRad = FAMILY_GAP_RAD;

    // A field's territories are its minor groups; a family's are its fields.
    const groups = field
        ? minorGroupsOf(field, sources)
        : codes.map((c) => [...(peaksByContinent.get(c) ?? [])].sort(bySoc));
    const positions = territoryLayout(groups.map((g) => g.map((p) => p.entry.key)), options);

    const jobs = groups.flat().map((p): StageJob => {
        const { x, z } = positions.get(p.entry.key)!;
        return {
            key: p.entry.key,
            code: p.entry.continent,
            x,
            z,
            ep2025: p.entry.ep2025 ?? 1,
            ep2035: p.entry.ep2035 ?? 1,
            color: p.color,
            kelley: p.entry.kind === 'kelley',
        };
    });
    const ranges = codes.map((code): StageRange => {
        const members = jobs.filter((j) => j.code === code);
        return {
            code,
            x: members.reduce((sum, j) => sum + j.x, 0) / Math.max(1, members.length),
            z: members.reduce((sum, j) => sum + j.z, 0) / Math.max(1, members.length),
        };
    });
    return {
        key: stageKey(level)!,
        kind: field ? 'field' : 'family',
        jobs,
        byKey: new Map(jobs.map((j) => [j.key, j])),
        sigma: stageSigma(jobs.length),
        ranges,
    };
}
