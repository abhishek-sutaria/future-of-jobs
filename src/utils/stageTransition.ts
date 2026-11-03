/**
 * What is drawn partway through a flight between levels, kept pure so every
 * frame of it can be tested without a GPU.
 *
 * Three kinds of layer can be on screen: the world treemap, and one baked
 * surface per stage. All of them are drawn through one map from the world's
 * ground to the screen's (blendMaps), so the block being zoomed into stays put
 * on every layer at once, and layers can hand over by crossfading in place.
 *
 * Going in (world to family, family to field), the inner layer fades in on top
 * early, while the block is still small, with its heights matched to the layer
 * underneath; it then grows to its own height scale as the camera arrives, and
 * everything else fades. Going out runs the same steps backwards. Heights are
 * matched with one number per frame, `heightRef`: the employment the screen's
 * full height stands for. A layer drawn on its own scale `ref` is multiplied by
 * ref / heightRef, which is exactly 1 once it is the level on screen.
 */

import { EP_PATH_MAX } from './occupationIndex';
import { stageMaxEmployment } from './stageBake';
import { buildStage, type StageWorld } from './stageLayout';
import { blendMaps, IDENTITY_MAP, type PlaneMap } from './stageMap';
import { rectDepth, rectWidth, WORLD_BOUNDS, type Rect } from './worldLayout';
import type { WorldLevel } from './worldLevel';

export const WORLD_LAYER = 'world';

/** One level, as the view needs it. */
export interface LevelView {
    /** WORLD_LAYER, or the stage's key. */
    key: string;
    /** World to screen ground at rest on this level. */
    map: PlaneMap;
    /** The employment drawn at full height on this level. */
    heightRef: number;
    /** The level's rectangle on the world map. */
    rect: Rect;
    /** 0 world, 1 family, 2 field. */
    depth: number;
}

export interface LayerState {
    /** 0 gone to 1 fully drawn. */
    alpha: number;
    /** Height multiplier on the layer's own scale. */
    mult: number;
}

export interface ViewState {
    map: PlaneMap;
    heightRef: number;
    layers: ReadonlyMap<string, LayerState>;
}

export type Relation = 'in' | 'out' | 'side' | 'same';

export interface Transition {
    from: LevelView;
    to: LevelView;
    relation: Relation;
    /** What was on screen when it began, so an interrupted flight carries on from there. */
    start: ViewState;
    /** World point the zoom is about: the middle of the inner block. */
    anchor: { x: number; z: number };
}

export function worldLevelView(heightRef: number): LevelView {
    return { key: WORLD_LAYER, map: { ...IDENTITY_MAP }, heightRef, rect: WORLD_BOUNDS, depth: 0 };
}

/** A level as the view needs it: the world on the national scale, or a stage's map, its own scale and its rectangle. */
export function levelViewOf(level: WorldLevel, world: StageWorld): LevelView {
    const stage = buildStage(level, world);
    if (!stage) return worldLevelView(EP_PATH_MAX);
    return { key: stage.key, map: stage.map, heightRef: stageMaxEmployment(stage.jobs), rect: stage.worldOutline, depth: stage.kind === 'field' ? 2 : 1 };
}

export function restState(level: LevelView): ViewState {
    return { map: { ...level.map }, heightRef: level.heightRef, layers: new Map([[level.key, { alpha: 1, mult: 1 }]]) };
}

const contains = (outer: Rect, inner: Rect, eps = 1e-6) =>
    inner.x0 >= outer.x0 - eps && inner.x1 <= outer.x1 + eps && inner.z0 >= outer.z0 - eps && inner.z1 <= outer.z1 + eps;

export function relationOf(from: LevelView, to: LevelView): Relation {
    if (from.key === to.key) return 'same';
    if (to.depth > from.depth && contains(from.rect, to.rect)) return 'in';
    if (from.depth > to.depth && contains(to.rect, from.rect)) return 'out';
    return 'side';
}

