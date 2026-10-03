import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Canvas, type RootState } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MOUSE, TOUCH } from 'three';
import { Terrain } from './Terrain';
import { JobMarkers } from './JobMarkers';
import { WebGLFallback } from './WebGLFallback';
import { SCENE } from '../config/constants';
import { useStore } from '../store';

/** Matches MapView's own `isDefault = position.zoom === 1` — a single simple
 * check, not a multi-axis comparison. Pan target drifting from the origin is
 * the one thing that actually strands a user (see MAX_PAN_RADIUS above), so
 * that alone decides whether "Reset view" offers itself. */
const DEFAULT_VIEW_EPSILON = 0.5;

/** How many times to silently remount the canvas on WebGL context loss
 * before giving up and showing WebGLFallback instead. Reported directly, on
 * a real iPhone: terrain gone, camera target confirmed still at origin (no
 * "Reset view" — ruling out the pan bug above), reproducible neither by pure
 * zoom nor by a grazing-angle+zoom combination in headless testing. iOS
 * WebKit reclaims WebGL contexts under memory pressure more aggressively
 * than desktop Chromium, which this app never listened for at all — a lost
 * context leaves the canvas blank while every DOM element (labels, header,
 * UI) keeps rendering normally, which is exactly what was reported. A bound
 * here isn't optional: without one, a device that keeps losing context
 * (e.g. a deeper memory problem) would remount in a tight, battery-draining
 * loop forever instead of ever settling on the fallback. */
const MAX_CONTEXT_LOSS_RETRIES = 2;

