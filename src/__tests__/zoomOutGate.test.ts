/**
 * The hand zoom-out rule must only fire on a zoom-out the user made on purpose,
 * from the level's own landing distance.
 *
 * Every scenario runs on the real OrbitControls (three-stdlib) in jsdom, with
 * real wheel and pointer events, driven the way CameraRig drives it: flights,
 * a cancel on OrbitControls' 'start', and the rule checked every frame. Three
 * versions of the rule run the same input:
 * - original (95890f2): measured from the landing, armed 350 ms after it.
 *   One click with a brush of the trackpad behind it climbed to the world.
 * - carry (9629bab): zoom made before the gate armed was carried into the base
 *   in proportion. Review found it (a) could push the base to the distance
 *   limit, so the camera was left far out and no wheel-out could ever climb,
 *   and (b) lowered the base on a zoom-in, so a level was left while still
 *   zoomed in.
 * - gate (now, utils/zoomOutGate): the base is the landing distance, fixed;
 *   wheel-outs are swallowed until the camera has been still a moment after
 *   landing, and during a click; zoom-in always goes through.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three-stdlib';
import { SCENE } from '../config/constants';
import { framingDistance, stageFraming, worldFraming } from '../components/world/framing';
import { familyLevel, fieldLevel, levelKind, levelUp, WORLD_LEVEL, ZOOM_OUT_RATIO, ZOOM_OUT_SETTLE_MS, zoomedOutOfLevel, type WorldLevel } from '../utils/worldLevel';
import {
    attachWheelGate, flyingGate, landedGate, MAX_GATE_BASE, pressGate, releaseGate, stepGate, UNLANDED_GATE, type ZoomOutGate,
} from '../utils/zoomOutGate';

const STAGE = framingDistance(stageFraming(SCENE.CAMERA_FOV));
const WORLD = framingDistance(worldFraming(SCENE.CAMERA_FOV, 1470 / 746));
const PHONE_STAGE = framingDistance(stageFraming(SCENE.CAMERA_PORTRAIT_FOV));
const THRESHOLD = STAGE * ZOOM_OUT_RATIO;
const FRAME_MS = 1000 / 60;
const FLY_MS = 900;
const SERVICE = familyLevel(2);
const FOOD_SERVICE = fieldLevel('35');

// ---------------------------------------------------------------------------
// The three rules, as CameraRig feeds them.

type Variant = 'original' | 'carry' | 'gate';

interface Rule {
    land(base: number, distance: number, now: number): void;
    fly(now: number): void;
    press(now: number): void;
    release(now: number): void;
    frame(kind: ReturnType<typeof levelKind>, distance: number, flying: boolean, now: number): boolean;
}

function originalRule(): Rule {
    let levelDistance = 0;
    let settledAt = 0;
    return {
        land: (base, _d, now) => {
            levelDistance = base;
            settledAt = now;
        },
        fly: () => {},
        press: () => {},
        release: () => {},
        frame: (kind, distance, flying, now) => zoomedOutOfLevel(kind, distance, levelDistance, flying, now - settledAt >= ZOOM_OUT_SETTLE_MS),
    };
}

/** 9629bab: the same gate, but zoom before it armed scaled the base, and nothing was swallowed. */
function carryRule(): Rule {
    let g = { base: Infinity, last: NaN, quietSince: -Infinity, pressed: false, armed: false };
    return {
        land: (base, distance, now) => {
            g = { base, last: distance, quietSince: now, pressed: g.pressed, armed: false };
        },
        fly: () => {},
        press: (now) => {
            g = { ...g, pressed: true, armed: false, quietSince: now };
        },
        release: (now) => {
            if (g.pressed) g = { ...g, pressed: false, quietSince: now };
        },
        frame: (kind, distance, flying, now) => {
            if (!flying) {
                const moved = Number.isFinite(g.last) && Math.abs(distance - g.last) > 1e-6 * g.last;
                const base = !g.armed && moved ? g.base * (distance / g.last) : g.base;
                const quietSince = moved ? now : g.quietSince;
                g = { base, last: distance, quietSince, pressed: g.pressed, armed: g.armed || (!g.pressed && now - quietSince >= ZOOM_OUT_SETTLE_MS) };
            }
            return zoomedOutOfLevel(kind, distance, g.base, flying, g.armed);
        },
    };
}

