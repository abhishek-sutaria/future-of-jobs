import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { WORLD_BOUNDS, type Rect } from '../../utils/worldLayout';

/** Shared between CameraRig, which flies the camera, and Landscape, which owns OrbitControls. */
export const worldCamera: {
    /** Lets OrbitControls cancel a flight the moment the user grabs the view. `force` also stops a zoom-out's own flight. */
    cancel: (force?: boolean) => void;
    /** Where the orbit target may go: the block on stage, or null while a flight is moving it. */
    panBounds: Readonly<Rect> | null;
} = {
    cancel: () => {},
    panBounds: WORLD_BOUNDS,
};

/**
 * Drops any pan or orbit momentum a drag left behind. OrbitControls has no call
 * for it, but one update with damping off clears both. Without this the camera
 * goes on drifting after a flight has landed or a reset has put it back.
 */
export function stopInertia(controls: Pick<OrbitControlsImpl, 'enableDamping' | 'update'>): void {
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
}

export const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