export const Landscape: React.FC = () => {
    const setIsOrbiting = useStore((s) => s.setIsOrbiting);
    const route = useStore((s) => s.route);
    const mapView = useStore((s) => s.mapView);
    const setIsDefaultView = useStore((s) => s.setIsDefaultView);
    const resetViewRequestId = useStore((s) => s.resetViewRequestId);
    const controlsRef = useRef<OrbitControlsImpl>(null);
    // Read once: R3F applies the `camera` prop at mount only. Portrait phones
    // need a wider, further framing to fit the terrain (see SCENE constants).
    const [isPortrait] = useState(
        () => typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 1,
    );
    // Read once at mount — matching isPortrait. Phones pay for every pixel in
    // the backing store; R3F's default dpr cap is 2, which on a Fold at
    // devicePixelRatio 3 still means a 720×1680 buffer. Capping mobile at 1.5
    // cut that to 540×1260 (0.68MP from 1.21MP) and raised software-rendered
    // fps from 15.6 to 25.7 in the same Chromium harness. Antialias off on
    // phones is the same trade: MSAA roughly doubles fill cost for a visual
    // difference the terrain's heatmap barely shows.
    const [isMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
    );
    const [antialias] = useState(() => !isMobile);
    const isDefaultViewRef = useRef(true);
    const [canvasKey, setCanvasKey] = useState(0);
    const [contextLossGivenUp, setContextLossGivenUp] = useState(false);
    const contextLossCountRef = useRef(0);
    // Pause the GL loop when the tab is backgrounded, and (on phones) when the
    // user has stopped interacting — sustained rAF + the 50-peak shader was the
    // load path behind Ray's "locks up after a bit" report on Chrome/Android.
    const [tabHidden, setTabHidden] = useState(
        () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    );
    const [mobileIdle, setMobileIdle] = useState(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const onVisibility = () => setTabHidden(document.visibilityState === 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    const bumpInteraction = useCallback(() => {
        if (!isMobile) return;
        setMobileIdle(false);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        // 2.5s of no orbit/zoom → pause the loop; any new gesture resumes it.
        idleTimerRef.current = setTimeout(() => setMobileIdle(true), 2500);
    }, [isMobile]);

    // Arm the idle timer on mount so a phone that never receives a touch still
    // settles into frameloop:'never' after the first paint, instead of spinning
    // the 50-peak shader forever in the background.
    useEffect(() => {
        bumpInteraction();
        return () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        };
    }, [bumpInteraction]);

    const handleContextLost = useCallback((event: Event) => {
        // Without this, the browser assumes the page doesn't want to recover
        // and may never fire 'webglcontextrestored' at all.
        event.preventDefault();
        contextLossCountRef.current += 1;
        console.warn(`[Landscape] WebGL context lost (attempt ${contextLossCountRef.current}/${MAX_CONTEXT_LOSS_RETRIES}).`);
        if (contextLossCountRef.current > MAX_CONTEXT_LOSS_RETRIES) {
            setContextLossGivenUp(true);
            return;
        }
        // Remounting (not attempting in-place restoration) is deliberate:
        // three.js/R3F have no official "rebuild every buffer, texture and
        // compiled shader program" API, so a fresh Canvas is the only fully
        // reliable recovery. Camera position resets to the initial framing
        // as a result — acceptable, since the alternative is a permanently
        // blank 3D view. The fresh OrbitControls instance starts at that
        // default framing too, so the "Reset view" button's own state needs
        // to follow — otherwise it would keep offering to reset a view
        // that's already back at default.
        isDefaultViewRef.current = true;
        setIsDefaultView(true);
        setCanvasKey((k) => k + 1);
    }, [setIsDefaultView]);

    const handleCreated = useCallback((state: RootState) => {
        state.gl.domElement.addEventListener('webglcontextlost', handleContextLost);
    }, [handleContextLost]);

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

    // Safe to bail out here (and only here): every hook above has already run
    // unconditionally on this render, so this doesn't change hook order/count
    // between renders the way an earlier return would.
    if (contextLossGivenUp) {
        return <WebGLFallback />;
    }

    // Pause the loop whenever the 3D view is covered. An opaque DOM overlay
    // does NOT stop requestAnimationFrame (browsers only throttle rAF for
    // hidden tabs, not occluded canvases), and Terrain.tsx runs a ~37k-vertex
    // shader with a per-vertex loop over up to 50 peaks every frame. Measured
    // on production before this change: globe 12,161 draws/sec, task view
    // 12,060/sec (NOT paused), US map 60/sec. After: globe ~12,060/sec, task
    // view 0, US map 0, and the loop resumes on return to the globe. 'never'
    // preserves the GL context, compiled shaders, geometry and the
    // OrbitControls camera position, so returning is instant and the user's
    // orbit is exactly where they left it.
    //
    // Load reductions aimed at Ray's "locks up after a bit" report (Samsung
    // foldable, Chrome): pause under overlays, when the tab is hidden, and on
    // phones after a short idle. Context + shaders stay warm so resume is instant.
    const pauseLoop = route === 'dashboard'
        || mapView !== 'globe'
        || tabHidden
        || (isMobile && mobileIdle);

    return (
        <Canvas
            // key: forces a full remount (fresh GL context, shaders, buffers)
            // on WebGL context loss — see MAX_CONTEXT_LOSS_RETRIES above.
            key={canvasKey}
            onCreated={handleCreated}
            frameloop={pauseLoop ? 'never' : 'always'}
            // Cap dpr at 1 on phones — Fold@3 was still a heavy backing store at 1.5.
            dpr={isMobile ? [1, 1] : [1, 2]}
            gl={{
                antialias,
                // Prefer the efficient GPU path on phones; default power can
                // keep a discrete/high clock that overheats Chrome's GL process.
                powerPreference: isMobile ? 'low-power' : 'default',
            }}
            camera={{
                position: [...(isPortrait ? SCENE.CAMERA_PORTRAIT_POSITION : SCENE.CAMERA_INITIAL_POSITION)],
                fov: isPortrait ? SCENE.CAMERA_PORTRAIT_FOV : SCENE.CAMERA_FOV,
            }}
        >
            <fog attach="fog" args={[SCENE.FOG_COLOR, SCENE.FOG_NEAR, isPortrait ? SCENE.FOG_FAR_PORTRAIT : SCENE.FOG_FAR]} />

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
                onChange={() => {
                    clampPanTarget();
                    bumpInteraction();
                }}
                onStart={() => {
                    setIsOrbiting(true);
                    bumpInteraction();
                }}
                onEnd={() => {
                    setIsOrbiting(false);
                    bumpInteraction();
                }}
            />
        </Canvas>
    );
};