function gateRule(holder: { gate: ZoomOutGate }): Rule {
    return {
        land: (base, distance, now) => {
            holder.gate = landedGate(base, distance, now, holder.gate.pressed);
        },
        fly: (now) => {
            holder.gate = flyingGate(holder.gate, now);
        },
        press: (now) => {
            holder.gate = pressGate(holder.gate, now);
        },
        release: (now) => {
            holder.gate = releaseGate(holder.gate, now);
        },
        frame: (kind, distance, flying, now) => {
            if (!flying) holder.gate = stepGate(holder.gate, distance, now);
            return zoomedOutOfLevel(kind, distance, holder.gate.base, flying, holder.gate.armed);
        },
    };
}

// ---------------------------------------------------------------------------
// CameraRig around the real OrbitControls.

interface Flight { from: number; to: number; start: number; sticky: boolean }

class Rig {
    now = 0;
    level: WorldLevel;
    visited: WorldLevel[];
    /** The camera's distance each time the rule fired. */
    firedAt: number[] = [];
    readonly holder = { gate: UNLANDED_GATE as ZoomOutGate };
    private flight: Flight | null = null;
    private readonly rule: Rule;
    private readonly win: JSDOM['window'];
    private readonly canvas: HTMLCanvasElement;
    private readonly camera: PerspectiveCamera;
    readonly controls: OrbitControls;

    constructor(variant: Variant, start: WorldLevel, private readonly phone = false) {
        const dom = new JSDOM('<div id="connected"><div><canvas></canvas></div></div>');
        this.win = dom.window;
        const container = this.win.document.getElementById('connected')!;
        this.canvas = this.win.document.querySelector('canvas')!;
        // jsdom has no pointer capture (released on pointerup) and no layout (orbit turns by drag / height).
        Object.assign(container, { releasePointerCapture: () => {} });
        Object.defineProperty(container, 'clientHeight', { value: 746 });
        this.camera = new PerspectiveCamera(phone ? SCENE.CAMERA_PORTRAIT_FOV : SCENE.CAMERA_FOV, 1470 / 746, 0.1, 2000);
        this.camera.position.set(...(phone ? SCENE.CAMERA_PORTRAIT_POSITION : SCENE.CAMERA_INITIAL_POSITION));
        this.controls = new OrbitControls(this.camera);
        Object.assign(this.controls, {
            enableDamping: true, minDistance: SCENE.MIN_CAMERA_DISTANCE, maxDistance: SCENE.MAX_CAMERA_DISTANCE, maxPolarAngle: SCENE.MAX_POLAR_ANGLE,
        });
        this.controls.connect(container as unknown as HTMLElement);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
        // Landscape: any orbit input stops a flight, unless it is a zoom-out's own.
        this.controls.addEventListener('start', () => {
            const f = this.flight;
            if (!f || f.sticky) return;
            this.flight = null;
            this.rule.land(Math.max(f.to, this.distance), this.distance, this.now);
        });
        this.rule = variant === 'original' ? originalRule() : variant === 'carry' ? carryRule() : gateRule(this.holder);
        if (variant === 'gate') {
            attachWheelGate(this.win as unknown as Window, () => container as unknown as Node, {
                get: () => this.holder.gate, set: (g) => { this.holder.gate = g; },
            }, () => this.now);
        }
        this.level = start;
        this.visited = [start];
        this.setDistance(this.landingOf(start));
        this.rule.land(this.distance, this.distance, 0);
    }

    get distance(): number {
        return this.controls.getDistance();
    }

