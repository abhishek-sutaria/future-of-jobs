import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useWorldStore } from '../../worldStore';
import { useStore } from '../../store';
import type { WorldScene } from './worldScene';
import type { GlobeScene } from './globeScene';
import { useWorldView, worldCamera } from './worldCamera';
import { configureControls, freeBand } from './cameraControls';
import { worldPointer } from './worldPointer';
import { GLOBE_MAX_TILT, globeDistance, globeFraming, globeViewShift, REGION_MARGIN, regionFraming as frameRegion, type Framing } from './framing';
import { GLOBE_RADIUS, LAND_RADIUS, unitVector } from '../../utils/globeLayout';

/** Phase-2 flight between two framings of the flat map. */
const FLY_MS = 900;
/** Globe: turn the tapped continent to face the camera. */
const TURN_MS = 600;
/** Globe: close in on it. */
const DIVE_MS = 450;
/** Flat field, after the cut: from straight above down to the field's framing. */
const ARRIVE_MS = 800;
/** Flat field, leaving: back up to straight above. */
const RISE_MS = 450;
/** Globe, after the cut: back out to the whole globe. */
const ZOOM_OUT_MS = 650;
/** The cut between globe and field hides behind a quick fade to the page background. */
const FADE_MS = 240;
/** Auto-rotation starts this long after the last interaction. */
const AUTO_ROTATE_DELAY_MS = 4000;
/** One turn in two minutes, on any device (OrbitControls' own auto-rotate counts frames, so a slow phone barely moved). */
const AUTO_ROTATE_RAD_PER_S = (2 * Math.PI) / 120;
const UP = new Vector3(0, 1, 0);

/** Straight-down-ish view the flat field starts from and leaves through. */
const OVERHEAD_ELEVATION_DEG = 84;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

type Phase =
    /** Flat map: target and position lerp (phase-2 flights, and the arrival after a dive). */
    | { kind: 'fly'; fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3; start: number; ms: number; arriving: string | null; fadeIn: boolean }
    /** Globe: direction slerps to the continent; distance eases toward `dist`. */
    | { kind: 'turn'; code: string; from: Vector3; to: Vector3; d0: number; d1: number; start: number }
    /** Globe: turn to face a direction and stay on the globe (the Kelley filter). */
    | { kind: 'face'; from: Vector3; to: Vector3; start: number }
    | { kind: 'dive'; code: string; dir: Vector3; d0: number; d1: number; start: number }
    | { kind: 'rise'; code: string; fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3; start: number }
    | { kind: 'zoomOut'; dir: Vector3; d0: number; d1: number; start: number; fadeIn: boolean };

/** Where the Kelley roles are densest: the mean of their peaks' normals, tilted no steeper than GLOBE_MAX_TILT. */
function kelleyDirection(globe: GlobeScene): Vector3 | null {
    const sum = new Vector3();
    for (const g of globe.peakByKey.values()) {
        if (g.peak.entry.kind === 'kelley') sum.add(new Vector3(...g.dir));
    }
    if (sum.lengthSq() < 1e-9) return null;
    sum.normalize();
    const lat = Math.max(-GLOBE_MAX_TILT, Math.min(GLOBE_MAX_TILT, Math.asin(sum.y)));
    return new Vector3(...unitVector(Math.atan2(sum.x, sum.z), Math.sin(lat)));
}

const q = new Quaternion();
const qFull = new Quaternion();
const v = new Vector3();

/**
 * Carries the camera between the globe and a field whenever the world store
 * asks (focusContinent / setKelleyOnly bump focusRequestId):
 *
 * - globe → field: turn the continent to the front, close in, cut (behind a
 *   short fade) to the flat phase-2 field seen from straight above, and settle
 *   into its framing;
 * - field → globe ("All fields"): the same in reverse;
 * - field → field: the phase-2 flight across the flat map.
 *
 * It also owns auto-rotation on the globe, and turns the Kelley side of the
 * globe to the front when that filter goes on. A grab on the controls cancels
 * a phase-2 flight or that turn (worldCamera.cancel, from Landscape's
 * OrbitControls onStart); the moves between globe and field run with the
 * controls off.
 */
