import React, { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { useStore } from '../store';
import { getJobStatus } from '../data';
import { getTerrainPosition, calculateGaussianHeight, type PeakData, TERRAIN_CONFIG } from '../utils/terrainMath';

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

export const JobMarkers: React.FC = () => {
    const jobs = useStore((state) => state.jobs);
    const year = useStore((state) => state.year);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const selectedJob = useStore((state) => state.selectedJob);

    // Pre-calculate all peak states for this frame/year
    const peaks = useMemo(() => {
        return jobs.map((job, i) => {
            // SYNCED LOGIC WITH TERRAIN.TSX
            // Interpolate growth impact based on current year (2025-2030)
            const progress = (year - 2025) / 5; // 0.0 to 1.0

            // Calculate "Current" Growth at this specific year
            const currentGrowth = job.projectedGrowth * progress;

            // Visual Height Calculation (Must match Terrain.tsx exactly)
            const getVisualHeight = (growthDelta: number) => {
                const baseHeight = 1.2;
                const impact = growthDelta * 0.08;
                return Math.max(0.2, Math.min(4.0, baseHeight + impact));
            };

            const h = getVisualHeight(currentGrowth);
            const { x, z } = getTerrainPosition(i);

            // Note: We use the same 'h' that the vertex shader receives
            return { x, z, height: h } as PeakData;
        });
    }, [jobs, year]);

    return (
        <group>
            {jobs.map((job, i) => {
                const peak = peaks[i];

                // Calculate Surface Height at this peak's location
                // (Sum of influences from all peaks including itself)
                // Add TERRAIN_OFFSET_Y because the mesh is shifted down
                const surfaceY = calculateGaussianHeight(peak.x, peak.z, peaks) + TERRAIN_CONFIG.TERRAIN_OFFSET_Y;

                const status = getJobStatus(job, year);

                // Only show label if selected OR high employment (to reduce clutter)
                // AND if no job is globally selected (to prevent modal overlap)
                const isSelected = selectedJob?.id === job.id;
                const isGlobalSelectionActive = !!selectedJob;

                // Visibility Logic:
                // 1. If this is the selected job, ALWAYS show it.
                // 2. If global selection is active (modal open) but this ISN'T the selected job, hide it to reduce noise.
                // 3. If no global selection, show based on employment threshold to prevent clutter.
                if (isGlobalSelectionActive && !isSelected) return null;

                const showLabel = isSelected || job.employment > 0;
                if (!showLabel) return null;

                // Color for glow
                const color = status.color; // Hex string

                return (
                    <group key={job.id} position={[peak.x, surfaceY, peak.z]}>
                        {/* Anchor Dot at Peak Tip */}
                        <mesh position={[0, 0, 0]} scale={isSelected ? [1.5, 1.5, 1.5] : [1, 1, 1]}>
                            <sphereGeometry args={[0.4, 16, 16]} />
                            <meshBasicMaterial color={isSelected ? '#fff' : color} toneMapped={false} />
                        </mesh>

                        {/* Leader Line (Short & Direct) */}
                        <Line
                            points={[[0, 0, 0], [0, 1.8, 0]]}
                            color={color}
                            lineWidth={isSelected ? 3.0 : 2.0}
                            transparent
                            opacity={0.8}
                        />

                        {/* Floating Label (closer to peak) */}
                        <Html position={[0, 1.8, 0]} center zIndexRange={[100, 0]}>
                            <div
                                className={`flex flex-col items-center cursor-pointer transition-transform duration-300 ${isSelected ? 'scale-125 z-50' : 'hover:scale-110'}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedJob(job);
                                }}
                            >
                                {/* Neon Icon Badge */}
                                <div
                                    className={`w-10 h-10 rounded-full bg-gray-900/80 backdrop-blur-sm border-2 flex items-center justify-center text-lg mb-2 shadow-[0_0_15px_currentColor] ${isSelected ? 'ring-4 ring-white/20 animate-pulse' : ''}`}
                                    style={{ borderColor: color, color: color, boxShadow: `0 0 15px ${color}` }}
                                >
                                    {getJobIcon(job.title)}
                                </div>

                                {/* Label Bubble */}
                                <div
                                    className="px-3 py-1 bg-gray-900/80 backdrop-blur-md rounded-full border border-white/10 text-white text-xs font-bold whitespace-nowrap shadow-lg"
                                >
                                    {job.title}
                                </div>
                            </div>
                        </Html>
                    </group>
                );
            })}
        </group>
    );
};