    private landingOf(level: WorldLevel): number {
        return levelKind(level) === 'world' ? WORLD : this.phone ? PHONE_STAGE : STAGE;
    }

    private setDistance(d: number) {
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        this.camera.position.copy(this.controls.target.clone().add(dir.multiplyScalar(d)));
        this.controls.update();
    }

    private fly(to: WorldLevel, sticky: boolean) {
        this.level = to;
        this.visited.push(to);
        this.rule.fly(this.now);
        this.flight = { from: this.distance, to: this.landingOf(to), start: this.now, sticky };
    }

    /** Runs frames for `ms`. */
    wait(ms: number) {
        const end = this.now + ms;
        while (this.now < end) {
            this.now = Math.min(end, this.now + FRAME_MS);
            const f = this.flight;
            if (f) {
                const k = Math.min(1, (this.now - f.start) / FLY_MS);
                this.setDistance(f.from + (f.to - f.from) * k);
                if (k >= 1) {
                    this.flight = null;
                    this.rule.land(f.to, this.distance, this.now);
                }
            } else {
                this.controls.update();
            }
            const flying = this.flight != null;
            const distance = flying ? this.flight!.to : this.distance;
            if (this.rule.frame(levelKind(this.level), distance, flying, this.now)) {
                this.firedAt.push(this.distance);
                this.fly(levelUp(this.level), true);
            }
        }
    }

    private pointer(type: string, id: number, x: number, y: number, pointerType: 'mouse' | 'touch') {
        const e = new this.win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
        Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: pointerType }, pageX: { value: x }, pageY: { value: y } });
        this.canvas.dispatchEvent(e);
    }

    press() {
        this.rule.press(this.now);
        this.pointer('pointerdown', 1, 700, 500, 'mouse');
    }

    release() {
        this.pointer('pointerup', 1, 700, 500, 'mouse');
        this.rule.release(this.now);
    }

    /** A click's pointerup that clickAction turned into this level. */
    clickTo(level: WorldLevel) {
        this.release();
        this.fly(level, false);
    }

    /** Wheel events `every` ms apart. */
    wheels(deltaY: number, count: number, every: number) {
        for (let i = 0; i < count; i++) {
            this.canvas.dispatchEvent(new this.win.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }));
            this.wait(every);
        }
    }

    /** A two-finger pinch on a touch screen, fingers closing from `from` px apart to `to`. */
    pinch(from: number, to: number, steps: number, every: number) {
        this.pointer('pointerdown', 11, 195 - from / 2, 420, 'touch');
        this.pointer('pointerdown', 12, 195 + from / 2, 420, 'touch');
        for (let i = 1; i <= steps; i++) {
            const gap = from + ((to - from) * i) / steps;
            this.pointer('pointermove', 12, 195 - from / 2 + gap, 420, 'touch');
            this.wait(every);
        }
        this.pointer('pointerup', 12, 195 - from / 2 + to, 420, 'touch');
        this.pointer('pointerup', 11, 195 - from / 2, 420, 'touch');
    }
}

const run = (variant: Variant, start: WorldLevel, script: (rig: Rig) => void, phone = false) => {
    const rig = new Rig(variant, start, phone);
    script(rig);
    return rig;
};
const kinds = (rig: Rig) => rig.visited.map(levelKind);

// ---------------------------------------------------------------------------

describe('what changes the camera\'s distance at rest, on the real OrbitControls', () => {
    it('not a click, even one that wobbles a few pixels and so also orbits a little', () => {
        const rig = new Rig('original', FOOD_SERVICE);
        rig.press();
        rig.release();
        rig.wait(1000);
        expect(rig.distance).toBeCloseTo(STAGE, 9);
        const before = rig.controls.object.position.clone();
        rig.press();
        rig['pointer']('pointermove', 1, 704, 505, 'mouse');
        rig.release();
        rig.wait(2000);
        expect(rig.controls.object.position.distanceTo(before)).toBeGreaterThan(0.1);
        expect(rig.distance).toBeCloseTo(STAGE, 9);
    });

    it('five wheel events of one pixel each, past the zoom-out ratio: a brush of a finger looks like a zoom-out', () => {
        const rig = new Rig('original', FOOD_SERVICE);
        rig.wheels(1, 5, 0);
        expect(rig.distance / STAGE).toBeCloseTo((1 / 0.95) ** 5, 9);
        expect((1 / 0.95) ** 5).toBeGreaterThan(ZOOM_OUT_RATIO);
    });
});

