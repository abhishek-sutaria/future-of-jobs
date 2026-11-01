import React, { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { SCENE } from '../../config/constants';
import { useWorldStore } from '../../worldStore';
import { FIELD_ARRIVAL_ZOOM, labelsAt } from '../../utils/labelLevel';
import { WORLD_BOUNDS, type Rect } from '../../utils/worldLayout';
import { levelKind, ZOOM_OUT_RATIO, ZOOM_OUT_SETTLE_MS, zoomedOutOfLevel } from '../../utils/worldLevel';
import { peakTips, type WorldScene } from './worldScene';
import { prefersReducedMotion, stopInertia, worldCamera } from './worldCamera';
import { atDistance, familyFraming, framingDistance, regionFraming, worldFraming, type Framing, type FreeBand } from './framing';

const FLY_MS = 900;
/** A little past the zoom-out rule, so a hand zoom can always reach it. */
const LEVEL_MAX_DISTANCE_RATIO = ZOOM_OUT_RATIO + 0.1;

/**
 * The part of the viewport the terrain is not covered by chrome: from the
 * bottom of the header / fields bar to the top of the year slider. A phone's
 * chrome takes about half the screen, a desktop's about a third.
 */
function freeBand(): FreeBand | undefined {
    if (typeof document === 'undefined') return undefined;
    const h = window.innerHeight;
    const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    const bottomOf = (sel: string) => box(sel)?.bottom ?? 0;
    const top = Math.max(bottomOf('header'), bottomOf('[data-tour="tour-search"]'), bottomOf('[data-world-bar]'));
    const bottom = box('[data-tour="tour-slider"]')?.top ?? h;
    if (!(bottom > top)) return undefined;
    const legend = box('[data-legend]');
    return { top: top / h, bottom: bottom / h, legend: legend && legend.top < bottom ? { left: legend.left / window.innerWidth, top: legend.top / h } : undefined };
}

const sameBand = (a?: FreeBand, b?: FreeBand) =>
    a?.top === b?.top && a?.bottom === b?.bottom && a?.legend?.left === b?.legend?.left && a?.legend?.top === b?.legend?.top;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** `rect`, stretched to take in a ground point: the orbit target of a block's framing can sit just off the block. */
const including = (rect: Readonly<Rect>, x: number, z: number): Rect => ({
    x0: Math.min(rect.x0, x),
    z0: Math.min(rect.z0, z),
    x1: Math.max(rect.x1, x),
    z1: Math.max(rect.z1, z),
});

/**
 * Lets the camera reach `distance`: a block in a tight band can frame further
 * out than the free orbit limit, and OrbitControls would pull it back in. A hand
 * zoom also has to be able to pass the block's own threshold.
 */
function allowDistance(controls: OrbitControlsImpl, distance: number): void {
    controls.maxDistance = Math.max(SCENE.MAX_CAMERA_DISTANCE, distance * LEVEL_MAX_DISTANCE_RATIO, controls.getDistance());
}

interface Flight {
    fromT: Vector3;
    fromP: Vector3;
    toT: Vector3;
    toP: Vector3;
    start: number;
    ms: number;
    /** Where it lands, for the labels and for the distance a hand zoom is measured from. */
    distance: number;
    /** The block it lands on; world bounds for the world. */
    bounds: Readonly<Rect>;
    band?: FreeBand;
    /** A zoom-out's own flight: the scroll that started it is usually still coasting and must not stop it. */
    sticky: boolean;
}

/**
 * Flies the camera between the whole world, a family and a field whenever the
 * world store asks (each bumps focusRequestId). Any orbit gesture cancels a
 * flight in progress (worldCamera.cancel, called from Landscape's OrbitControls
 * onStart), except the one a hand zoom-out started.
 *
 * Every frame it also decides the labels, from the zoom at the world and from
 * the level otherwise, and applies the zoom-out rule (utils/worldLevel). During
 * a flight the zoom it reads is the landing's, so a flight home never flashes
 * the field names on its way past them. `homeDistance` is the distance of the
 * default view (and Reset view), read once like the rest of that framing; zoom
 * counts from it or the current whole-world framing, whichever is closer, so
 * after a rotate both still read as zoomed out.
 */
export const CameraRig: React.FC<{
    controlsRef: React.RefObject<OrbitControlsImpl | null>;
    scene: WorldScene;
    homeDistance: number;
}> = ({ controlsRef, scene, homeDistance }) => {
    const requestId = useWorldStore((s) => s.focusRequestId);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const size = useThree((s) => s.size);
    const flight = useRef<Flight | null>(null);
    const handledRequestId = useRef(0);
    // The next flight is the zoom-out rule's own.
    const nextSticky = useRef(false);
    // The framing distance the zoom-out rule measures from, and when the camera last came to rest there.
    const levelDistance = useRef(0);
    const settledAt = useRef(0);
    const aspect = size.width / Math.max(1, size.height);
    const baseDistance = Math.min(homeDistance, framingDistance(worldFraming(camera.fov, aspect)));
    const baseDistanceRef = useRef(baseDistance);
    useEffect(() => {
        baseDistanceRef.current = baseDistance;
    }, [baseDistance]);

    // Where the current level lands, for today's viewport and chrome.
    const landing = useCallback((band: FreeBand | undefined): { framing: Framing; bounds: Readonly<Rect> } => {
        const world = useWorldStore.getState();
        const region = world.focusedContinent ? scene.layout.regionByCode.get(world.focusedContinent) : undefined;
        const family = scene.layout.families.find((f) => f.family.id === world.focusedFamily);
        if (region) {
            const tips = peakTips(scene.peaksByContinent.get(region.code) ?? [], true);
            return { framing: regionFraming(region.rect, camera.fov, aspect, band, tips), bounds: region.rect };
        }
        if (family) {
            const tips = peakTips(family.codes.flatMap((code) => scene.peaksByContinent.get(code) ?? []), false);
            return { framing: familyFraming(family.rect, camera.fov, aspect, band, tips), bounds: family.rect };
        }
        const home = worldFraming(camera.fov, aspect);
        // The Kelley filter needs job labels, which the broad view does not have.
        return { framing: world.kelleyZoom ? atDistance(home, baseDistance / FIELD_ARRIVAL_ZOOM) : home, bounds: WORLD_BOUNDS };
    }, [scene, camera, aspect, baseDistance]);

    const land = useCallback((f: Flight) => {
        const controls = controlsRef.current;
        levelDistance.current = f.distance;
        settledAt.current = performance.now();
        worldCamera.panBounds = including(f.bounds, f.toT.x, f.toT.z);
        if (controls && f.bounds === WORLD_BOUNDS) controls.maxDistance = SCENE.MAX_CAMERA_DISTANCE;
    }, [controlsRef]);

    const fly = useCallback((sticky: boolean) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const band = freeBand();
        const { framing, bounds } = landing(band);
        const distance = framingDistance(framing);
        allowDistance(controls, distance);
        worldCamera.panBounds = null;
        stopInertia(controls);
        flight.current = {
            fromT: controls.target.clone(),
            fromP: camera.position.clone(),
            toT: new Vector3(...framing.target),
            toP: new Vector3(...framing.position),
            start: performance.now(),
            ms: prefersReducedMotion() ? 1 : FLY_MS,
            distance,
            bounds,
            band,
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
            // Stopped short: the rule counts from here, and the target may stay where it is.
            f.distance = Math.max(f.distance, controls.getDistance());
            f.toT.copy(controls.target);
            land(f);
        };
        return () => {
            worldCamera.cancel = () => {};
        };
    }, [controlsRef, land]);

    // `fly` changes with the viewport and the scene, neither of which is a
    // request: only a new id flies.
    useEffect(() => {
        if (requestId === handledRequestId.current) return;
        handledRequestId.current = requestId;
        fly(nextSticky.current);
        nextSticky.current = false;
    }, [requestId, fly]);

    // A family or field stays framed through a resize or rotation. The world
    // does not: that would yank the camera away from wherever the user has
    // orbited it.
    const sizeKey = `${size.width}x${size.height}`;
    const framedSize = useRef(sizeKey);
    useEffect(() => {
        if (framedSize.current === sizeKey) return;
        framedSize.current = sizeKey;
        if (levelKind(useWorldStore.getState()) !== 'world') fly(false);
    }, [sizeKey, fly]);

    useFrame(() => {
        const f = flight.current;
        const controls = controlsRef.current;
        if (!controls) return;
        if (f) {
            // The breadcrumb and info line mount and wrap just after the level
            // changes, so the band is only final once the flight is under way.
            const band = freeBand();
            if (!sameBand(band, f.band)) {
                const { framing } = landing(band);
                f.band = band;
                f.toT.set(...framing.target);
                f.toP.set(...framing.position);
                f.distance = framingDistance(framing);
                allowDistance(controls, f.distance);
            }
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
