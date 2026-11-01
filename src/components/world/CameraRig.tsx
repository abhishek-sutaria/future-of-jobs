import React, { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SCENE } from '../../config/constants';
import { useWorldStore } from '../../worldStore';
import { FIELD_ARRIVAL_ZOOM, labelsAt } from '../../utils/labelLevel';
import { WORLD_BOUNDS } from '../../utils/worldLayout';
import { levelKind, ZOOM_OUT_SETTLE_MS, zoomedOutOfLevel } from '../../utils/worldLevel';
import { useIsMobile } from '../../hooks/useIsMobile';
import { prefersReducedMotion, stopInertia, worldCamera } from './worldCamera';
import { atDistance, framingDistance, stageFraming, stageViewOffset, worldFraming, type Framing } from './framing';

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
    /** A flight to a stage, which pans by radius rather than by the world's rectangle. */
    toStage: boolean;
    /** A zoom-out's own flight: the scroll that started it is usually still coasting and must not stop it. */
    sticky: boolean;
}

/**
 * Flies the camera between the whole world and a stage whenever the world store
 * asks (each bumps focusRequestId). Every family and field lands on the live
 * view's camera. Any orbit gesture cancels a flight in progress
 * (worldCamera.cancel, called from Landscape's OrbitControls onStart), except
 * the one a hand zoom-out started.
 *
 * Every frame it also decides the labels, from the zoom at the world and from
 * the level otherwise, and applies the zoom-out rule (utils/worldLevel) against
 * the stage's home distance. During a flight the zoom it reads is the landing's,
 * so a flight home never flashes the field names on its way past them.
 *
 * On a phone a family or field also slides the picture down with a view offset,
 * so the disc sits in the middle of the band the taller controls leave free. The
 * camera itself stays on the live numbers, and the desktop has no offset at all.
 * `homeDistance` is the distance of the default view (and Reset view), read once
 * like the rest of that framing; zoom counts from it or the current whole-world
 * framing, whichever is closer, so after a rotate both still read as zoomed out.
 */
export const CameraRig: React.FC<{
    controlsRef: React.RefObject<OrbitControlsImpl | null>;
    homeDistance: number;
}> = ({ controlsRef, homeDistance }) => {
    const requestId = useWorldStore((s) => s.focusRequestId);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const size = useThree((s) => s.size);
    const flight = useRef<Flight | null>(null);
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
    const landing = useCallback((): { framing: Framing; toStage: boolean } => {
        const world = useWorldStore.getState();
        if (levelKind(world) !== 'world') return { framing: stageFraming(camera.fov), toStage: true };
        const home = worldFraming(camera.fov, aspect);
        // The Kelley filter needs job labels, which the broad view does not have.
        return { framing: world.kelleyZoom ? atDistance(home, baseDistance / FIELD_ARRIVAL_ZOOM) : home, toStage: false };
    }, [camera, aspect, baseDistance]);

    const land = useCallback((f: Flight) => {
        levelDistance.current = f.distance;
        settledAt.current = performance.now();
        worldCamera.panBounds = f.toStage ? null : WORLD_BOUNDS;
        worldCamera.panRadius = f.toStage ? SCENE.MAX_PAN_RADIUS : null;
    }, []);

    const fly = useCallback((sticky: boolean) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const { framing, toStage } = landing();
        worldCamera.panBounds = null;
        worldCamera.panRadius = null;
        stopInertia(controls);
        flight.current = {
            fromT: controls.target.clone(),
            fromP: camera.position.clone(),
            toT: new Vector3(...framing.target),
            toP: new Vector3(...framing.position),
            start: performance.now(),
            ms: prefersReducedMotion() ? 1 : FLY_MS,
            distance: framingDistance(framing),
            toStage,
            sticky,
        };
    }, [camera, controlsRef, landing]);

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
        const f = flight.current;
        const controls = controlsRef.current;
        if (!controls) return;
        if (f) {
            const t = Math.min(1, (performance.now() - f.start) / f.ms);
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
        else if (flight.current || performance.now() < measureUntil.current) {
            const band = freeBand();
            viewOffsetGoal.current = band ? stageViewOffset(camera.fov, size.height, band.top, band.bottom) : 0;
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
