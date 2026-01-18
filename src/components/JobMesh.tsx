import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Mesh, Color, MeshStandardMaterial, Vector2 } from 'three';
import type { Job } from '../types';
import { getJobStatus } from '../data';
import { useStore } from '../store';
import { initialJobs } from '../data';

interface JobMeshProps {
    job: Job;
    position: [number, number, number];
}

// Helper to get icon
const getJobIcon = (title: string) => {
    if (title.includes('Nurse') || title.includes('Health') || title.includes('Doctor')) return '⚕️';
    if (title.includes('Data') || title.includes('Entry') || title.includes('Software')) return '⌨️';
    if (title.includes('Analyst') || title.includes('Finance') || title.includes('Accountant')) return '📊';
    if (title.includes('Manager') || title.includes('Executive')) return '💼';
    if (title.includes('Sales') || title.includes('Retail')) return '🏷️';
    if (title.includes('Driver')) return '🚚';
    return '⚡';
};

export const JobMesh: React.FC<JobMeshProps> = ({ job, position }) => {
    const meshRef = useRef<Mesh>(null);
    const year = useStore((state) => state.year);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const selectedJob = useStore((state) => state.selectedJob);

    const isSelected = selectedJob?.id === job.id;

    // Track previous color to trigger pulse
    const prevColorRef = useRef<string>('');
    const pulseRef = useRef<number>(0);

    // Check if "Saved" (Was High Risk initially, now Safe/Medium)
    const isSaved = useMemo(() => {
        const initialJob = initialJobs.find(j => j.id === job.id);
        if (!initialJob) return false;
        const initStatus = getJobStatus(initialJob, 2025);
        const currentStatus = getJobStatus(job, year);
        return initStatus.riskScore > 0.7 && currentStatus.riskScore <= 0.7;
    }, [job, year]);

    useFrame(() => {
        if (!meshRef.current) return;

        const currentStatus = getJobStatus(job, year);

        // Pulse Logic
        if (prevColorRef.current && prevColorRef.current !== currentStatus.color) {
            pulseRef.current = 1.0;
        }
        prevColorRef.current = currentStatus.color;

        if (pulseRef.current > 0) {
            pulseRef.current -= 0.05;
            if (pulseRef.current < 0) pulseRef.current = 0;
        }

        // Projection logic
        const isHighRisk = currentStatus.riskScore > 0.7;
        const rate = isHighRisk ? 0.95 : 1.02;
        const yearsPassed = year - 2025;
        const projectedEmployment = job.employment * Math.pow(rate, yearsPassed);

        // Height calculation
        const height = (projectedEmployment / 500000);

        // Visual Scale (Mountain Shape)
        // Base width is fixed (1.5), Height varies.
        const pulseScale = 1 + (Math.sin(pulseRef.current * Math.PI) * 0.2);

        // In three.js cylinder, y-scale stretches it. 
        // We want the base to stay relatively constant but the peak to rise.
        meshRef.current.scale.y += (height - meshRef.current.scale.y) * 0.1;

        // Apply pulse to overall size slightly
        meshRef.current.scale.x = 1 * pulseScale;
        meshRef.current.scale.z = 1 * pulseScale;

        meshRef.current.position.y = meshRef.current.scale.y / 2;

        // Color Logic
        const targetColor = new Color(currentStatus.color);
        if (isSelected) targetColor.offsetHSL(0, 0, 0.2);

        // Apply to Inner Core
        const mat = meshRef.current.material as MeshStandardMaterial;
        mat.color.lerp(targetColor, 0.1);

        if (isSaved) {
            mat.emissive.lerp(targetColor, 0.1);
            mat.emissiveIntensity = 1.0;
        } else {
            // Emissive for normal state too, to look "Holographic"
            mat.emissive.lerp(targetColor, 0.1);
            mat.emissiveIntensity = 0.5;
        }
    });

    const icon = getJobIcon(job.title);

    // Generate bell curve profile for LatheGeometry
    const geometryArgs = useMemo(() => {
        const points = [];
        const segments = 20;
        const baseRadius = 1.2;
        const peakHeight = 1.0;

        for (let i = 0; i <= segments; i++) {
            const y = (i / segments) * peakHeight;
            // Gaussian-like decay: radius shrinks as y increases
            // Using logic: r = base * e^(-k * y^2)
            // k controls steepness. 
            const radius = baseRadius * Math.exp(-3.5 * y * y);
            points.push(new Vector2(radius, y));
        }
        return [points, 32]; // points, segments
    }, []);

    return (
        <group position={position}>
            {/* Holographic Mountain Peak (Lathe) */}
            <mesh
                ref={meshRef}
                onClick={(e) => {
                    e.stopPropagation();
                    setSelectedJob(job);
                }}
                onPointerOver={() => document.body.style.cursor = 'pointer'}
                onPointerOut={() => document.body.style.cursor = 'auto'}
            >
                {/* LatheGeometry for Bell Curve */}
                <latheGeometry args={geometryArgs as any} />
                <meshStandardMaterial
                    transparent
                    opacity={0.8}
                    roughness={0.1}
                    metalness={0.6}
                    emissive={isSaved ? new Color(getJobStatus(job, year).color) : new Color(0x000000)}
                    emissiveIntensity={isSaved ? 1.0 : 0.4}
                />

                {/* Wireframe Grid Layer */}
                <mesh scale={[1.02, 1.02, 1.02]}>
                    <latheGeometry args={geometryArgs as any} />
                    <meshBasicMaterial color="white" wireframe opacity={0.2} transparent />
                </mesh>
            </mesh>

            {/* Floating Label with Icon */}
            {(isSelected || job.employment > 1500000) && (
                <Html position={[0, (meshRef.current?.scale.y || 1) + 0.2, 0]} center distanceFactor={12} zIndexRange={[100, 0]}>
                    <div className="flex flex-col items-center pointer-events-none text-center">
                        <div className="text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.5)] mb-1">
                            {icon}
                        </div>
                        <div className="bg-gray-900/40 backdrop-blur-sm border border-white/10 px-3 py-1 rounded-full">
                            <span className={`text-xs font-bold text-white drop-shadow-[0_2px_2px_rgba(0,0,0,1)] whitespace-nowrap`}>
                                {job.title}
                            </span>
                        </div>
                    </div>
                </Html>
            )}
        </group>
    );
};
