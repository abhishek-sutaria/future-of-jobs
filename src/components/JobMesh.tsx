import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Mesh, Color, MeshStandardMaterial, Vector2 } from 'three';
import type { Job } from '../types';

import { useStore } from '../store';
import { initialJobs } from '../data';
import { YEAR_MIN, RISK_COLORS, VOLATILITY_LABELS, ANIMATIONS, JOB_ICON_KEYWORDS, JOB_ICON_DEFAULT, SHADER } from '../config/constants';

interface JobMeshProps {
    job: Job;
    position: [number, number, number];
}

const getJobIcon = (title: string) => {
    for (const [keywords, icon] of JOB_ICON_KEYWORDS) {
        if (keywords.some(k => title.includes(k))) return icon;
    }
    return JOB_ICON_DEFAULT;
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

    // Check if "Saved" (Was Critical/High Risk initially, now Safe/Moderate)
    const isSaved = useMemo(() => {
        const initialJob = initialJobs.find(j => j.id === job.id);
        if (!initialJob) return false;
        // Initial state logic (hardcoded fallback since we don't have time machine for initial)
        // Check if current job is safer than initial logic would suggest
        // Simplified: If current label is "Stable" or "Future-Proof" but automation index is high
        return job.humanResilienceLabel === 'Future-Proof' && job.automationCostIndex > ANIMATIONS.SAVED_AUTOMATION_THRESHOLD;
    }, [job]);

    // Helper to get color from real labels
    const getJobColor = (j: Job) => {
        if (j.salaryVolatilityLabel === VOLATILITY_LABELS.CRITICAL || j.salaryVolatilityLabel === VOLATILITY_LABELS.HIGH) return RISK_COLORS.HIGH;
        if (j.salaryVolatilityLabel === VOLATILITY_LABELS.MODERATE) return RISK_COLORS.MEDIUM;
        return RISK_COLORS.LOW;
    };

    useFrame(() => {
        if (!meshRef.current) return;

        const colorHex = getJobColor(job);

        // Pulse Logic
        if (prevColorRef.current && prevColorRef.current !== colorHex) {
            pulseRef.current = 1.0;
        }
        prevColorRef.current = colorHex;

        if (pulseRef.current > 0) {
            pulseRef.current -= ANIMATIONS.PULSE_DECAY;
            if (pulseRef.current < 0) pulseRef.current = 0;
        }

        // Projection logic - Use Real Automation Index
        // High Risk is defined by the Store (Top 25%), reflected in the label
        const isHighRisk = job.salaryVolatilityLabel === VOLATILITY_LABELS.CRITICAL || job.salaryVolatilityLabel === VOLATILITY_LABELS.HIGH;

        const rate = isHighRisk ? ANIMATIONS.HIGH_RISK_GROWTH_RATE : ANIMATIONS.LOW_RISK_GROWTH_RATE;
        const yearsPassed = year - YEAR_MIN;
        // Simple projection for visual height
        const projectedEmployment = job.employment * Math.pow(rate, yearsPassed);

        // Height calculation
        const height = (projectedEmployment / ANIMATIONS.EMPLOYMENT_HEIGHT_DIVISOR);

        // Visual Scale (Mountain Shape)
        const pulseScale = 1 + (Math.sin(pulseRef.current * Math.PI) * ANIMATIONS.PULSE_AMPLITUDE);

        meshRef.current.scale.y += (height - meshRef.current.scale.y) * ANIMATIONS.COLOR_LERP_SPEED;

        // Apply pulse to overall size slightly
        meshRef.current.scale.x = 1 * pulseScale;
        meshRef.current.scale.z = 1 * pulseScale;

        meshRef.current.position.y = meshRef.current.scale.y / 2;

        // Color Logic
        const targetColor = new Color(colorHex);
        if (isSelected) targetColor.offsetHSL(0, 0, 0.2);

        // Apply to Inner Core
        const mat = meshRef.current.material as MeshStandardMaterial;
        mat.color.lerp(targetColor, ANIMATIONS.COLOR_LERP_SPEED);

        if (isSaved) {
            mat.emissive.lerp(targetColor, ANIMATIONS.COLOR_LERP_SPEED);
            mat.emissiveIntensity = ANIMATIONS.EMISSIVE_INTENSITY_HIGHLIGHTED;
        } else {
            // Emissive for normal state too, to look "Holographic"
            mat.emissive.lerp(targetColor, ANIMATIONS.COLOR_LERP_SPEED);
            mat.emissiveIntensity = ANIMATIONS.EMISSIVE_INTENSITY_NORMAL;
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
            const radius = baseRadius * Math.exp(-SHADER.BELL_CURVE_DECAY * y * y);
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
                    emissive={isSaved ? new Color(getJobColor(job)) : new Color(0x000000)}
                    emissiveIntensity={isSaved ? 1.0 : 0.4}
                />

                {/* Wireframe Grid Layer */}
                <mesh scale={[1.02, 1.02, 1.02]}>
                    <latheGeometry args={geometryArgs as any} />
                    <meshBasicMaterial color="white" wireframe opacity={0.2} transparent />
                </mesh>
            </mesh>

            {/* Floating Label with Icon */}
            {(isSelected || job.employment > ANIMATIONS.MAJOR_EMPLOYMENT_THRESHOLD) && (
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
