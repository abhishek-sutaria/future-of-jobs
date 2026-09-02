import React, { useRef, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MOUSE, TOUCH } from 'three';
import { Terrain } from './Terrain';
import { JobMarkers } from './JobMarkers';
import { SCENE } from '../config/constants';
import { useStore } from '../store';

/** Matches MapView's own `isDefault = position.zoom === 1` — a single simple
 * check, not a multi-axis comparison. Pan target drifting from the origin is
 * the one thing that actually strands a user (see MAX_PAN_RADIUS above), so
 * that alone decides whether "Reset view" offers itself. */
const DEFAULT_VIEW_EPSILON = 0.5;

export const Landscape: React.FC = () => {
    const setIsOrbiting = useStore((s) => s.setIsOrbiting);
    const route = useStore((s) => s.route);
    const setIsDefaultView = useStore((s) => s.setIsDefaultView);
    const resetViewRequestId = useStore((s) => s.resetViewRequestId);
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const isDefaultViewRef = useRef(true);

    // Pan has no built-in bound, and a two-finger touch gesture easily imparts
    // an unintended pan alongside the intended zoom (TOUCH.DOLLY_PAN handles
    // both from one gesture). The terrain is a *finite* plane, so an
    // unconstrained pan can push the target — and the whole terrain — off
    // screen entirely, leaving only floating labels behind (drei's Html
    // isn't frustum-culled the same way a mesh is). Confirmed live: panning
    // the target 80 units from origin makes the terrain fully vanish.
    // Clamp target to SCENE.MAX_PAN_RADIUS every change. Mutating target +
    // camera position directly (not via a method that re-dispatches 'change'
    // in a way that could loop) and only when actually out of bounds, so
    // this is a no-op on every normal in-bounds interaction.
    const clampPanTarget = useCallback(() => {
        const controls = controlsRef.current;
        if (!controls) return;
        const target = controls.target;
        const distXZ = Math.hypot(target.x, target.z);
        if (distXZ > SCENE.MAX_PAN_RADIUS) {
            const scale = SCENE.MAX_PAN_RADIUS / distXZ;
            const dx = target.x * (1 - scale);
            const dz = target.z * (1 - scale);
            target.x -= dx;
            target.z -= dz;
            controls.object.position.x -= dx;
            controls.object.position.z -= dz;
        }

        // Drives the header's "Reset view" button (mirrors MapView's own).
        // Compared via a plain ref, not the store value, so a drag that
        // never actually crosses the threshold never touches Zustand.
        const isDefault = Math.hypot(controls.target.x, controls.target.z) <= DEFAULT_VIEW_EPSILON;
        if (isDefault !== isDefaultViewRef.current) {
            isDefaultViewRef.current = isDefault;
            setIsDefaultView(isDefault);
        }
    }, [setIsDefaultView]);

    // "Reset view" was clicked (resetViewRequestId incremented) — restore the
    // initial framing exactly, the same way returning from the dashboard
    // does (frameloop:'never' otherwise preserves whatever orbit state the
    // user left it in, by design, so this only fires on an explicit request).
    useEffect(() => {
        if (resetViewRequestId === 0) return; // skip the initial mount value
        const controls = controlsRef.current;
        if (!controls) return;
        controls.target.set(0, 0, 0);
        controls.object.position.set(...SCENE.CAMERA_INITIAL_POSITION);
        controls.update();
        isDefaultViewRef.current = true;
        setIsDefaultView(true);
    }, [resetViewRequestId, setIsDefaultView]);

    return (
        <Canvas
            // Halts the render loop while the dashboard covers the screen — an
            // opaque DOM overlay does NOT stop requestAnimationFrame (browsers
            // only throttle rAF for hidden tabs, not occluded canvases), and
            // Terrain.tsx runs a ~37k-vertex shader with a per-vertex loop over
            // up to 50 peaks every frame regardless of visibility. 'never'
            // preserves the GL context, compiled shaders, geometry and the
            // OrbitControls camera position, so returning to the map is instant
            // and the user's orbit is exactly where they left it.
            frameloop={route === 'dashboard' ? 'never' : 'always'}
            camera={{ position: [...SCENE.CAMERA_INITIAL_POSITION], fov: SCENE.CAMERA_FOV }}
        >
            <fog attach="fog" args={[SCENE.FOG_COLOR, SCENE.FOG_NEAR, SCENE.FOG_FAR]} />

            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1} />
            <pointLight position={[-10, 10, -10]} intensity={0.5} color="blue" />

            <Terrain />
            <JobMarkers />

            <OrbitControls
                ref={controlsRef}
                enablePan={true}
                enableZoom={true}
                screenSpacePanning={false}
                mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
                touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
                maxPolarAngle={SCENE.MAX_POLAR_ANGLE}
                minDistance={SCENE.MIN_CAMERA_DISTANCE}
                maxDistance={SCENE.MAX_CAMERA_DISTANCE}
                onChange={clampPanTarget}
                onStart={() => setIsOrbiting(true)}
                onEnd={() => setIsOrbiting(false)}
            />
        </Canvas>
    );
};
