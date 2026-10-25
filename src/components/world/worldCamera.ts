import { create } from 'zustand';

/**
 * Hooks between the camera rig (CameraRig, inside the canvas) and the rest of
 * the app. Plain functions the rig replaces while it is mounted, so the
 * stores and the DOM chrome never import three.js.
 */
export const worldCamera = {
    /** Lets OrbitControls (Landscape) cancel a CameraRig flight the moment the user grabs the view. */
    cancel: () => {},
    /**
     * Runs `open` once the camera has arrived in field `code`, just requested
     * by worldStore.openRole. Without a rig (tests, the 2D views) or when no
     * globe flight is under way, it runs straight away.
     */
    whenArrived: (_code: string, open: () => void) => open(),
    /** Back to the globe's default view at once ("Reset view"). */
    reset: () => {},
    /** Camera distance of the globe's default view for the current viewport and chrome (NaN without a rig). */
    globeDistance: () => NaN,
};

/**
 * Which scene the 3D view draws: the globe of 22 continents, or one zoomed
 * field on the flat phase-2 terrain. `moving` is true while the rig carries
 * the camera between them, when labels and taps on the globe wait.
 */
export type WorldViewKind = 'globe' | 'field';

export const useWorldView = create<{ view: WorldViewKind; moving: boolean }>(() => ({
    view: 'globe',
    moving: false,
}));