// Review of 9629bab, scenario a: at the Service family, a click on Food Service
// with a brush, 3 wheel events of deltaY 2 during the press and 22 after, 16 to
// 40 ms apart; then 24 deliberate wheel-outs.
const scenarioA = (rig: Rig) => {
    rig.wait(1000);
    rig.press();
    rig.wheels(2, 3, 16);
    rig.clickTo(FOOD_SERVICE);
    for (let i = 0; i < 22; i++) rig.wheels(2, 1, [16, 40, 27, 33][i % 4]);
    rig.wait(2500);
};
const afterBrush = new Map<Variant, { level: WorldLevel; distance: number }>();

describe('(a) a click with a brush leaves the camera where the field landed, and a zoom-out can still climb', () => {
    it('gate: stays in Food Service at its own distance, then 24 wheel-outs go up to Service', () => {
        const rig = run('gate', SERVICE, scenarioA);
        expect(rig.level).toEqual(FOOD_SERVICE);
        expect(rig.distance).toBeCloseTo(STAGE, 6);
        rig.wheels(100, 24, 60);
        rig.wait(2500);
        expect(rig.visited).toEqual([SERVICE, FOOD_SERVICE, SERVICE]);
        expect(rig.firedAt[0]).toBeGreaterThan(THRESHOLD);
        expect(rig.firedAt[0]).toBeLessThan(THRESHOLD * (1 / 0.95) + 1e-6);
    });

    it('carry (9629bab): stayed in Food Service but ended at the distance limit, and 24 wheel-outs never climbed', () => {
        const rig = run('carry', SERVICE, scenarioA);
        expect(rig.level).toEqual(FOOD_SERVICE);
        expect(rig.distance).toBeCloseTo(SCENE.MAX_CAMERA_DISTANCE, 6);
        rig.wheels(100, 24, 60);
        rig.wait(2500);
        expect(rig.visited).toEqual([SERVICE, FOOD_SERVICE]);
        afterBrush.set('carry', { level: rig.level, distance: rig.distance });
    });

    it('original (95890f2): the brush climbed out of the field it had just opened', () => {
        const rig = run('original', SERVICE, scenarioA);
        expect(kinds(rig).slice(0, 3)).toEqual(['family', 'field', 'family']);
    });
});

// Scenario b: click into Food Service, zoom in with 10 wheel events as soon as
// it lands, wait 1.5 s, then 6 wheel-outs.
const scenarioB = (rig: Rig) => {
    rig.wait(1000);
    rig.press();
    rig.clickTo(FOOD_SERVICE);
    rig.wait(FLY_MS + FRAME_MS);
    rig.wheels(-100, 10, 30);
    rig.wait(1500);
    rig.wheels(100, 6, 60);
    rig.wait(1500);
};

describe('(b) zooming in never lowers the threshold', () => {
    it('gate: six wheel-outs after zooming in stay in Food Service; it climbs only past the landing distance x 1.25', () => {
        const rig = run('gate', SERVICE, scenarioB);
        expect(rig.visited).toEqual([SERVICE, FOOD_SERVICE]);
        expect(rig.distance / STAGE).toBeCloseTo(0.95 ** 10 / 0.95 ** 6, 6);
        rig.wheels(100, 20, 60);
        rig.wait(2000);
        expect(rig.visited).toEqual([SERVICE, FOOD_SERVICE, SERVICE]);
        expect(rig.firedAt[0]).toBeGreaterThan(THRESHOLD);
    });

    it('carry (9629bab): went up to Service at about 0.8 of Food Service\'s home distance', () => {
        const rig = run('carry', SERVICE, scenarioB);
        expect(rig.visited).toEqual([SERVICE, FOOD_SERVICE, SERVICE]);
        expect(rig.firedAt[0] / STAGE).toBeLessThan(0.85);
    });

    it('original (95890f2): stayed, as it measured from the landing too', () => {
        expect(run('original', SERVICE, scenarioB).visited).toEqual([SERVICE, FOOD_SERVICE]);
    });
});

