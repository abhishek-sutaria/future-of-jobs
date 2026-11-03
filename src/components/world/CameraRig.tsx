import React, { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useWorldStore } from '../../worldStore';
import { FIELD_ARRIVAL_ZOOM, labelsAt } from '../../utils/labelLevel';
import { EP_PATH_MAX } from '../../utils/occupationIndex';
import { stageKey } from '../../utils/stageLayout';
import { mapRect } from '../../utils/stageMap';
import { beginTransition, levelViewOf, viewAt, worldLevelView } from '../../utils/stageTransition';
import type { Rect } from '../../utils/worldLayout';
import { levelKind, ZOOM_OUT_SETTLE_MS, zoomedOutOfLevel } from '../../utils/worldLevel';
import { useIsMobile } from '../../hooks/useIsMobile';
import { prefersReducedMotion, stopInertia, worldCamera } from './worldCamera';
import { atDistance, framingDistance, stageFraming, stageViewOffset, worldFraming, type Framing } from './framing';
import type { WorldScene } from './worldScene';
import { worldView } from './worldView';

const FLY_MS = 900;
/** How fast the picture slides to its phone offset, per second: about as long as a flight. */
const VIEW_OFFSET_RATE = 7;
/** The chrome settles this long after a resize, as it does during a flight. */
const CHROME_SETTLE_MS = 600;

