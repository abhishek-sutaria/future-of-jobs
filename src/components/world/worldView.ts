import { surfaceHeight, type StageBake } from '../../utils/stageBake';
import type { Stage } from '../../utils/stageLayout';
import { composeMaps, IDENTITY_MAP, invertMap, mapX, mapZ, type PlaneMap } from '../../utils/stageMap';
import { EP_PATH_MAX } from '../../utils/occupationIndex';
import { WORLD_LAYER, type LayerState, type LevelView, type Transition } from '../../utils/stageTransition';

/** A stage's surface as drawn: what pins, labels and pointers stand on. Written by StageTerrain. */
export interface DrawnSurface {
    stage: Stage;
    bake: StageBake;
}

/**
 * Frame-by-frame state shared by everything the 3D view draws. CameraRig writes
 * the view each frame, before anything else reads it (it is mounted first); the
 * world treemap, the stage surfaces, pins and labels all draw through `map`, so
 * they move together during a flight. A plain object read inside useFrame, like
 * worldPointer.
 */
export const worldView = {
    /** World ground to screen ground, this frame. Identity at rest at the world, a stage's map at rest on it. */
    map: { ...IDENTITY_MAP } as PlaneMap,
    /** The employment drawn at full height, this frame: the national scale at the world. */
    heightRef: EP_PATH_MAX,
    /** Every layer on screen: WORLD_LAYER for the treemap, and stage keys. */
    layers: new Map<string, LayerState>([[WORLD_LAYER, { alpha: 1, mult: 1 }]]) as ReadonlyMap<string, LayerState>,
    /** The level the view is at or flying to. */
    level: null as LevelView | null,
    /** The flight in progress, or null at rest. */
    transition: null as Transition | null,
    /** Slider year as a 0 to 1 mix of the two baked years. */
    yearMix: 0,
    /** Baked stages on the mesh now, by key. */
    surfaces: new Map<string, DrawnSurface>(),
    /** World peaks the IU school is sinking (role key → height multiplier now); absent means full height. Written by WorldTerrain. */
    peakSink: new Map<string, number>(),
};

/** Straight back to the whole world at rest, for Reset view, which moves the camera itself. */
export function resetWorldView(): void {
    worldView.transition = null;
    worldView.level = null;
    worldView.map = { ...IDENTITY_MAP };
    worldView.heightRef = EP_PATH_MAX;
    worldView.layers = new Map([[WORLD_LAYER, { alpha: 1, mult: 1 }]]);
}

export const layerOf = (key: string): LayerState => worldView.layers.get(key) ?? { alpha: 0, mult: 1 };

/** World ground point to screen ground point, this frame. */
export const toDisplayX = (x: number): number => mapX(worldView.map, x);
export const toDisplayZ = (z: number): number => mapZ(worldView.map, z);

/** Screen ground point back to the world map's ground. */
export function displayToWorld(x: number, z: number): { x: number; z: number } {
    const inv = invertMap(worldView.map);
    return { x: mapX(inv, x), z: mapZ(inv, z) };
}

/** A stage's ground to the screen's, this frame: identity once the stage is the level on screen. */
export const stageToDisplay = (stage: Stage): PlaneMap => composeMaps(worldView.map, invertMap(stage.map));

/** The drawn height above the ground of a stage's surface at a world point, as far as the flight has grown it. */
export function stageSurfaceAt(surface: DrawnSurface, worldX: number, worldZ: number): number {
    const { stage, bake } = surface;
    return surfaceHeight(bake, mapX(stage.map, worldX), mapZ(stage.map, worldZ), worldView.yearMix) * layerOf(stage.key).mult;
}
