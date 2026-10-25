/**
 * Pointer state shared by the world's input layer (WorldMarkers and
 * GlobeMarkers, which own hit-testing) and its renderers (WorldTerrain and
 * GlobeTerrain, which glow the hovered region and peak). A plain mutable
 * object read inside useFrame, so a mouse move never re-renders React.
 */
export const worldPointer = {
    /** Continent code of the region under the pointer, or null. */
    hoverRegion: null as string | null,
    hoverPeakContinent: null as string | null,
    hoverPeakIndex: -1,
    /** Pointer position on the ground plane, for the cursor glow. */
    mouseX: 1e6,
    mouseZ: 1e6,
    /** Pointer position on the globe as a unit vector, for its cursor glow; zero when off the globe. */
    globeX: 0,
    globeY: 0,
    globeZ: 0,
    /** performance.now() of the last thing the user did to the 3D view (auto-rotation waits for quiet). */
    lastInteraction: 0,
};