/** The band of a phone screen the chrome leaves free, from the bottom of the controls to the top of the year slider, in pixels. */
function freeBand(): { top: number; bottom: number } | null {
    if (typeof document === 'undefined') return null;
    const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    const top = Math.max(box('header')?.bottom ?? 0, box('[data-tour="tour-search"]')?.bottom ?? 0, box('[data-world-bar]')?.bottom ?? 0);
    const bottom = box('[data-tour="tour-slider"]')?.top;
    return bottom != null && bottom > top ? { top, bottom } : null;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Flight {
    fromT: Vector3;
    fromP: Vector3;
    toT: Vector3;
    toP: Vector3;
    start: number;
    ms: number;
    /** Where it lands, for the labels and for the distance a hand zoom is measured from. */
    distance: number;
    /** Where the orbit target may pan once it lands: the level's rectangle on screen. */
    panBounds: Rect;
    /** A zoom-out's own flight: the scroll that started it is usually still coasting and must not stop it. */
    sticky: boolean;
}

/**
 * Flies the camera between the whole world and a stage whenever the world store
 * asks (each bumps focusRequestId). Every family and field lands on the live
 * view's camera, looking at the middle of its rectangle. Any orbit gesture
 * cancels a flight in progress (worldCamera.cancel, called from Landscape's
 * OrbitControls onStart), except the one a hand zoom-out started.
 *
 * Each flight also moves worldView, on the same clock and easing as the camera:
 * the map from the world's ground to the screen's blends from the old level's
 * to the new one's, so the block being opened magnifies in place while
 * everything else fades (utils/stageTransition). A cancelled camera flight
 * leaves the view to finish on its own. Mounted before everything that draws,
 * so they all read this frame's view.
 *
 * Every frame it also decides the labels, from the zoom at the world and from
 * the level otherwise, and applies the zoom-out rule (utils/worldLevel) against
 * the stage's home distance. During a flight the zoom it reads is the landing's,
 * so a flight home never flashes the field names on its way past them.
 *
 * On a phone a family or field also slides the picture down with a view offset,
 * so the stage's rectangle sits in the middle of the band the taller controls leave free. The
 * camera itself stays on the live numbers, and the desktop has no offset at all.
 * `homeDistance` is the distance of the default view (and Reset view), read once
 * like the rest of that framing; zoom counts from it or the current whole-world
 * framing, whichever is closer, so after a rotate both still read as zoomed out.
 */
export const CameraRig: React.FC<{
    controlsRef: React.RefObject<OrbitControlsImpl | null>;
    homeDistance: number;
    scene: WorldScene;
}> = ({ controlsRef, homeDistance, scene }) => {
    const requestId = useWorldStore((s) => s.focusRequestId);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const size = useThree((s) => s.size);
    const flight = useRef<Flight | null>(null);
    // The view's own clock: a cancelled camera flight does not stop it.
    const viewClock = useRef({ start: 0, ms: 1 });
    const handledRequestId = useRef(0);
    // The next flight is the zoom-out rule's own.
    const nextSticky = useRef(false);
    // The home distance the zoom-out rule measures from, and when the camera last came to rest there.
    const levelDistance = useRef(0);
    const settledAt = useRef(0);
    const isMobile = useIsMobile();
    // The picture's slide now, where it is heading, and until when to re-measure
    // the chrome. Measured only then: at rest a Kelley note must not move the view.
    const viewOffset = useRef(0);
    const viewOffsetGoal = useRef(0);
    const measureUntil = useRef(0);
    const aspect = size.width / Math.max(1, size.height);
    const baseDistance = Math.min(homeDistance, framingDistance(worldFraming(camera.fov, aspect)));
    const baseDistanceRef = useRef(baseDistance);
    useEffect(() => {
        baseDistanceRef.current = baseDistance;
    }, [baseDistance]);

    // Where the current level lands.
    const landing = useCallback((): Framing => {
        const world = useWorldStore.getState();
        if (levelKind(world) !== 'world') return stageFraming(camera.fov);
        const home = worldFraming(camera.fov, aspect);
        // The Kelley filter needs job labels, which the broad view does not have.
        return world.kelleyZoom ? atDistance(home, baseDistance / FIELD_ARRIVAL_ZOOM) : home;
    }, [camera, aspect, baseDistance]);

    const land = useCallback((f: Flight) => {
        levelDistance.current = f.distance;
        settledAt.current = performance.now();
        worldCamera.panBounds = f.panBounds;
    }, []);

    const fly = useCallback((sticky: boolean) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const framing = landing();
        const to = levelViewOf(useWorldStore.getState(), scene);
        const now = performance.now();
        const ms = prefersReducedMotion() ? 1 : FLY_MS;
        worldView.transition = beginTransition(worldView.level ?? worldLevelView(EP_PATH_MAX), to, worldView);
        worldView.level = to;
        viewClock.current = { start: now, ms };
        worldCamera.panBounds = null;
        stopInertia(controls);
        flight.current = {
            fromT: controls.target.clone(),
            fromP: camera.position.clone(),
            toT: new Vector3(...framing.target),
            toP: new Vector3(...framing.position),
            start: now,
            ms,
            distance: framingDistance(framing),
            panBounds: mapRect(to.map, to.rect),
            sticky,
        };
    }, [camera, controlsRef, landing, scene]);

    useEffect(() => {
        worldCamera.cancel = (force = false) => {
            const f = flight.current;
            const controls = controlsRef.current;
            if (!f || (f.sticky && !force)) return;
            flight.current = null;
            if (!controls) return;
            // Stopped short: the rule counts from here.
            f.distance = Math.max(f.distance, controls.getDistance());
            land(f);
        };
        return () => {
            worldCamera.cancel = () => {};
        };
    }, [controlsRef, land]);

    // A resize changes what the offset means and what it should be.
    const appliedSize = useRef('');
    useEffect(() => {
        appliedSize.current = '';
        measureUntil.current = performance.now() + CHROME_SETTLE_MS;
    }, [size.width, size.height]);

    useEffect(() => () => camera.clearViewOffset(), [camera]);

    // `fly` changes with the viewport and the scene, neither of which is a
    // request: only a new id flies.
    useEffect(() => {
        if (requestId === handledRequestId.current) return;
        handledRequestId.current = requestId;
        fly(nextSticky.current);
        nextSticky.current = false;
    }, [requestId, fly]);

    useFrame((_, delta) => {
        const now = performance.now();
        const transition = worldView.transition;
        if (transition) {
            const t = Math.min(1, (now - viewClock.current.start) / viewClock.current.ms);
            const view = viewAt(transition, ease(t));
            worldView.map = view.map;
            worldView.heightRef = view.heightRef;
            worldView.layers = view.layers;
            if (t >= 1) worldView.transition = null;
        }

        const f = flight.current;
        const controls = controlsRef.current;
        if (!controls) return;
        if (f) {
            const t = Math.min(1, (now - f.start) / f.ms);
            const k = ease(t);
            controls.target.lerpVectors(f.fromT, f.toT, k);
            camera.position.lerpVectors(f.fromP, f.toP, k);
            controls.update();
            if (t >= 1) {
                flight.current = null;
                land(f);
            }
        }

        const world = useWorldStore.getState();
        const kind = levelKind(world);
        const distance = flight.current?.distance ?? controls.getDistance();
        const labels = labelsAt(kind, baseDistanceRef.current / distance, world.labels);
        if (labels !== world.labels) useWorldStore.setState({ labels });

        if (kind === 'world' || !isMobile) viewOffsetGoal.current = 0;
        else if (flight.current || now < measureUntil.current) {
            const band = freeBand();
            const level = worldView.level;
            const outline = level && stageKey(world) === level.key ? mapRect(level.map, level.rect) : null;
            viewOffsetGoal.current = band && outline ? stageViewOffset(camera.fov, size.height, band.top, band.bottom, outline) : 0;
        }
        const goal = viewOffsetGoal.current;
        const step = prefersReducedMotion() ? 1 : 1 - Math.exp(-delta * VIEW_OFFSET_RATE);
        const next = viewOffset.current + (goal - viewOffset.current) * step;
        const slid = Math.abs(goal - next) < 0.25 ? goal : next;
        const sizeKey = `${size.width}x${size.height}`;
        if (slid !== viewOffset.current || appliedSize.current !== sizeKey) {
            viewOffset.current = slid;
            appliedSize.current = sizeKey;
            if (slid === 0) camera.clearViewOffset();
            else camera.setViewOffset(size.width, size.height, 0, slid, size.width, size.height);
        }

        // The request id check holds the rule off between asking for a flight and it starting.
        const flying = !!flight.current || handledRequestId.current !== world.focusRequestId;
        const settled = performance.now() - settledAt.current >= ZOOM_OUT_SETTLE_MS;
        if (zoomedOutOfLevel(kind, distance, levelDistance.current, flying, settled)) {
            nextSticky.current = true;
            world.goUp();
        }
    });

    return null;
};