describe('what 9629bab fixed still holds', () => {
    // A: one click opens Food Service; a brush with a momentum tail follows it (40 events over 1.6 s).
    const brushTail = (rig: Rig) => {
        rig.wait(1000);
        rig.press();
        rig.clickTo(FOOD_SERVICE);
        for (let i = 0; i < 40; i++) rig.wheels(Math.max(1, 6 - i / 8), 1, 40);
        rig.wait(3000);
    };

    it('A: a click with a trailing brush stays in the field, at the field\'s distance', () => {
        const gate = run('gate', SERVICE, brushTail);
        expect(gate.visited).toEqual([SERVICE, FOOD_SERVICE]);
        expect(gate.distance).toBeCloseTo(STAGE, 6);
        expect(kinds(run('original', SERVICE, brushTail)).length).toBeGreaterThan(2);
    });

    it('B: a brush during the press itself, and the click still opens the field', () => {
        const script = (rig: Rig) => {
            rig.wait(1000);
            rig.press();
            rig.wheels(2, 6, 16);
            rig.clickTo(FOOD_SERVICE);
            rig.wait(3000);
        };
        const gate = run('gate', SERVICE, script);
        expect(gate.visited).toEqual([SERVICE, FOOD_SERVICE]);
        expect(gate.distance).toBeCloseTo(STAGE, 6);
        // The original rule climbed to the world before the click landed.
        expect(run('original', SERVICE, script).visited[1]).toEqual(WORLD_LEVEL);
    });

    it('C: a deliberate zoom-out climbs one level per gesture', () => {
        const rig = run('gate', FOOD_SERVICE, (r) => {
            r.wait(1000);
            r.wheels(100, 6, 80);
            r.wait(2500);
            r.wheels(100, 6, 80);
            r.wait(2500);
        });
        expect(kinds(rig)).toEqual(['field', 'family', 'world']);
    });

    it('D: one long scroll climbs one level, not two, and does not carry on out once it lands', () => {
        const flick = (r: Rig) => {
            r.wait(1000);
            r.wheels(100, 40, 50);
            r.wait(3000);
        };
        const gate = run('gate', FOOD_SERVICE, flick);
        expect(kinds(gate)).toEqual(['field', 'family']);
        expect(gate.distance).toBeCloseTo(STAGE, 6);
        expect(kinds(run('original', FOOD_SERVICE, flick))).toEqual(['field', 'family', 'world']);
    });

    it('a pinch still zooms out of a field on a phone: touch is never held off', () => {
        const rig = run('gate', FOOD_SERVICE, (r) => {
            r.wait(1000);
            r.pinch(300, 150, 20, 20);
            r.wait(2000);
        }, true);
        expect(kinds(rig)).toEqual(['field', 'family']);
    });

    it('never changes level for a click alone, however the press and release are timed', () => {
        for (const hold of [0, 50, 200, 499]) {
            for (const at of [0, 100, 349, 351, 2000]) {
                const rig = run('gate', SERVICE, (r) => {
                    r.wait(at);
                    r.press();
                    r.wait(hold);
                    r.release();
                    r.wait(2000);
                });
                expect(rig.visited, `${at}+${hold}`).toEqual([SERVICE]);
            }
        }
    });

    it('lets zoom-out through at the world before anything has landed', () => {
        const rig = new Rig('gate', WORLD_LEVEL);
        rig.holder.gate = UNLANDED_GATE;
        rig.wheels(100, 3, 60);
        expect(rig.distance).toBeGreaterThan(WORLD * 1.1);
    });
});