const centre = (r: Rect) => ({ x: r.x0 + rectWidth(r) / 2, z: r.z0 + rectDepth(r) / 2 });

export function beginTransition(from: LevelView, to: LevelView, current: ViewState): Transition {
    const relation = relationOf(from, to);
    // A copy: the view on screen goes on changing every frame of the flight.
    const start: ViewState = { map: { ...current.map }, heightRef: current.heightRef, layers: new Map(current.layers) };
    return { from, to, relation, start, anchor: centre(relation === 'out' ? from.rect : to.rect) };
}

export const smoothstep = (a: number, b: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Where the inner layer fades in, going in, as a share of the flight. Mirrored going out. */
export const INNER_FADE = [0, 0.2] as const;
/** Where the outer layer and everything else fade away, going in. Mirrored going out. */
export const OUTER_FADE = [0.1, 0.5] as const;
/** A side-step crossfades in the middle of the flight. */
const SIDE_IN = [0.2, 0.5] as const;
const SIDE_OUT = [0.35, 0.65] as const;
/** An interrupted flight blends from what was on screen into its own schedule over this share of it. */
const CARRY_OVER = 0.3;

/** The schedule for the two levels a transition joins. */
function scheduled(t: Transition, k: number, heightRef: number): Map<string, LayerState> {
    const { from, to, relation } = t;
    const out = new Map<string, LayerState>();
    if (relation === 'same') {
        out.set(to.key, { alpha: 1, mult: 1 });
    }
    else if (relation === 'in') {
        out.set(from.key, { alpha: 1 - smoothstep(OUTER_FADE[0], OUTER_FADE[1], k), mult: 1 });
        out.set(to.key, { alpha: smoothstep(INNER_FADE[0], INNER_FADE[1], k), mult: to.heightRef / heightRef });
    }
    else if (relation === 'out') {
        const z = 1 - k;
        out.set(from.key, { alpha: smoothstep(INNER_FADE[0], INNER_FADE[1], z), mult: from.heightRef / heightRef });
        out.set(to.key, { alpha: 1 - smoothstep(OUTER_FADE[0], OUTER_FADE[1], z), mult: 1 });
    }
    else {
        out.set(from.key, { alpha: 1 - smoothstep(SIDE_OUT[0], SIDE_OUT[1], k), mult: 1 });
        out.set(to.key, { alpha: smoothstep(SIDE_IN[0], SIDE_IN[1], k), mult: 1 });
    }
    return out;
}

/** The view at k (0 to 1, already eased) through a transition. Exact at both ends. */
export function viewAt(t: Transition, k: number): ViewState {
    if (k >= 1) return { map: { ...t.to.map }, heightRef: t.to.heightRef, layers: new Map([[t.to.key, { alpha: 1, mult: 1 }]]) };
    const map = blendMaps(t.start.map, t.to.map, k, t.anchor);
    const heightRef = t.start.heightRef * (t.to.heightRef / t.start.heightRef) ** k;
    const plan = scheduled(t, k, heightRef);
    const plannedStart = scheduled(t, 0, t.start.heightRef);
    // How far what was on screen differed from the plan's own start, fading out:
    // nothing for a flight from rest, so it follows its schedule exactly.
    const left = 1 - smoothstep(0, CARRY_OVER, k);
    const layers = new Map<string, LayerState>();
    for (const [key, s] of plan) {
        const planned = plannedStart.get(key)!;
        const was = t.start.layers.get(key) ?? { alpha: 0, mult: planned.mult };
        layers.set(key, { alpha: s.alpha + (was.alpha - planned.alpha) * left, mult: s.mult + (was.mult - planned.mult) * left });
    }
    // Anything left over from an interrupted flight fades away early.
    for (const [key, s] of t.start.layers) {
        if (plan.has(key)) continue;
        layers.set(key, { alpha: s.alpha * (1 - smoothstep(0, CARRY_OVER, k)), mult: s.mult });
    }
    return { map, heightRef, layers };
}
