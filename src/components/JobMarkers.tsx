import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { useStore } from '../store';
import { getTerrainPosition, calculateGaussianHeight, getCurrentYearGrowth, getVisualHeightForGrowth, type PeakData, TERRAIN_CONFIG } from '../utils/terrainMath';
import { CLUSTER_COLORS, FALLBACK_COLORS } from '../config/theme';
import { SCENE } from '../config/constants';

export const JobMarkers: React.FC = () => {
    const jobs = useStore((state) => state.jobs);
    const year = useStore((state) => state.year);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const selectedJob = useStore((state) => state.selectedJob);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const mapView = useStore((state) => state.mapView);

    const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);
    const lastMarkerLogRef = useRef<string>('');

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

    // Peak positions & heights (synced with Terrain.tsx shader)
    const peaks = useMemo(() => {
        const nextPeaks = filteredJobs.map((job) => {
            const i = jobs.findIndex(j => j.id === job.id);
            const { value: currentGrowth } = getCurrentYearGrowth(job, year);
            const h = getVisualHeightForGrowth(currentGrowth);
            const { x, z } = getTerrainPosition(i);
            if (job.id === 'job-15') {
                // #region agent log
                fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a3c6a6'},body:JSON.stringify({sessionId:'a3c6a6',runId:'run2',hypothesisId:'H5',location:'JobMarkers.tsx:63',message:'marker_peak_growth_source',data:{jobId:job.id,year,hasYearlyForecast:!!job.yearlyForecast,currentGrowth,projectedGrowth:job.projectedGrowth,visualHeight:h},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
            }
            return { x, z, height: h } as PeakData;
        });
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'run1',hypothesisId:'H3',location:'JobMarkers.tsx:73',message:'marker_peaks_built',data:{year,jobCount:filteredJobs.length,samplePeaks:filteredJobs.slice(0,3).map((job,i)=>({id:job.id,title:job.title,currentGrowth:getCurrentYearGrowth(job,year).value,height:nextPeaks[i]?.height}))},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return nextPeaks;
    }, [filteredJobs, jobs, year]);

    // Stagger: vertical offset to separate overlapping labels
    const staggeredPeaks = useMemo(() => {
        const withOffsets = peaks.map((p, i) => ({ ...p, offset: 0, id: filteredJobs[i].id }));

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

    return (
        <group>
            {filteredJobs.map((job) => {
                const filteredIndex = filteredJobs.findIndex(j => j.id === job.id);
                const peak = staggeredPeaks[filteredIndex];
                const surfaceY = calculateGaussianHeight(peak.x, peak.z, peaks) + TERRAIN_CONFIG.TERRAIN_OFFSET_Y;
                const isSelected = selectedJob?.id === job.id;
                const isGlobalSelectionActive = !!selectedJob;

                if (isGlobalSelectionActive && !isSelected) return null;

                const originalIndex = jobs.findIndex(j => j.id === job.id);

                // LOD: at very far distance show only major/prominent jobs
                let isVisibleByLOD = true;
                if (!isSelected) {
                    if (lodLevelRef.current === 0) {
                        const isMajor = Math.abs(job.projectedGrowth) > SCENE.MAJOR_GROWTH_THRESHOLD || originalIndex % SCENE.LOD_FILTER_MODULO === 0;
                        if (!isMajor) isVisibleByLOD = false;
                    }
                    // LOD 1 and 2: show all labels
                }

                const showLabel = isVisibleByLOD && (isSelected || job.employment > 0);
                if (!showLabel) return null;

                const isHovered = hoveredJobId === job.id;
                const pipColor = CLUSTER_COLORS[job.cluster] || FALLBACK_COLORS[originalIndex % FALLBACK_COLORS.length];
                const labelHeight = SCENE.LABEL.BASE_HEIGHT + peak.offset;
                if (job.id === 'job-15') {
                    const markerKey = `${year}-${surfaceY.toFixed(3)}-${labelHeight.toFixed(3)}`;
                    if (lastMarkerLogRef.current !== markerKey) {
                        lastMarkerLogRef.current = markerKey;
                        // #region agent log
                        fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a3c6a6'},body:JSON.stringify({sessionId:'a3c6a6',runId:'run2',hypothesisId:'H6',location:'JobMarkers.tsx:126',message:'marker_surface_and_label_position',data:{jobId:job.id,year,surfaceY,labelHeight,peakHeight:peak.height},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion
                    }
                }

                const automationRisk = job.automationCostIndex >= 0.65 ? 'High' : job.automationCostIndex >= 0.4 ? 'Moderate' : 'Low';
                const riskColor = automationRisk === 'High' ? '#f87171' : automationRisk === 'Moderate' ? '#fb923c' : '#4ade80';
                const { value: currentYearGrowth, source: growthSource } = getCurrentYearGrowth(job, year);
                const roundedYear = Math.round(year);
                const isDeclining = currentYearGrowth < 0;
                const isGrowing = currentYearGrowth > 0;
                const growthStr = `${currentYearGrowth >= 0 ? '+' : ''}${currentYearGrowth.toFixed(1)}%`;
                const growthColor = isGrowing ? '#4ade80' : isDeclining ? '#f87171' : '#94a3b8';
                const growthLabel = `${roundedYear} Forecast`;
                const growthSourceLabel = growthSource === 'ai' ? 'AI Forecast' : 'Baseline Estimate';
                const workersStr = job.employment >= 1_000_000
                    ? (job.employment / 1_000_000).toFixed(1) + 'M'
                    : job.employment >= 1_000
                    ? Math.round(job.employment / 1_000) + 'K'
                    : job.employment.toString();

                return (
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

                        {/* Label */}
                        <Html position={[0, labelHeight, 0]} center zIndexRange={[100, 0]}>
                            <div
                                className={`flex flex-col bg-[#0F172A]/90 backdrop-blur-md rounded-md border shadow-md cursor-pointer transition-all duration-200 ${isSelected ? 'scale-110 ring-1 ring-white/20 border-slate-600/60' : 'border-slate-700/50'} ${isHovered ? 'border-cyan-500/40 shadow-cyan-500/10 shadow-lg' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setSelectedJob(job); }}
                                onMouseEnter={() => setHoveredJobId(job.id)}
                                onMouseLeave={() => setHoveredJobId(null)}
                            >
                                {/* Title row */}
                                <div className="flex items-center gap-3 px-3 py-2">
                                    <div
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: pipColor, boxShadow: `0 0 4px ${pipColor}` }}
                                    />
                                    <span className="text-white text-xs font-semibold leading-none whitespace-nowrap tracking-wide font-sans">{job.title}</span>
                                </div>

                                {/* BLS Stats — shown on hover or when selected */}
                                {(isHovered || isSelected) && (
                                    <div className="px-3 pb-2.5 pt-0 border-t border-slate-700/50 mt-0.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] text-slate-500 uppercase tracking-widest leading-none mb-0.5">Workers</span>
                                            <span className="text-[11px] text-slate-200 font-mono font-medium leading-none">{workersStr}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] text-slate-500 uppercase tracking-widest leading-none mb-0.5">{growthLabel}</span>
                                            <span className="text-[11px] font-mono font-medium leading-none" style={{ color: growthColor }}>
                                                {isDeclining ? `${growthStr} Decline` : growthStr}
                                            </span>
                                            <span className="text-[9px] text-slate-600 uppercase tracking-widest leading-none mt-1">{growthSourceLabel}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] text-slate-500 uppercase tracking-widest leading-none mb-0.5">AI Risk</span>
                                            <span className="text-[11px] font-medium leading-none" style={{ color: riskColor }}>{automationRisk}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[9px] text-slate-500 uppercase tracking-widest leading-none mb-0.5">Sector</span>
                                            <span className="text-[11px] text-slate-300 font-medium leading-none whitespace-nowrap">{job.cluster}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Html>
                    </group>
                );
            })}
        </group>
    );
};
