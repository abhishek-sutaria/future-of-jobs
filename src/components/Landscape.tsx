import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MOUSE, TOUCH } from 'three';
import { Terrain } from './Terrain';
import { JobMarkers } from './JobMarkers';
import { SCENE } from '../config/constants';
import { useStore } from '../store';

export const Landscape: React.FC = () => {
    const setIsOrbiting = useStore((s) => s.setIsOrbiting);
    const route = useStore((s) => s.route);

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
                enablePan={true}
                enableZoom={true}
                screenSpacePanning={false}
                mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
                touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
                maxPolarAngle={SCENE.MAX_POLAR_ANGLE}
                minDistance={SCENE.MIN_CAMERA_DISTANCE}
                maxDistance={SCENE.MAX_CAMERA_DISTANCE}
                onStart={() => setIsOrbiting(true)}
                onEnd={() => setIsOrbiting(false)}
            />
        </Canvas>
    );
};
