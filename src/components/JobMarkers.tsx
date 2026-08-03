import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { useStore } from '../store';
import type { Job } from '../types';
import { getTerrainPosition, calculateGaussianHeight, buildGrowthForecastFlatArray, growthAtYearFromForecastFlat, getVisualHeightForGrowth, getVisualHeightForWorkersAtYear, type PeakData, TERRAIN_CONFIG } from '../utils/terrainMath';
import { buildRiskScale, riskBandColor } from '../config/theme';
import { SCENE } from '../config/constants';

export const JobMarkers: React.FC = () => {
    const jobs = useStore((state) => state.jobs);
    const year = useStore((state) => state.year);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const selectedJob = useStore((state) => state.selectedJob);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const mapView = useStore((state) => state.mapView);
    const heightMode = useStore((state) => state.heightMode);

    const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);
    const gl = useThree((state) => state.gl);

    // Clear stuck hover state when the window loses focus (pointerleave can be dropped mid-hover)
    useEffect(() => {
        const clear = () => setHoveredJobId(null);
        window.addEventListener('blur', clear);
        document.addEventListener('visibilitychange', clear);
        return () => {
            window.removeEventListener('blur', clear);
            document.removeEventListener('visibilitychange', clear);
        };
    }, []);

    // Drag-vs-click: forward the gesture to the canvas so OrbitControls rotates,
    // and only open the detail panel if the pointer barely moved.
    const handleLabelPointerDown = (job: Job) => (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startTime = performance.now();

        gl.domElement.dispatchEvent(new PointerEvent('pointerdown', {
            pointerId: e.pointerId,
            pointerType: e.pointerType,
            clientX: e.clientX,
            clientY: e.clientY,
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true,
        }));

        // OrbitControls pointer-captures the canvas, so the label's own pointerup won't fire
        const onUp = (ue: PointerEvent) => {
            window.removeEventListener('pointerup', onUp);
            const moved = Math.hypot(ue.clientX - startX, ue.clientY - startY);
            if (moved < 5 && performance.now() - startTime < 300) {
                setSelectedJob(job);
            }
        };
        window.addEventListener('pointerup', onUp);
    };

    // LOD level stored in ref — avoids re-renders per frame
    const lodLevelRef = useRef<0 | 1 | 2>(2); // 0=Far, 1=Mid, 2=Close

    useFrame((state) => {
        const dist = state.camera.position.length();
        if (dist > SCENE.LOD.FAR) lodLevelRef.current = 0;
        else if (dist > SCENE.LOD.MID) lodLevelRef.current = 1;
        else lodLevelRef.current = 2;
    });

    // Roles to display (filtered by selection)
    const filteredJobs = useMemo(() => {
        if (selectedRoleIds.size === 0) return jobs;
        return jobs.filter(job => selectedRoleIds.has(job.id));
    }, [jobs, selectedRoleIds]);

    const forecastsFlat = useMemo(
        () => buildGrowthForecastFlatArray(filteredJobs),
        [filteredJobs],
    );

    // Built from ALL jobs, never `filteredJobs` — a role's risk colour must not
    // shift just because other roles were filtered out of view.
    const riskScale = useMemo(
        () => buildRiskScale(jobs.map(j => j.automationCostIndex)),
        [jobs],
    );

    // Peak positions & heights (synced with Terrain.tsx shader + forecast flat buffer)
    const peaks = useMemo(() => {
        const nextPeaks = filteredJobs.map((job, filteredIndex) => {
            const i = jobs.findIndex(j => j.id === job.id);
            const g = growthAtYearFromForecastFlat(forecastsFlat, filteredIndex, year);
            const h = heightMode === 'employment'
                ? getVisualHeightForWorkersAtYear(job.employment, g)
                : getVisualHeightForGrowth(g);
            const { x, z } = getTerrainPosition(i, jobs);
            return { x, z, height: h } as PeakData;
        });
        return nextPeaks;
    }, [filteredJobs, jobs, year, heightMode, forecastsFlat]);

    // Stagger: vertical offset to separate overlapping labels
    const staggeredPeaks = useMemo(() => {
        const withOffsets = peaks.map((p, i) => ({ ...p, offset: 0, id: filteredJobs[i].id }));

        // Disabled by default so every leader line is the same length and label
        // height tracks the terrain. See SCENE.LABEL.STAGGER_ENABLED.
        if (!SCENE.LABEL.STAGGER_ENABLED) return withOffsets;

        for (let iter = 0; iter < 3; iter++) {
            for (let i = 0; i < withOffsets.length; i++) {
                for (let j = i + 1; j < withOffsets.length; j++) {
                    const p1 = withOffsets[i];
                    const p2 = withOffsets[j];
                    const dx = p1.x - p2.x;
                    const dz = p1.z - p2.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    if (dist < SCENE.LABEL.COLLISION_DISTANCE) {
                        const offsetDiff = Math.abs(p1.offset - p2.offset);
                        if (offsetDiff < SCENE.LABEL.VERTICAL_OFFSET) {
                            withOffsets[j].offset += SCENE.LABEL.VERTICAL_OFFSET;
                        }
                    }
                }
            }
        }
        return withOffsets;
    }, [peaks, filteredJobs]);

    if (mapView === 'map') return null;

    const isGlobalSelectionActive = !!selectedJob;

    const markerItems = filteredJobs.flatMap((job) => {
        const filteredIndex = filteredJobs.findIndex(j => j.id === job.id);
        const peak = staggeredPeaks[filteredIndex];
        const isSelected = selectedJob?.id === job.id;
        if (isGlobalSelectionActive && !isSelected) return [];

        const originalIndex = jobs.findIndex(j => j.id === job.id);

        // LOD: at very far distance show only major/prominent jobs
        let isVisibleByLOD = true;
        if (!isSelected) {
            if (lodLevelRef.current === 0) {
                const isMajor = Math.abs(job.projectedGrowth) > SCENE.MAJOR_GROWTH_THRESHOLD || originalIndex % SCENE.LOD_FILTER_MODULO === 0;
                if (!isMajor) isVisibleByLOD = false;
            }
        }

        const showLabel = isVisibleByLOD && (isSelected || job.employment > 0);
        if (!showLabel) return [];

        const isHovered = hoveredJobId === job.id;
        const pipColor = riskBandColor(job.automationCostIndex, riskScale);
        const labelHeight = SCENE.LABEL.BASE_HEIGHT + peak.offset;
        const surfaceY = calculateGaussianHeight(peak.x, peak.z, peaks) + TERRAIN_CONFIG.TERRAIN_OFFSET_Y;

        const sampledGrowth = growthAtYearFromForecastFlat(forecastsFlat, filteredIndex, year);
        const roundedYear = Math.round(year);
        const isDeclining = sampledGrowth < 0;
        const isGrowing = sampledGrowth > 0;
        const growthStr = `${sampledGrowth >= 0 ? '+' : ''}${sampledGrowth.toFixed(1)}%`;
        const growthColor = isGrowing ? '#4ade80' : isDeclining ? '#f87171' : '#94a3b8';
        const growthLabel = `${roundedYear} Forecast`;
        const workersStr = job.employment >= 1_000_000
            ? (job.employment / 1_000_000).toFixed(1) + 'M'
            : job.employment >= 1_000
            ? Math.round(job.employment / 1_000) + 'K'
            : job.employment.toString();

        return [{
            job,
            peak,
            surfaceY,
            isSelected,
            isHovered,
            pipColor,
            labelHeight,
            isDeclining,
            growthStr,
            growthColor,
            growthLabel,
            workersStr,
        }];
    }).sort((a, b) => Number(a.isHovered || a.isSelected) - Number(b.isHovered || b.isSelected));

    return (
        <group>
            {markerItems.map(({
                job, peak, surfaceY, isSelected, isHovered, pipColor, labelHeight,
                isDeclining, growthStr, growthColor, growthLabel, workersStr,
            }) => (
                    <group key={job.id} position={[peak.x, surfaceY, peak.z]}>
                        {/* Anchor ring */}
                        <mesh rotation={[-Math.PI / 2, 0, 0]}>
                            <ringGeometry args={[SCENE.ANCHOR.RING_INNER, SCENE.ANCHOR.RING_OUTER, SCENE.ANCHOR.RING_SEGMENTS]} />
                            <meshBasicMaterial color="#ffffff" transparent opacity={0.6} side={2} />
                        </mesh>
                        {/* Anchor dot */}
                        <mesh>
                            <sphereGeometry args={[SCENE.ANCHOR.SPHERE_RADIUS]} />
                            <meshBasicMaterial color="#ffffff" />
                        </mesh>

                        {/* Leader line */}
                        <Line
                            points={[[0, 0, 0], [0, labelHeight, 0]]}
                            color="white"
                            lineWidth={0.5}
                            transparent
                            opacity={0.6}
                        />

                        {/* Label — drei rewrites host z-index from camera distance. On hover we
                            force this host to the front AND pin every other host to the back
                            (previously --front stuck forever when wrapperClass went undefined,
                            so many labels shared max z and later DOM siblings covered the popup). */}
                        <Html
                            position={[0, labelHeight, 0]}
                            center
                            wrapperClass={
                                isHovered || isSelected
                                    ? 'foj-job-label foj-job-label--front'
                                    : hoveredJobId
                                      ? 'foj-job-label foj-job-label--recessed'
                                      : 'foj-job-label'
                            }
                            zIndexRange={isHovered || isSelected ? [16777271, 16777000] : [100, 0]}
                        >
                            <div
                                className={`flex flex-col max-w-[min(11rem,calc(100vw-2rem))] overflow-hidden rounded border shadow-sm cursor-pointer touch-none select-none transition-all duration-200 ${isSelected || isHovered ? 'bg-[#0F172A]/95 backdrop-blur-sm scale-105 ring-1 ring-white/25 border-slate-300/40 shadow-xl shadow-black/50' : 'bg-[#0F172A]/72 backdrop-blur-[2px] border-slate-600/40'} ${isHovered ? 'border-cyan-400/60' : ''}`}
                                onPointerDown={handleLabelPointerDown(job)}
                                onPointerEnter={() => setHoveredJobId(job.id)}
                                onPointerLeave={() => setHoveredJobId(null)}
                            >
                                {/* Title row */}
                                <div className="flex items-center gap-1.5 px-1.5 py-0.5 min-w-0">
                                    {/* The only risk indicator on the label now, so it reads
                                        bold and discrete rather than a point on a ramp. */}
                                    <div
                                        className="w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-black/30"
                                        style={{ backgroundColor: pipColor, boxShadow: `0 0 4px ${pipColor}` }}
                                    />
                                    <span className="text-white text-[10px] font-medium leading-tight tracking-wide font-sans truncate min-w-0" title={job.title}>{job.title}</span>
                                </div>

                                {/* Stats on hover/selection. Deliberately just workers + forecast:
                                    AI risk is carried by the colour of the dot above, and the old
                                    Sector row always read "Business" for every role. */}
                                {(isHovered || isSelected) && (
                                    <div className="px-1.5 pb-1 pt-0 border-t border-slate-700/40 grid grid-cols-2 gap-x-2 gap-y-0.5 min-w-0">
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[8px] text-slate-500 uppercase tracking-wider leading-none">Workers</span>
                                            <span className="text-[10px] text-slate-200 font-mono font-medium leading-none truncate">{workersStr}</span>
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[8px] text-slate-500 uppercase tracking-wider leading-none">{growthLabel}</span>
                                            <span className="text-[10px] font-mono font-medium leading-none truncate" style={{ color: growthColor }}>
                                                {isDeclining ? `${growthStr} Decline` : growthStr}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Html>
                    </group>
            ))}
        </group>
    );
};
