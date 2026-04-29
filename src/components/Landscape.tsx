import React, { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Terrain } from './Terrain';
import { JobMarkers } from './JobMarkers';
import { useStore } from '../store';
import { getTerrainPosition } from '../utils/terrainMath';
import { SCENE } from '../config/constants';
import * as THREE from 'three';
import gsap from 'gsap';

const CameraController = () => {
    const { camera, controls } = useThree();
    const selectedJob = useStore((state) => state.selectedJob);
    const jobs = useStore((state) => state.jobs);

    useEffect(() => {
        if (!selectedJob) return;

        const index = jobs.findIndex(j => j.id === selectedJob.id);
        if (index === -1) return;

        const { x, z } = getTerrainPosition(index);

        const targetPos = new THREE.Vector3(x, SCENE.CAMERA_FLY.HEIGHT, z + SCENE.CAMERA_FLY.DISTANCE);
        const lookAtPos = new THREE.Vector3(x, SCENE.CAMERA_FLY.LOOK_AT_HEIGHT, z);

        const cameraTween = gsap.to(camera.position, {
            duration: SCENE.CAMERA_FLY.DURATION,
            x: targetPos.x,
            y: targetPos.y,
            z: targetPos.z,
            ease: "power2.inOut"
        });

        let controlsTween: gsap.core.Tween | null = null;
        if (controls) {
            const orbitControls = controls as unknown as { target: THREE.Vector3; update: () => void };
            controlsTween = gsap.to(orbitControls.target, {
                duration: SCENE.CAMERA_FLY.DURATION,
                x: lookAtPos.x,
                y: lookAtPos.y,
                z: lookAtPos.z,
                ease: "power2.inOut",
                onUpdate: () => orbitControls.update()
            });
        }

        return () => {
            cameraTween.kill();
            controlsTween?.kill();
        };
    }, [selectedJob, jobs, camera, controls]);

    return null;
};

export const Landscape: React.FC = () => {
    return (
        <Canvas camera={{ position: [...SCENE.CAMERA_INITIAL_POSITION], fov: SCENE.CAMERA_FOV }}>
            <fog attach="fog" args={[SCENE.FOG_COLOR, SCENE.FOG_NEAR, SCENE.FOG_FAR]} />

            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1} />
            <pointLight position={[-10, 10, -10]} intensity={0.5} color="blue" />

            <CameraController />
            <Terrain />
            <JobMarkers />

            <OrbitControls
                enablePan={true}
                enableZoom={true}
                maxPolarAngle={SCENE.MAX_POLAR_ANGLE}
                minDistance={SCENE.MIN_CAMERA_DISTANCE}
                maxDistance={SCENE.MAX_CAMERA_DISTANCE}
            />
        </Canvas>
    );
};
