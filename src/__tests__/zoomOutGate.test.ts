/**
 * The hand zoom-out rule must only fire on a zoom-out the user made on
 * purpose. Review of PR #88: on a 1470x723 window, one click on Food Service
 * in the Service family sent the view to the world, zoomed far out.
 *
 * What moved the camera: nothing in a click, a flight or a resize changes its
 * distance (checked here on the real OrbitControls), but OrbitControls zooms
 * 5% for every wheel event however small, and a trackpad or Magic Mouse sends
 * a run of small ones, with a momentum tail, from a finger brushing it during
 * a click. The old rule armed 350 ms after any landing whatever was still
 * moving: the click's field flight was cut short by the first wheel event (any
 * orbit input cancels a flight), so 350 ms later the run had passed 1.25 and
 * climbed to the family, and its tail outlasted that flight too, so it climbed
 * again to the world and went on zooming out there. utils/zoomOutGate counts
 * only zoom made after the camera has been still since it landed, and none
 * during a click.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three-stdlib';
import { SCENE } from '../config/constants';
import { framingDistance, stageFraming, worldFraming } from '../components/world/framing';
import { familyLevel, fieldLevel, levelKind, levelUp, ZOOM_OUT_RATIO, ZOOM_OUT_SETTLE_MS, zoomedOutOfLevel, type WorldLevel } from '../utils/worldLevel';
import { landedGate, pressGate, releaseGate, stepGate, UNLANDED_GATE, type ZoomOutGate } from '../utils/zoomOutGate';

const STAGE = framingDistance(stageFraming(SCENE.CAMERA_FOV));
const WORLD = framingDistance(worldFraming(SCENE.CAMERA_FOV, 1470 / 723));
const PHONE_STAGE = framingDistance(stageFraming(SCENE.CAMERA_PORTRAIT_FOV));
/** OrbitControls' zoom per wheel event at zoomSpeed 1, whatever the event's size. */
const WHEEL = 1 / 0.95;
const FRAME_MS = 1000 / 60;
const FLY_MS = 900;

// ---------------------------------------------------------------------------
// The real OrbitControls, in jsdom: what can change the camera's distance.

function liveControls() {
    const dom = new JSDOM('<div><canvas></canvas></div>');
    const win = dom.window;
    const container = win.document.querySelector('div')!;
    const canvas = win.document.querySelector('canvas')!;
    // jsdom has no pointer capture (OrbitControls releases it on pointerup) and no layout (it turns by drag / height).
    Object.assign(container, { releasePointerCapture: () => {} });
    Object.defineProperty(container, 'clientHeight', { value: 723 });
    const camera = new PerspectiveCamera(SCENE.CAMERA_FOV, 1470 / 723, 0.1, 2000);
    camera.position.set(...SCENE.CAMERA_INITIAL_POSITION);
    const controls = new OrbitControls(camera);
    // As Landscape sets it up (drei turns damping on).
    Object.assign(controls, {
        enableDamping: true, minDistance: SCENE.MIN_CAMERA_DISTANCE, maxDistance: SCENE.MAX_CAMERA_DISTANCE, maxPolarAngle: SCENE.MAX_POLAR_ANGLE,
    });
    controls.connect(container as unknown as HTMLElement);
    controls.target.set(0, 0, 0);
    controls.update();
    // jsdom has no PointerEvent either: a MouseEvent carrying the pointer fields.
    const pointer = (type: string, x: number, y: number) => {
        const e = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
        Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
        canvas.dispatchEvent(e);
    };
    const wheel = (deltaY: number) => canvas.dispatchEvent(new win.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }));
    // Damping carries a gesture on for many frames after it ends.
    const frames = (n = 120) => {
        for (let i = 0; i < n; i++) controls.update();
    };
    return { camera, controls, pointer, wheel, frames };
}