describe('the gate', () => {
    it('keeps the threshold reachable even for a flight stopped short far out', () => {
        expect(MAX_GATE_BASE * ZOOM_OUT_RATIO).toBeLessThan(SCENE.MAX_CAMERA_DISTANCE);
        expect(landedGate(SCENE.MAX_CAMERA_DISTANCE, SCENE.MAX_CAMERA_DISTANCE, 0).base).toBe(MAX_GATE_BASE);
        expect(landedGate(STAGE, 40, 0).base).toBe(STAGE);
    });

    it('never fires on arming after a flight stopped short past the threshold: it waits for the camera to come back inside', () => {
        const far = SCENE.MAX_CAMERA_DISTANCE;
        let g = landedGate(far, far, 0);
        expect(far).toBeGreaterThan(g.base * ZOOM_OUT_RATIO);
        // Held still long past the quiet time: still not armed, so the rule cannot fire on its own.
        for (let t = FRAME_MS; t <= 5000; t += FRAME_MS) {
            g = stepGate(g, far, t);
            expect(zoomedOutOfLevel('field', far, g.base, false, g.armed), `${t}`).toBe(false);
        }
        expect(g.armed).toBe(false);
        // Zoomed back inside (zoom-in always goes through): it arms after the quiet time, and the threshold is reachable.
        const inside = g.base * ZOOM_OUT_RATIO * 0.9;
        g = stepGate(g, inside, 5100);
        g = stepGate(g, inside, 5100 + ZOOM_OUT_SETTLE_MS);
        expect(g.armed).toBe(true);
        expect(zoomedOutOfLevel('field', inside, g.base, false, g.armed)).toBe(false);
        expect(zoomedOutOfLevel('field', g.base * ZOOM_OUT_RATIO * 1.01, g.base, false, g.armed)).toBe(true);
    });

    it('never moves the base, whatever the camera does before or after arming', () => {
        let g = landedGate(STAGE, STAGE, 0);
        for (const [d, t] of [[40, 100], [120, 200], [30, 600], [90, 1200]] as const) g = stepGate(g, d, t);
        expect(g.base).toBe(STAGE);
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
        expect(flyingGate(g, 6000).armed).toBe(false);
    });

    it('keeps a press that is still down across a landing', () => {
        expect(stepGate(landedGate(STAGE, STAGE, 0, true), STAGE, 10_000).armed).toBe(false);
    });

    it('swallows only wheel-outs over the 3D view, cancelling them, and only while not armed', () => {
        const dom = new JSDOM('<div id="view"><canvas></canvas></div><div id="panel"></div>');
        const win = dom.window;
        const holder = { gate: landedGate(STAGE, STAGE, 0) };
        attachWheelGate(win as unknown as Window, () => win.document.getElementById('view'), {
            get: () => holder.gate, set: (g) => { holder.gate = g; },
        }, () => 123);
        const reached: number[] = [];
        win.document.getElementById('view')!.addEventListener('wheel', (e) => reached.push((e as WheelEvent).deltaY));
        win.document.getElementById('panel')!.addEventListener('wheel', (e) => reached.push((e as WheelEvent).deltaY));
        const send = (id: string, deltaY: number) => {
            const e = new win.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY });
            (id === 'view' ? win.document.querySelector('canvas')! : win.document.getElementById(id)!).dispatchEvent(e);
            return e.defaultPrevented;
        };
        expect(send('view', 2)).toBe(true);
        expect(holder.gate.quietSince).toBe(123);
        expect(send('view', -100)).toBe(false);
        expect(send('panel', 100)).toBe(false);
        holder.gate = { ...holder.gate, armed: true };
        expect(send('view', 100)).toBe(false);
        expect(reached).toEqual([-100, 100, 100]);
    });
});
