import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useWorldStore } from '../../worldStore';
import type { WorldScene } from './worldScene';
import { worldCamera } from './worldCamera';
import { regionFraming, worldFraming } from './framing';

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
 * Flies the camera between the whole world and one region whenever the
 * world store asks (focusContinent / setKelleyOnly bump focusRequestId).
 * Any orbit gesture cancels a flight in progress (worldCamera.cancel, called
 * from Landscape's OrbitControls onStart).
 */
export const CameraRig: React.FC<{
    controlsRef: React.RefObject<OrbitControlsImpl | null>;
    scene: WorldScene;
}> = ({ controlsRef, scene }) => {
    const focused = useWorldStore((s) => s.focusedContinent);
    const requestId = useWorldStore((s) => s.focusRequestId);
    const camera = useThree((s) => s.camera) as PerspectiveCamera;
    const size = useThree((s) => s.size);
    const flight = useRef<{ fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3; start: number } | null>(null);

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
        const aspect = size.width / Math.max(1, size.height);
        const region = focused ? scene.layout.regionByCode.get(focused) : undefined;
        const framing = region ? regionFraming(region.rect, camera.fov, aspect, freeBand()) : worldFraming(camera.fov, aspect);
        const toT = new Vector3(...framing.target);
        const toP = new Vector3(...framing.position);
        flight.current = { fromT: controls.target.clone(), fromP: camera.position.clone(), toT, toP, start: performance.now() };
        // Flights are only requested from the UI, so the scene, size and
        // framing they read are current; re-running on resize would yank the
        // camera away from wherever the user has since orbited it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestId]);

    useFrame(() => {
        const f = flight.current;
        const controls = controlsRef.current;
        if (!f || !controls) return;
        const t = Math.min(1, (performance.now() - f.start) / FLY_MS);
        const k = ease(t);
        controls.target.lerpVectors(f.fromT, f.toT, k);
        camera.position.lerpVectors(f.fromP, f.toP, k);
        controls.update();
        if (t >= 1) flight.current = null;
    });

    return null;
};
