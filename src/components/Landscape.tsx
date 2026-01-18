import React, { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Terrain } from './Terrain';
import { JobMarkers } from './JobMarkers';
import { useStore } from '../store';
import { getTerrainPosition } from '../utils/terrainMath';
import * as THREE from 'three';
import gsap from 'gsap';

const CameraController = () => {
    const { camera, controls } = useThree();
    const selectedJob = useStore((state) => state.selectedJob);
    const jobs = useStore((state) => state.jobs);

    useEffect(() => {
        if (selectedJob) {
            // Find index to calculate position deterministically
            const index = jobs.findIndex(j => j.id === selectedJob.id);
            if (index === -1) return;

            const { x, z } = getTerrainPosition(index);

            // Fly to position
            const targetPos = new THREE.Vector3(x, 15, z + 20); // Elevation 15, offset Z by 20 to look at it
            const lookAtPos = new THREE.Vector3(x, 2, z); // Look at the base/peak

            gsap.to(camera.position, {
                duration: 2.0,
                x: targetPos.x,
                y: targetPos.y,
                z: targetPos.z,
                ease: "power2.inOut"
            });

            // If using OrbitControls, we need to animate its target too
            if (controls) {
                // @ts-ignore
                gsap.to(controls.target, {
                    duration: 2.0,
                    x: lookAtPos.x,
                    y: lookAtPos.y,
                    z: lookAtPos.z,
                    ease: "power2.inOut",
                    // @ts-ignore
                    onUpdate: () => controls.update()
                });
            }
        }
    }, [selectedJob, jobs, camera, controls]);

    return null;
};

export const Landscape: React.FC = () => {
    return (
        <Canvas camera={{ position: [0, 35, 55], fov: 45 }}>
            {/* Color managed by index.css gradient, but canvas needs transp/color or will be white/black default */}
            {/* We want to see the css background -> transparent canvas?? */}
            {/* Or match the color. Let's make it transparent to see the CSS gradient */}
            {/* <color attach="background" args={['#0a0e17']} /> */}

            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1} />
            <pointLight position={[-10, 10, -10]} intensity={0.5} color="blue" />

            {/* Camera Animation Controller */}
            <CameraController />

            {/* Unified Terrain Mesh */}
            <Terrain />

            {/* HUD Markers */}
            <JobMarkers />

            {/* Post Processing */}
            <EffectComposer enableNormalPass={false}>
                <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} height={300} intensity={1.5} />
            </EffectComposer>

            <OrbitControls
                enablePan={true}
                enableZoom={true}
                maxPolarAngle={Math.PI / 2.2} // Prevent going below ground
                minDistance={10}
                maxDistance={100}
            />
        </Canvas>
    );
};
