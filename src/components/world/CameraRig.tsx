import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useWorldStore } from '../../worldStore';
import { decideLabels, FIELD_ARRIVAL_ZOOM } from '../../utils/labelLevel';
import type { WorldScene } from './worldScene';
import { prefersReducedMotion, worldCamera } from './worldCamera';
import { atDistance, familyFraming, framingDistance, regionFraming, worldFraming } from './framing';

const FLY_MS = 900;

/**
 * The part of the viewport the terrain is not covered by chrome: from the
 * bottom of the header / fields bar to the top of the year slider. A phone's
 * chrome takes about half the screen, a desktop's about a third.
 */
function freeBand(): { usableHeight?: number; bandCenter?: number } {
    if (typeof document === 'undefined') return {};
    const h = window.innerHeight;
    const bottomOf = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0;
    const top = Math.max(bottomOf('header'), bottomOf('[data-world-bar]'));
    const bottom = document.querySelector('[data-tour="tour-slider"]')?.getBoundingClientRect().top ?? h;
    if (!(bottom > top)) return {};
    return { usableHeight: (bottom - top) / h, bandCenter: ((top + bottom) / 2 - h / 2) / (h / 2) };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Flies the camera between the whole world, a job family and one region
 * whenever the world store asks (each bumps focusRequestId). Any orbit gesture
 * cancels a flight in progress (worldCamera.cancel, called from Landscape's
 * OrbitControls onStart).
 *
 * Also reads the zoom every frame and decides the labels from it, so every way
 * of moving the camera ends in the same place. `homeDistance` is the distance
 * of the default view (and Reset view), read once like the rest of that
 * framing; zoom counts from it or the current whole-world framing, whichever
 * is closer, so after a rotate both still read as zoomed out.
 */
export const CameraRig: React.FC<{
    controlsRef: React.RefObject<OrbitControlsImpl | null>;
    scene: WorldScene;
    homeDistance: number;
}> = ({ controlsRef, scene, homeDistance }) => {
    const focused = useWorldStore((s) => s.focusedContinent);
    const requestId = useWorldStore((s) => s.focusRequestId);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const size = useThree((s) => s.size);
    const flight = useRef<{ fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3; start: number; ms: number } | null>(null);
    const handledRequestId = useRef(0);
    const aspect = size.width / Math.max(1, size.height);
    const baseDistance = Math.min(homeDistance, framingDistance(worldFraming(camera.fov, aspect)));
    const baseDistanceRef = useRef(baseDistance);
    useEffect(() => {
        baseDistanceRef.current = baseDistance;
    }, [baseDistance]);

    useEffect(() => {
        worldCamera.cancel = () => {
            flight.current = null;
        };
        return () => {
            worldCamera.cancel = () => {};
        };
    }, []);

    useEffect(() => {
        if (requestId === 0) return;
        const controls = controlsRef.current;
        if (!controls) return;
        handledRequestId.current = requestId;
        const region = focused ? scene.layout.regionByCode.get(focused) : undefined;
        const goal = useWorldStore.getState().flyTo;
        const family = goal?.kind === 'family' ? scene.layout.families.find((f) => f.family.id === goal.id) : undefined;
        // A field or family can frame further out than the whole world (a tall
        // block on a wide screen), so every flight in stops past the threshold.
        const arrival = baseDistance / FIELD_ARRIVAL_ZOOM;
        const band = { ...freeBand(), maxDistance: arrival };
        const framing = region
            ? regionFraming(region.rect, camera.fov, aspect, band)
            : family
                ? familyFraming(family.rect, camera.fov, aspect, band)
                : goal?.kind === 'fields'
                    ? atDistance(worldFraming(camera.fov, aspect), arrival)
                    : worldFraming(camera.fov, aspect);
        const toT = new Vector3(...framing.target);
        const toP = new Vector3(...framing.position);
        flight.current = { fromT: controls.target.clone(), fromP: camera.position.clone(), toT, toP, start: performance.now(), ms: prefersReducedMotion() ? 1 : FLY_MS };
        // Flights are only requested from the UI, so the scene, size and
        // framing they read are current; re-running on resize would yank the
        // camera away from wherever the user has since orbited it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestId]);

    useFrame(() => {
        const f = flight.current;
        const controls = controlsRef.current;
        if (!controls) return;
        if (f) {
            const t = Math.min(1, (performance.now() - f.start) / f.ms);
            const k = ease(t);
            controls.target.lerpVectors(f.fromT, f.toT, k);
            camera.position.lerpVectors(f.fromP, f.toP, k);
            controls.update();
            if (t >= 1) flight.current = null;
        }

        const world = useWorldStore.getState();
        const labels = decideLabels(baseDistanceRef.current / controls.getDistance(), world.labels);
        if (labels !== world.labels) useWorldStore.setState({ labels });
        // Zoomed out of a field by hand: the broad view has no field in it.
        // Not during a flight in, which starts out at the broad zoom.
        if (!labels.fields && world.focusedContinent && !flight.current && handledRequestId.current === world.focusRequestId) {
            useWorldStore.setState({ focusedContinent: null });
        }
    });

    return null;
};
