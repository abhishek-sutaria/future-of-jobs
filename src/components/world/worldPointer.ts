/**
 * Pointer state shared by the world's input layer (WorldMarkers, which owns
 * hit-testing) and its renderer (WorldTerrain, which glows the hovered region
 * and peak). A plain mutable object read inside useFrame, so a mouse move
 * never re-renders React.
 */
export const worldPointer = {
    /** Continent code of the region under the pointer, or null. */
    hoverRegion: null as string | null,
    hoverPeakContinent: null as string | null,
    hoverPeakIndex: -1,
    /** Pointer position on the ground plane, for the cursor glow. */
    mouseX: 1e6,
    mouseZ: 1e6,
};