describe('what changes the camera\'s distance at rest', () => {
    it('a click does not, even one that wobbles a few pixels and so also orbits a little', () => {
        const { camera, controls, pointer, frames } = liveControls();
        pointer('pointerdown', 700, 500);
        pointer('pointerup', 700, 500);
        frames();
        expect(controls.getDistance()).toBeCloseTo(STAGE, 9);
        // Still a click to WorldMarkers (under 10 px), but OrbitControls turns the view with it.
        const before = camera.position.clone();
        pointer('pointerdown', 700, 500);
        pointer('pointermove', 704, 505);
        pointer('pointerup', 704, 505);
        frames();
        expect(camera.position.distanceTo(before)).toBeGreaterThan(0.1);
        expect(controls.getDistance()).toBeCloseTo(STAGE, 9);
    });

    it('a resize does not: the camera stays where it is', () => {
        const { camera, controls, frames } = liveControls();
        camera.aspect = 1470 / 779;
        camera.updateProjectionMatrix();
        frames(10);
        camera.aspect = 1470 / 723;
        camera.updateProjectionMatrix();
        frames(10);
        expect(controls.getDistance()).toBeCloseTo(STAGE, 9);
    });

    it('five wheel events of one pixel each do, past the zoom-out ratio: a brush of a finger looks like a zoom-out', () => {
        const { controls, wheel, frames } = liveControls();
        for (let i = 0; i < 5; i++) wheel(1);
        frames(1);
        expect(controls.getDistance() / STAGE).toBeCloseTo(WHEEL ** 5, 9);
        expect(WHEEL ** 5).toBeGreaterThan(ZOOM_OUT_RATIO);
    });
});

// ---------------------------------------------------------------------------
// CameraRig's loop, reduced to what decides the level: the camera's distance,
// the flight, and the rule. The old rule and the gate run the same input.

type Input = { at: number } & (
    | { kind: 'wheel'; dy: number }
    | { kind: 'press' }
    | { kind: 'release' }
    /** A click's pointerup, which clickAction turned into this level. */
    | { kind: 'click'; level: WorldLevel }
);

interface Flight { from: number; to: number; start: number; sticky: boolean }

interface Rule {
    land(base: number, distance: number, now: number): void;
    press(now: number): void;
    release(now: number): void;
    /** Whether the rule fires this frame. */
    frame(kind: ReturnType<typeof levelKind>, distance: number, flying: boolean, now: number): boolean;
}

/** The rule before the gate: measured from the landing, armed a fixed time after it. */
function oldRule(): Rule {
    let levelDistance = 0;
    let settledAt = 0;
    return {
        land: (base, _distance, now) => {
            levelDistance = base;
            settledAt = now;
        },
        press: () => {},
        release: () => {},
        frame: (kind, distance, flying, now) => zoomedOutOfLevel(kind, distance, levelDistance, flying, now - settledAt >= ZOOM_OUT_SETTLE_MS),
    };
}

/** CameraRig now. */
function gatedRule(): Rule & { gate: () => ZoomOutGate } {
    let gate: ZoomOutGate = UNLANDED_GATE;
    return {
        gate: () => gate,
        land: (base, distance, now) => {
            gate = landedGate(base, distance, now, gate.pressed);
        },
        press: (now) => {
            gate = pressGate(gate, now);
        },
        release: (now) => {
            gate = releaseGate(gate, now);
        },
        frame: (kind, distance, flying, now) => {
            if (!flying) gate = stepGate(gate, distance, now);
            return zoomedOutOfLevel(kind, distance, gate.base, flying, gate.armed);
        },
    };
}

const landingOf = (level: WorldLevel, phone = false) => (levelKind(level) === 'world' ? WORLD : phone ? PHONE_STAGE : STAGE);

/**
 * Runs `inputs` from rest at `start` (landed at t = 0) for `ms`, one frame at a
 * time, and returns every level the view was at, in order.
 */
