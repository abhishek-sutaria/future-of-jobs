/**
 * What the hand zoom-out rule (zoomedOutOfLevel in utils/worldLevel) is fed,
 * so that only a zoom-out the user makes on purpose, once the level has come
 * to rest, can take the view up a level.
 *
 * OrbitControls zooms 5% for every wheel event however small, and a trackpad or
 * Magic Mouse sends a run of small ones from a finger brushing it during a
 * click, with a momentum tail that outlasts a flight: five of them (1.05^5 =
 * 1.28) are past ZOOM_OUT_RATIO. The rule used to arm a fixed 350 ms after any
 * landing whatever was still moving, so one click could climb field, family,
 * world. Now:
 *
 * - The threshold is always the level's own landing distance times
 *   ZOOM_OUT_RATIO. Nothing moves it: zooming in never lowers it, and it stays
 *   inside the orbit limit, so it can always be reached.
 * - Until the gate arms, wheel-out events are swallowed in the capture phase
 *   (attachWheelGate), before OrbitControls sees them: they neither zoom the
 *   camera out nor cut a flight short, and each one restarts the quiet time.
 *   Zoom-in always goes through.
 * - The gate arms once nothing has zoomed and no swallowed wheel-out has come
 *   for ZOOM_OUT_SETTLE_MS after the level landed. A flight disarms it, and so
 *   does a click with the main mouse or pen button, from press until that quiet
 *   time after release. So a brush during a click or before the level settles
 *   never moves the camera out, a click never changes level except through
 *   clickAction, and one coasting scroll climbs one level, not two. Touch is
 *   left out: a pinch starts with one finger down and must still zoom out of a
 *   level on a phone (it is not a wheel, so nothing is swallowed either).
 *
 * At the world there is no level to leave, but the same quiet time keeps a
 * coasting scroll from carrying on out once a climb has landed there.
 *
 * Pure apart from attachWheelGate, so every frame of it can be tested without
 * a camera.
 */

import { SCENE } from '../config/constants';
import { ZOOM_OUT_RATIO, ZOOM_OUT_SETTLE_MS } from './worldLevel';

export interface ZoomOutGate {
    /** The level's landing distance: the rule fires past base x ZOOM_OUT_RATIO. */
    base: number;
    /** The camera's distance at the last step. */
    last: number;
    /** When the camera last zoomed, a wheel-out was last swallowed, or a click last pressed or let go. */
    quietSince: number;
    /** A main-button mouse or pen press is down. */
    pressed: boolean;
    /** The rule may fire, and wheel-outs reach OrbitControls. */
    armed: boolean;
}

/** Relative change in distance below which the camera has not zoomed (float noise from controls.update). */
export const ZOOM_EPSILON = 1e-6;

/**
 * The largest base the rule may measure from: past it, base x ZOOM_OUT_RATIO
 * would be at or beyond the orbit limit and could never be reached. Only a
 * flight stopped short far out (counted from where it stopped) comes near it.
 */
export const MAX_GATE_BASE = SCENE.MAX_CAMERA_DISTANCE / (ZOOM_OUT_RATIO * 1.05);

/** Before anything has landed (the world at load): no level to leave, and wheel-outs go through. */
export const UNLANDED_GATE: Readonly<ZoomOutGate> = { base: Infinity, last: NaN, quietSince: -Infinity, pressed: false, armed: true };

/**
 * A flight has landed, or was stopped short, at a level whose rule counts from
 * `base`, with the camera now at `distance`. A press that is still down stays down.
 */
export function landedGate(base: number, distance: number, now: number, pressed = false): ZoomOutGate {
    return { base: Math.min(base, MAX_GATE_BASE), last: distance, quietSince: now, pressed, armed: false };
}

/** A flight has started: nothing is let out until it lands and the camera has been still. */
export const flyingGate = (g: ZoomOutGate, now: number): ZoomOutGate => ({ ...g, armed: false, quietSince: now });

/** The main mouse or pen button went down on the 3D view. */
export const pressGate = (g: ZoomOutGate, now: number): ZoomOutGate => ({ ...g, pressed: true, armed: false, quietSince: now });

/** It came back up, anywhere. */
export const releaseGate = (g: ZoomOutGate, now: number): ZoomOutGate => (g.pressed ? { ...g, pressed: false, quietSince: now } : g);

/** Whether a wheel event that zooms out (deltaY > 0) is kept from OrbitControls. Zoom-in never is. */
export const swallowsWheel = (g: ZoomOutGate, deltaY: number): boolean => deltaY > 0 && !g.armed;

/** A wheel-out was swallowed: the quiet time starts again. */
export const swallowedGate = (g: ZoomOutGate, now: number): ZoomOutGate => ({ ...g, quietSince: now });

/** One frame at rest (no flight) with the camera at `distance`. */
export function stepGate(g: ZoomOutGate, distance: number, now: number): ZoomOutGate {
    const moved = Number.isFinite(g.last) && Math.abs(distance - g.last) > ZOOM_EPSILON * g.last;
    const quietSince = moved && !g.armed ? now : g.quietSince;
    const armed = g.armed || (!g.pressed && now - quietSince >= ZOOM_OUT_SETTLE_MS);
    return { base: g.base, last: distance, quietSince, pressed: g.pressed, armed };
}

/**
 * Swallows wheel-outs over the 3D view while the gate is not armed. Listens on
 * the window in the capture phase, non-passive, so it runs before OrbitControls
 * (which listens on the canvas's container) and can cancel the page's own
 * scroll. `within` is the element holding the canvas and its labels.
 */
export function attachWheelGate(
    win: Pick<Window, 'addEventListener' | 'removeEventListener'>,
    within: () => Node | null,
    gate: { get: () => ZoomOutGate; set: (g: ZoomOutGate) => void },
    now: () => number,
): () => void {
    const onWheel = (e: WheelEvent) => {
        const area = within();
        if (!area || !e.target || !area.contains(e.target as Node)) return;
        if (!swallowsWheel(gate.get(), e.deltaY)) return;
        e.preventDefault();
        e.stopPropagation();
        gate.set(swallowedGate(gate.get(), now()));
    };
    win.addEventListener('wheel', onWheel as EventListener, { capture: true, passive: false });
    return () => win.removeEventListener('wheel', onWheel as EventListener, { capture: true });
}