export const CameraRig: React.FC<{
    controlsRef: React.RefObject<OrbitControlsImpl | null>;
    scene: WorldScene;
    globe: GlobeScene;
    reducedMotion: boolean;
    /** Phones: the first interaction stops auto-rotation for good (it costs battery). */
    spinUntilFirstTouch: boolean;
    fadeRef: React.RefObject<HTMLDivElement | null>;
}> = ({ controlsRef, scene, globe, reducedMotion, spinUntilFirstTouch, fadeRef }) => {
    const focused = useWorldStore((s) => s.focusedContinent);
    const requestId = useWorldStore((s) => s.focusRequestId);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const lastKelley = useRef(kelleyOnly);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const size = useThree((s) => s.size);
    const phase = useRef<Phase | null>(null);
    /** The field the flat view is showing (or last showed), for the way back up. */
    const lastField = useRef<string | null>(null);
    const pending = useRef<Array<{ code: string; open: () => void }>>([]);
    const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFade = useRef(-1);
    /** Distance of the globe's home view as last framed (mount, Reset view, back from a field): what "Reset view" compares against. */
    const home = useRef(NaN);

    const ms = (n: number) => (reducedMotion ? 0 : n);
    const aspect = () => size.width / Math.max(1, size.height);

    const regionFraming = (code: string, elevationDeg?: number, margin?: number): Framing | null => {
        const region = scene.layout.regionByCode.get(code);
        return region ? frameRegion(region.rect, camera.fov, aspect(), freeBand(), { elevationDeg, margin }) : null;
    };
    // The band the globe sits in: below the header and the fields bar's row
    // of buttons (the notes under it come and go with the filter), above the
    // year slider. The chrome re-wraps as buttons come and go, so it is
    // re-read at most once a second.
    const bandCache = useRef({ at: -Infinity, w: 0, h: 0, distance: 0, shift: 0 });
    const globeBand = () => {
        const now = performance.now();
        const c = bandCache.current;
        if (now - c.at > 1000 || c.w !== size.width || c.h !== size.height) {
            const band = freeBand('[data-world-bar] > div');
            c.distance = globeDistance(camera.fov, aspect(), band);
            c.shift = globeViewShift(size.height, band);
            c.at = now;
            c.w = size.width;
            c.h = size.height;
        }
        return c;
    };
    const defaultDistance = () => globeBand().distance;
    /**
     * On the globe, move the projection's centre down (or up) to the middle
     * of the band, so the globe is centred between the chrome rather than on
     * the screen. The flat field frames its own band (frameRect), so it has none.
     */
    const applyViewShift = (view: 'globe' | 'field') => {
        const shift = view === 'globe' ? Math.round(globeBand().shift) : 0;
        const current = camera.view?.enabled ? -camera.view.offsetY : 0;
        const stale = !!camera.view?.enabled && (camera.view.fullWidth !== size.width || camera.view.fullHeight !== size.height);
        if (shift === current && !stale) return;
        if (shift === 0) camera.clearViewOffset();
        else camera.setViewOffset(size.width, size.height, 0, -shift, size.width, size.height);
    };
    /** Direction the camera looks at a continent from: its centre, tilted no steeper than GLOBE_MAX_TILT. */
    const continentDir = (code: string) => {
        const c = globe.layout.continentByCode.get(code);
        if (!c) return null;
        const lat = Math.max(-GLOBE_MAX_TILT, Math.min(GLOBE_MAX_TILT, Math.asin(c.sinLat)));
        return new Vector3(...unitVector(c.lon, Math.sin(lat)));
    };
    /** Close enough that the continent fills most of the smaller field of view. */
    const diveDistance = (code: string, from: number) => {
        const c = globe.layout.continentByCode.get(code);
        const vHalf = (camera.fov * Math.PI) / 360;
        const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * aspect()));
        const above = ((c?.reach ?? 0.3) * LAND_RADIUS) / Math.tan(half * 0.85);
        return Math.min(from * 0.8, Math.max(GLOBE_RADIUS * 1.3, LAND_RADIUS + above));
    };

    /** The home view looks at the Kelley side of the globe (as the Kelley toggle does). */
    const homeDirection = () => kelleyDirection(globe) ?? new Vector3(...globeFraming(camera.fov, aspect()).position).normalize();

    const flush = (code: string | null) => {
        if (safety.current) clearTimeout(safety.current);
        safety.current = null;
        const list = pending.current;
        pending.current = [];
        for (const p of list) if (p.code === code) p.open();
    };

    const setControls = (enabled: boolean) => {
        const controls = controlsRef.current;
        if (controls) controls.enabled = enabled;
    };

    useEffect(() => {
        worldCamera.cancel = () => {
            // Only the flat map's flights and the Kelley turn give way to a
            // grab; the short moves between globe and field run with the
            // controls off.
            const p = phase.current;
            if (p?.kind === 'face') phase.current = null;
            if (p?.kind === 'fly') {
                phase.current = null;
                if (p.arriving) flush(p.arriving);
                useWorldView.setState({ moving: false });
            }
        };
        worldCamera.whenArrived = (code, open) => {
            const s = useStore.getState();
            const live = s.mapView === 'globe' && s.route !== 'dashboard' && document.visibilityState !== 'hidden';
            // In a field already: open at once, as phase 2 did.
            if (!live || (useWorldView.getState().view === 'field' && phase.current?.kind !== 'rise')) {
                open();
                return;
            }
            pending.current.push({ code, open });
            if (safety.current) clearTimeout(safety.current);
            // Never strand a panel behind a flight that cannot finish (a paused loop, say).
            safety.current = setTimeout(() => flush(code), 4000);
        };
        worldCamera.globeDistance = () => home.current;
        worldCamera.reset = () => {
            const controls = controlsRef.current;
            phase.current = null;
            pending.current = [];
            lastField.current = null;
            if (useWorldStore.getState().focusedContinent) useWorldStore.setState({ focusedContinent: null });
            useWorldView.setState({ view: 'globe', moving: false });
            if (!controls) return;
            controls.enabled = true;
            configureControls(controls, 'globe', defaultDistance());
            const framing = globeFraming(camera.fov, aspect(), freeBand('[data-world-bar] > div'));
            home.current = Math.hypot(...framing.position);
            controls.target.set(...framing.target);
            camera.position.copy(homeDirection()).multiplyScalar(home.current);
            controls.update();
        };
        return () => {
            worldCamera.cancel = () => {};
            worldCamera.whenArrived = (_code, open) => open();
            worldCamera.reset = () => {};
            worldCamera.globeDistance = () => NaN;
        };
    });
    useEffect(() => () => {
        if (safety.current) clearTimeout(safety.current);
    }, []);

    // A fresh canvas (first load, or a remount after a lost WebGL context)
    // starts where the store says: in the zoomed field, or on the globe.
    useEffect(() => {
        const code = useWorldStore.getState().focusedContinent;
        const controls = controlsRef.current;
        const framing = code ? regionFraming(code) : null;
        if (code && framing && controls) {
            useWorldView.setState({ view: 'field', moving: false });
            configureControls(controls, 'field', defaultDistance());
            lastField.current = code;
            controls.target.set(...framing.target);
            camera.position.set(...framing.position);
            controls.update();
        } else {
            useWorldView.setState({ view: 'globe', moving: false });
            if (controls) {
                configureControls(controls, 'globe', defaultDistance());
                // The canvas was framed before the chrome existed; fit the globe
                // between it now, turned to the side with the most Kelley roles
                // so a first visit opens on coloured peaks.
                home.current = defaultDistance();
                camera.position.copy(homeDirection()).multiplyScalar(home.current);
                // Hold that first view a moment before any auto-rotation.
                worldPointer.lastInteraction = performance.now();
                controls.update();
            }
        }
        // Mount only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (requestId === 0) return;
        const controls = controlsRef.current;
        if (!controls) return;
        const now = performance.now();
        const { view } = useWorldView.getState();
        const current = phase.current;
        worldPointer.lastInteraction = now;

        const kelleyTurnedOn = kelleyOnly && !lastKelley.current;
        lastKelley.current = kelleyOnly;

        if (view === 'globe' && current?.kind !== 'rise') {
            if (!focused && kelleyTurnedOn && !current) {
                // Turn the side with the most Kelley roles to the front, as
                // the flat map re-framed itself for them.
                const to = kelleyDirection(globe);
                if (to) phase.current = { kind: 'face', from: camera.position.clone().normalize(), to, start: now };
                return;
            }
            if (focused) {
                const to = continentDir(focused);
                if (!to) return;
                const from = camera.position.clone().normalize();
                const d0 = camera.position.length();
                setControls(false);
                useWorldView.setState({ moving: true });
                phase.current = { kind: 'turn', code: focused, from, to, d0, d1: Math.min(d0, defaultDistance()), start: now };
            } else if (current && current.kind !== 'zoomOut') {
                // "All fields" while still turning toward a continent: stay on the globe.
                pending.current = [];
                const d0 = camera.position.length();
                phase.current = { kind: 'zoomOut', dir: camera.position.clone().normalize(), d0, d1: Math.max(d0, defaultDistance()), start: now, fadeIn: false };
            }
            return;
        }

        if (focused) {
            // Field to field (or the Kelley filter re-framing this field): the phase-2 flight.
            const framing = regionFraming(focused);
            if (!framing) return;
            setControls(true);
            useWorldView.setState({ view: 'field' });
            lastField.current = focused;
            phase.current = {
                kind: 'fly', fromT: controls.target.clone(), fromP: camera.position.clone(),
                toT: new Vector3(...framing.target), toP: new Vector3(...framing.position), start: now, ms: FLY_MS, arriving: focused, fadeIn: false,
            };
            return;
        }

        // Leaving a field for the globe: rise to straight above it, then cut.
        const code = lastField.current;
        const overhead = code ? regionFraming(code, OVERHEAD_ELEVATION_DEG, REGION_MARGIN * 1.6) : null;
        pending.current = [];
        setControls(false);
        useWorldView.setState({ moving: true });
        if (!code || !overhead) {
            phase.current = { kind: 'rise', code: code ?? '', fromT: controls.target.clone(), fromP: camera.position.clone(), toT: controls.target.clone(), toP: camera.position.clone(), start: now - RISE_MS };
            return;
        }
        phase.current = {
            kind: 'rise', code, fromT: controls.target.clone(), fromP: camera.position.clone(),
            toT: new Vector3(...overhead.target), toP: new Vector3(...overhead.position), start: now,
        };
        // Flights are only requested from the UI, so the scene, size and
        // framing they read are current; re-running on resize would yank the
        // camera away from wherever the user has since orbited it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestId]);

    const setFade = (value: number) => {
        const v01 = Math.max(0, Math.min(1, value));
        if (Math.abs(v01 - lastFade.current) < 0.002) return;
        lastFade.current = v01;
        if (fadeRef.current) fadeRef.current.style.opacity = String(v01);
    };

    useFrame((_, delta) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const now = performance.now();
        const { view, moving } = useWorldView.getState();
        applyViewShift(view);

        // Slow spin on the globe once the user has let go for a while.
        // It holds still while the pointer is over the globe or a continent's
        // name, and on phones stops for good at the first touch.
        const spin = view === 'globe' && !moving && !reducedMotion && phase.current === null
            && !useStore.getState().isOrbiting
            && !worldPointer.hoverRegion && !worldPointer.overGlobe && !worldPointer.overLabel
            && !(spinUntilFirstTouch && worldPointer.interacted)
            && now - worldPointer.lastInteraction > AUTO_ROTATE_DELAY_MS;
        if (spin) {
            // Turn the camera about the globe's axis by elapsed time (capped, so
            // a paused tab does not jump on its return).
            camera.position.applyAxisAngle(UP, -AUTO_ROTATE_RAD_PER_S * Math.min(delta, 0.25));
            controls.update();
        }
        if (view === 'globe') {
            // A drag across the globe turns it about half a turn at the default
            // view, and proportionally less as you zoom in on the surface.
            const above = camera.position.length() - GLOBE_RADIUS;
            controls.rotateSpeed = Math.min(0.9, Math.max(0.12, (0.7 * above) / Math.max(1, defaultDistance() - GLOBE_RADIUS)));
        }

        const p = phase.current;
        if (!p) {
            setFade(0);
            return;
        }
        const elapsed = now - p.start;

        if (p.kind === 'fly') {
            const t = p.ms > 0 ? Math.min(1, elapsed / p.ms) : 1;
            const k = ease(t);
            controls.target.lerpVectors(p.fromT, p.toT, k);
            camera.position.lerpVectors(p.fromP, p.toP, k);
            controls.update();
            setFade(p.fadeIn ? 1 - elapsed / FADE_MS : 0);
            if (t >= 1 && (!p.fadeIn || elapsed >= FADE_MS)) {
                phase.current = null;
                useWorldView.setState({ moving: false });
                if (p.arriving) flush(p.arriving);
            }
            return;
        }

        if (p.kind === 'turn') {
            const dur = ms(TURN_MS);
            const t = dur > 0 ? Math.min(1, elapsed / dur) : 1;
            const k = ease(t);
            qFull.setFromUnitVectors(p.from, p.to);
            q.identity().slerp(qFull, k);
            v.copy(p.from).applyQuaternion(q).multiplyScalar(p.d0 + (p.d1 - p.d0) * k);
            camera.position.copy(v);
            camera.lookAt(0, 0, 0);
            setFade(0);
            if (t >= 1) {
                phase.current = { kind: 'dive', code: p.code, dir: p.to.clone(), d0: p.d1, d1: diveDistance(p.code, p.d1), start: now };
            }
            return;
        }

        if (p.kind === 'face') {
            const dur = ms(TURN_MS);
            const t = dur > 0 ? Math.min(1, elapsed / dur) : 1;
            qFull.setFromUnitVectors(p.from, p.to);
            q.identity().slerp(qFull, ease(t));
            v.copy(p.from).applyQuaternion(q).multiplyScalar(camera.position.length());
            camera.position.copy(v);
            controls.update();
            setFade(0);
            if (t >= 1) phase.current = null;
            return;
        }

        if (p.kind === 'dive') {
            const dur = ms(DIVE_MS);
            const t = dur > 0 ? Math.min(1, elapsed / dur) : 1;
            const k = t * t;
            camera.position.copy(p.dir).multiplyScalar(p.d0 + (p.d1 - p.d0) * k);
            camera.lookAt(0, 0, 0);
            setFade(dur > 0 ? smooth(0.55, 1, t) : 1);
            if (t >= 1) {
                // The cut: the flat field, from straight above, then down into its framing.
                const start = regionFraming(p.code, OVERHEAD_ELEVATION_DEG, REGION_MARGIN * 1.6);
                const end = regionFraming(p.code);
                setFade(1);
                useWorldView.setState({ view: 'field' });
                lastField.current = p.code;
                configureControls(controls, 'field', defaultDistance());
                controls.enabled = true;
                if (!start || !end) {
                    phase.current = null;
                    useWorldView.setState({ moving: false });
                    flush(p.code);
                    return;
                }
                controls.target.set(...start.target);
                camera.position.set(...start.position);
                controls.update();
                phase.current = {
                    kind: 'fly', fromT: new Vector3(...start.target), fromP: new Vector3(...start.position),
                    toT: new Vector3(...end.target), toP: new Vector3(...end.position), start: now, ms: ms(ARRIVE_MS), arriving: p.code, fadeIn: true,
                };
            }
            return;
        }

        if (p.kind === 'rise') {
            const dur = ms(RISE_MS);
            const t = dur > 0 ? Math.min(1, elapsed / dur) : 1;
            const k = ease(t);
            controls.target.lerpVectors(p.fromT, p.toT, k);
            camera.position.lerpVectors(p.fromP, p.toP, k);
            camera.lookAt(controls.target);
            setFade(dur > 0 ? smooth(0.55, 1, t) : 1);
            if (t >= 1) {
                // The cut: the globe, close over the continent just left, then back out.
                const dir = (p.code && continentDir(p.code)) || camera.position.clone().normalize();
                const d1 = defaultDistance();
                const d0 = p.code ? diveDistance(p.code, d1) : d1;
                home.current = d1;
                setFade(1);
                useWorldView.setState({ view: 'globe' });
                configureControls(controls, 'globe', d1);
                controls.target.set(0, 0, 0);
                camera.position.copy(dir).multiplyScalar(d0);
                camera.lookAt(0, 0, 0);
                phase.current = { kind: 'zoomOut', dir, d0, d1, start: now, fadeIn: true };
            }
            return;
        }

        // zoomOut
        const dur = ms(ZOOM_OUT_MS);
        const t = dur > 0 ? Math.min(1, elapsed / dur) : 1;
        const k = ease(t);
        camera.position.copy(p.dir).multiplyScalar(p.d0 + (p.d1 - p.d0) * k);
        camera.lookAt(0, 0, 0);
        setFade(p.fadeIn ? 1 - elapsed / FADE_MS : 0);
        if (t >= 1 && (!p.fadeIn || elapsed >= FADE_MS)) {
            phase.current = null;
            controls.enabled = true;
            controls.update();
            worldPointer.lastInteraction = now;
            useWorldView.setState({ moving: false });
        }
    });

    return null;
};