function run(rule: Rule, start: WorldLevel, inputs: Input[], ms: number, phone = false) {
    let level = start;
    let distance = landingOf(level, phone);
    let flight: Flight | null = null;
    const visited = [level];
    const fly = (to: WorldLevel, now: number, sticky: boolean) => {
        level = to;
        visited.push(level);
        flight = { from: distance, to: landingOf(level, phone), start: now, sticky };
    };
    rule.land(distance, distance, 0);
    const queue = [...inputs].sort((a, b) => a.at - b.at);
    for (let now = 0; now <= ms; now += FRAME_MS) {
        while (queue.length && queue[0].at <= now) {
            const input = queue.shift()!;
            if (input.kind === 'press') rule.press(input.at);
            if (input.kind === 'release') rule.release(input.at);
            if (input.kind === 'click') fly(input.level, input.at, false);
            if (input.kind === 'wheel') {
                // OrbitControls says it has started, which stops any flight but a zoom-out's own, then zooms.
                const f = flight as Flight | null;
                if (f && !f.sticky) {
                    rule.land(Math.max(f.to, distance), distance, input.at);
                    flight = null;
                }
                distance = Math.min(SCENE.MAX_CAMERA_DISTANCE, distance * (input.dy > 0 ? WHEEL : 1 / WHEEL));
            }
        }
        const f = flight as Flight | null;
        if (f) {
            const k = Math.min(1, (now - f.start) / FLY_MS);
            distance = f.from + (f.to - f.from) * k;
            if (k >= 1) {
                flight = null;
                rule.land(f.to, distance, now);
            }
        }
        const flying = flight != null;
        if (rule.frame(levelKind(level), flying ? (flight as Flight | null)!.to : distance, flying, now)) fly(levelUp(level), now, true);
    }
    return { visited, level, distance };
}

const SERVICE = familyLevel(2);
const FOOD_SERVICE = fieldLevel('35');
const wheels = (from: number, count: number, every: number, dy = 1): Input[] =>
    Array.from({ length: count }, (_, i) => ({ at: from + i * every, kind: 'wheel' as const, dy }));

describe('one click on Food Service in the Service family, with a brush of the trackpad behind it', () => {
    // The click lands a second after the family did; the finger's momentum
    // tail is 40 small events over 1.6 s, each one 5% to OrbitControls.
    const reported: Input[] = [
        { at: 1000, kind: 'press' },
        { at: 1080, kind: 'release' },
        { at: 1080, kind: 'click', level: FOOD_SERVICE },
        ...wheels(1100, 40, 40),
    ];

    it('climbed to the world under the old rule: the bug', () => {
        const { visited, level } = run(oldRule(), SERVICE, reported, 6000);
        expect(visited).toEqual([SERVICE, FOOD_SERVICE, SERVICE, { focusedFamily: null, focusedContinent: null }]);
        expect(levelKind(level)).toBe('world');
    });

    it('stays in Food Service now: the click opens the field and nothing else changes level', () => {
        const rule = gatedRule();
        const { visited, level } = run(rule, SERVICE, reported, 6000);
        expect(visited).toEqual([SERVICE, FOOD_SERVICE]);
        expect(level).toEqual(FOOD_SERVICE);
        // The run zoomed the camera out, but before the gate armed, so it moved the base with it.
        expect(rule.gate().armed).toBe(true);
        expect(rule.gate().base).toBeCloseTo(rule.gate().last, 9);
    });

    it('stays in the family when the brush comes during the press itself, and the click then opens the field', () => {
        const inputs: Input[] = [
            { at: 1000, kind: 'press' },
            ...wheels(1010, 6, 16),
            { at: 1120, kind: 'release' },
            { at: 1120, kind: 'click', level: FOOD_SERVICE },
        ];
        expect(run(oldRule(), SERVICE, inputs, 4000).visited[1]).toEqual({ focusedFamily: null, focusedContinent: null });
        expect(run(gatedRule(), SERVICE, inputs, 4000).visited).toEqual([SERVICE, FOOD_SERVICE]);
    });

    it('never changes level for a click alone, however the press and release are timed', () => {
        for (const hold of [0, 50, 200, 499]) {
            for (const at of [0, 100, 349, 351, 2000]) {
                const inputs: Input[] = [{ at, kind: 'press' }, { at: at + hold, kind: 'release' }];
                expect(run(gatedRule(), SERVICE, inputs, at + hold + 2000).visited, `${at}+${hold}`).toEqual([SERVICE]);
            }
        }
    });
});

