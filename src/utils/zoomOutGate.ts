/**
 * What the hand zoom-out rule (zoomedOutOfLevel in utils/worldLevel) is fed,
 * so that only a zoom the user makes on purpose, after the level has come to
 * rest, can take the view up a level.
 *
 * The rule compares the camera's distance with the distance it is measured
 * from, `base`. Before this gate, `base` was the landing's distance and the
 * rule armed a fixed 350 ms after landing, whatever was still moving the
 * camera. OrbitControls zooms 5% for every wheel event however small, and a
 * trackpad or Magic Mouse sends a run of small events from a finger brushing
 * it, with a momentum tail that outlasts a flight: five of them (1.05^5 =
 * 1.28) are past ZOOM_OUT_RATIO. So a click that opened a field, with a brush
 * of the finger behind it, climbed field to family to world, and kept zooming
 * out once there.
 *
 * Now:
 * - The gate arms only once the camera's distance has held still for
 *   ZOOM_OUT_SETTLE_MS after it landed. Any zoom before then is carried into
 *   `base`, so it never counts: a coasting scroll cannot climb a second level.
 * - A click with the main mouse or pen button disarms it from press until the
 *   same quiet time after release, and any zoom in that time is carried into
 *   `base` too: a click or tap never changes level except through clickAction.
 *   Touch is left out: a pinch starts with one finger down, and must still
 *   zoom out of a level on a phone.
 *
 * Only zoom changes the camera's distance at rest (orbit, pan and the pan clamp
 * keep it, and a resize does not move the camera), so "the distance changed"
 * is the signal, whatever the input was.
 *
 * Pure, so every frame of it can be tested without a camera.
 */

import { ZOOM_OUT_SETTLE_MS } from './worldLevel';

export interface ZoomOutGate {
    /** The distance the hand zoom is measured from: the landing's, carried along by any zoom made before the gate armed. */
    base: number;
    /** The camera's distance at the last step. */
    last: number;
    /** When the distance last changed, or a click last pressed or let go, whichever is latest. */
    quietSince: number;
    /** A main-button mouse or pen press is down. */
    pressed: boolean;
    /** The rule may fire. */
    armed: boolean;
}

/** Relative change in distance below which the camera has not zoomed (float noise from controls.update). */
export const ZOOM_EPSILON = 1e-6;

/** Before anything has landed: there is nothing to measure from, so nothing can fire. */
export const UNLANDED_GATE: Readonly<ZoomOutGate> = { base: Infinity, last: NaN, quietSince: -Infinity, pressed: false, armed: false };

/**
 * A flight has landed (or was stopped short) at `base`, with the camera now at
 * `distance`. A press that is still down stays down.
 */
export function landedGate(base: number, distance: number, now: number, pressed = false): ZoomOutGate {
    return { base, last: distance, quietSince: now, pressed, armed: false };
}

/** The main mouse or pen button went down on the 3D view. */
export const pressGate = (g: ZoomOutGate, now: number): ZoomOutGate => ({ ...g, pressed: true, armed: false, quietSince: now });

/** It came back up, anywhere. */
export const releaseGate = (g: ZoomOutGate, now: number): ZoomOutGate => (g.pressed ? { ...g, pressed: false, quietSince: now } : g);

/** One frame at rest (no flight) with the camera at `distance`. */
export function stepGate(g: ZoomOutGate, distance: number, now: number): ZoomOutGate {
    const moved = Number.isFinite(g.last) && Math.abs(distance - g.last) > ZOOM_EPSILON * g.last;
    // Zoom made before the gate armed is not a zoom-out from this level: the base moves with it.
    const base = !g.armed && moved ? g.base * (distance / g.last) : g.base;
    const quietSince = moved ? now : g.quietSince;
    const armed = g.armed || (!g.pressed && now - quietSince >= ZOOM_OUT_SETTLE_MS);
    return { base, last: distance, quietSince, pressed: g.pressed, armed };
}
