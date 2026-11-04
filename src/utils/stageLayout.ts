/**
 * A family's or field's stage: its rectangle on the world map, magnified by the
 * one map stageMapFor gives it. Every job stands where that map sends its world
 * position, and the field tiles (on a family) or minor-group blocks (on a field)
 * are the images of their world rectangles. So a stage is never a new layout:
 * it keeps the world map's borders, proportions and neighbours, and position
 * never depends on the year or on any score.
 *
 * Pure, like worldLayout, so it can be tested without a camera.
 */

import { familyOf } from '../config/socFamilies';
import { INDEX_CONTINENT_BY_CODE } from './occupationIndex';
import { mapRect, mapScale, mapX, mapZ, stageMapFor, type PlaneMap } from './stageMap';
import { REGION_INSET, type FamilyLayout, type MinorGroupLayout, type Rect, type RegionLayout } from './worldLayout';
import type { WorldLevel } from './worldLevel';

/** What the stage needs to know about a job. Structurally a ScenePeak. */
export interface StageSource {
    entry: { key: string; title: string; soc: string; continent: string; kind: string; ep2025: number | null; ep2035: number | null };
    color: readonly [number, number, number];
    /** World position and footprint, from worldLayout. */
    x: number;
    z: number;
    radius: number;
}

/** What the stage needs to know about the world map. Structurally a WorldScene. */
export interface StageWorld {
    layout: {
        families: readonly Pick<FamilyLayout, 'family' | 'rect'>[];
        regions: readonly Pick<RegionLayout, 'code' | 'rect'>[];
        minorGroupsByContinent: ReadonlyMap<string, readonly MinorGroupLayout[]>;
    };
    peaksByContinent: ReadonlyMap<string, readonly StageSource[]>;
}

export interface StageJob {
    key: string;
    /** The field the job is in. */
    code: string;
    /** Stage position: the stage map applied to the job's world position. */
    x: number;
    z: number;
    /** Gaussian spread of its hill, in stage units. */
    sigma: number;
    ep2025: number;
    ep2035: number;
    color: readonly [number, number, number];
    kelley: boolean;
}

/** A field's tile on a family's stage, or a minor group's block on a field's. */
export interface StageTile {
    /** The field. */
    code: string;
    /** SOC minor group code on a field's stage; null for a field tile. */
    minor: string | null;
    title: string;
    /** The tile's world rectangle, and its image on the stage. */
    worldRect: Rect;
    rect: Rect;
}

export interface Stage {
    key: string;
    kind: 'family' | 'field';
    /** World ground to stage ground. */
    map: PlaneMap;
    /** The family's or field's rectangle on the world map, and its image: the stage's edge. */
    worldOutline: Rect;
    outline: Rect;
    /** Field tiles on a family, minor-group blocks on a field, in SOC order. */
    tiles: StageTile[];
    jobs: StageJob[];
    byKey: Map<string, StageJob>;
}

/**
 * A stage hill's spread, as a share of its world peak's footprint radius. The
 * bell itself is about 0.38 of it; a little wider lets neighbours run together
 * as the live landscape's hills do (sigma 2 at spacing 5).
 */
export const STAGE_HILL_SPREAD = 0.6;
/** Narrower than this and the mesh can no longer draw a hill as a hill. */
export const STAGE_SIGMA_MIN = 0.9;
/** Wider than this and a few hills melt into one dome. */
export const STAGE_SIGMA_MAX = 5;

/** The stage a level puts up, by key; null at the world. */
export function stageKey(level: WorldLevel): string | null {
    if (level.focusedContinent) return `field:${level.focusedContinent}`;
    return level.focusedFamily != null ? `family:${level.focusedFamily}` : null;
}

/** A job's hill spread on a stage: its world footprint, magnified with everything else. */
export const stageSigma = (worldRadius: number, map: PlaneMap): number =>
    Math.min(STAGE_SIGMA_MAX, Math.max(STAGE_SIGMA_MIN, STAGE_HILL_SPREAD * worldRadius * mapScale(map)));

/**
 * The strip round a stage's edge where no job stands: REGION_INSET, magnified.
 * The baked surface comes down to the ground across it, so the stage ends in a
 * clean edge and every job keeps its own height.
 */
export const stageEdgeBand = (stage: Pick<Stage, 'map'>): number => REGION_INSET * Math.min(stage.map.sx, stage.map.sz);

/** A level's stage, or null at the world. */
export function buildStage(level: WorldLevel, world: StageWorld): Stage | null {
    const { focusedContinent: field, focusedFamily: family } = level;
    if (!field && family == null) return null;
    const { layout } = world;
    const regions = field ? layout.regions.filter((r) => r.code === field) : layout.regions.filter((r) => familyOf(r.code).id === family);
    const worldOutline = field ? regions[0].rect : layout.families.find((f) => f.family.id === family)!.rect;
    const map = stageMapFor(worldOutline, field ? 'field' : 'family');

    const tiles: StageTile[] = field
        ? (layout.minorGroupsByContinent.get(field) ?? []).map((g) => ({ code: field, minor: g.minor, title: g.title, worldRect: g.rect, rect: mapRect(map, g.rect) }))
        : regions.map((r) => ({ code: r.code, minor: null, title: INDEX_CONTINENT_BY_CODE.get(r.code)?.title ?? r.code, worldRect: r.rect, rect: mapRect(map, r.rect) }));

    const jobs = regions.flatMap((r) => world.peaksByContinent.get(r.code) ?? []).map((p): StageJob => ({
        key: p.entry.key,
        code: p.entry.continent,
        x: mapX(map, p.x),
        z: mapZ(map, p.z),
        sigma: stageSigma(p.radius, map),
        ep2025: p.entry.ep2025 ?? 1,
        ep2035: p.entry.ep2035 ?? 1,
        color: p.color,
        kelley: p.entry.kind === 'kelley',
    }));
    return {
        key: stageKey(level)!,
        kind: field ? 'field' : 'family',
        map,
        worldOutline,
        outline: mapRect(map, worldOutline),
        tiles,
        jobs,
        byKey: new Map(jobs.map((j) => [j.key, j])),
    };
}