describe('a zoom-out made on purpose', () => {
    it('still goes up one level once the stage is at rest: five mouse-wheel notches from a field', () => {
        const { visited } = run(gatedRule(), FOOD_SERVICE, wheels(1000, 5, 80, 100), 4000);
        expect(visited).toEqual([FOOD_SERVICE, SERVICE]);
    });

    it('goes up a level per gesture: a second one after a pause reaches the world', () => {
        const { visited } = run(gatedRule(), FOOD_SERVICE, [...wheels(1000, 5, 80, 100), ...wheels(3500, 5, 80, 100)], 6000);
        expect(visited.map(levelKind)).toEqual(['field', 'family', 'world']);
    });

    it('climbs one level, not two, for one long flick that coasts on past the landing', () => {
        const flick = wheels(1000, 40, 50, 100);
        expect(run(oldRule(), FOOD_SERVICE, flick, 6000).visited.map(levelKind)).toEqual(['field', 'family', 'world']);
        expect(run(gatedRule(), FOOD_SERVICE, flick, 6000).visited.map(levelKind)).toEqual(['field', 'family']);
    });

    it('counts a partway zoom made before a click: the click does not move the base', () => {
        const inputs: Input[] = [...wheels(1000, 3, 80, 100), { at: 2000, kind: 'press' }, { at: 2060, kind: 'release' }, ...wheels(3000, 2, 80, 100)];
        // 3 notches, a click, 2 more: 1.05^5 is past 1.25 from where the field landed.
        expect(run(gatedRule(), FOOD_SERVICE, inputs, 5000).visited).toEqual([FOOD_SERVICE, SERVICE]);
    });

    it('still works by pinch on a phone: touch never holds the rule off', () => {
        // A pinch reaches OrbitControls as dolly steps; CameraRig only presses the gate for a mouse or pen.
        const { visited } = run(gatedRule(), FOOD_SERVICE, wheels(1000, 6, 30), 4000, true);
        expect(visited).toEqual([FOOD_SERVICE, SERVICE]);
    });
});

describe('the gate', () => {
    it('fires nothing before anything has landed', () => {
        let g: ZoomOutGate = UNLANDED_GATE;
        for (let t = 0; t < 2000; t += FRAME_MS) g = stepGate(g, SCENE.MAX_CAMERA_DISTANCE, t);
        expect(zoomedOutOfLevel('field', SCENE.MAX_CAMERA_DISTANCE, g.base, false, g.armed)).toBe(false);
    });

    it('arms after ZOOM_OUT_SETTLE_MS of stillness, and not while a press is down', () => {
        let g = landedGate(STAGE, STAGE, 0);
        g = stepGate(g, STAGE, ZOOM_OUT_SETTLE_MS - 1);
        expect(g.armed).toBe(false);
        g = stepGate(g, STAGE, ZOOM_OUT_SETTLE_MS);
        expect(g.armed).toBe(true);
        g = pressGate(g, 1000);
        g = stepGate(g, STAGE, 5000);
        expect(g.armed).toBe(false);
        g = releaseGate(g, 5000);
        g = stepGate(g, STAGE, 5000 + ZOOM_OUT_SETTLE_MS);
        expect(g.armed).toBe(true);
    });

    it('keeps a press that is still down across a landing', () => {
        const g = landedGate(STAGE, STAGE, 0, true);
        expect(stepGate(g, STAGE, 10_000).armed).toBe(false);
    });
});
