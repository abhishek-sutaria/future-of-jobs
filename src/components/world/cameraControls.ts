import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SCENE } from '../../config/constants';
import { GLOBE_RADIUS } from '../../utils/globeLayout';
import { GLOBE_MAX_TILT } from './framing';

/**
 * The part of the viewport the terrain is not covered by chrome: from the
 * bottom of the header / fields bar to the top of the year slider. A phone's
 * chrome takes about half the screen, a desktop's about a third.
 */
export function freeBand(barSelector = '[data-world-bar]'): { usableHeight?: number; bandCenter?: number } {
    if (typeof document === 'undefined') return {};
    const h = window.innerHeight;
    const bottomOf = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0;
    const top = Math.max(bottomOf('header'), bottomOf(barSelector));
    const bottom = document.querySelector('[data-tour="tour-slider"]')?.getBoundingClientRect().top ?? h;
    if (!(bottom > top)) return {};
    return { usableHeight: (bottom - top) / h, bandCenter: ((top + bottom) / 2 - h / 2) / (h / 2) };
}

/** Closest the globe camera may zoom, from the globe's centre. */
const GLOBE_MIN_DISTANCE = GLOBE_RADIUS * 1.45;
/** Farthest it may zoom out, as a multiple of the default view's distance. */
const GLOBE_MAX_ZOOM_OUT = 1.35;

/**
 * Control limits for each view. Set here, imperatively, at the moment the rig
 * cuts between views (not through React props, which would land a frame late
 * and clamp the first frame of the new view to the old view's limits).
 */
export function configureControls(controls: OrbitControlsImpl, view: 'globe' | 'field', globeDefaultDistance: number) {
    if (view === 'globe') {
        controls.enablePan = false;
        controls.minDistance = GLOBE_MIN_DISTANCE;
        controls.maxDistance = globeDefaultDistance * GLOBE_MAX_ZOOM_OUT;
        controls.minPolarAngle = Math.PI / 2 - GLOBE_MAX_TILT - 0.12;
        controls.maxPolarAngle = Math.PI / 2 + GLOBE_MAX_TILT + 0.12;
        controls.zoomSpeed = 0.7;
    } else {
        controls.enablePan = true;
        controls.minDistance = SCENE.MIN_CAMERA_DISTANCE;
        controls.maxDistance = SCENE.MAX_CAMERA_DISTANCE;
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = SCENE.MAX_POLAR_ANGLE;
        controls.rotateSpeed = 1;
        controls.zoomSpeed = 1;
    }
}
