import type { StageBake } from '../../utils/stageBake';

/**
 * Frame-by-frame state shared between StageTerrain, WorldTerrain and
 * WorldMarkers, so the world and a stage take turns: the world fades out, then
 * the hills rise; going back, the hills flatten, then the world fades in.
 * A plain object read inside useFrame, like worldPointer.
 */
export const worldStage = {
    /** The surface on the mesh now, for pins and pointers to stand on. */
    bake: null as StageBake | null,
    /** How far its hills have risen, 0 flat to 1 full height. */
    rise: 0,
    /** Slider year as a 0 to 1 mix of the two baked years. */
    yearMix: 0,
    /** The treemap's visibility, 0 gone to 1 fully there. */
    worldFade: 1,
};
