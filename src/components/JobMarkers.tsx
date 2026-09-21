import React, { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { Html, Line } from '@react-three/drei';
import { useStore } from '../store';
import type { Job } from '../types';
import { getTerrainPosition, calculateGaussianHeight, buildGrowthForecastFlatArray, growthAtYearFromForecastFlat, getVisualHeightForGrowth, getVisualHeightForWorkersAtYear, impliedEmploymentAtYear, type PeakData, TERRAIN_CONFIG } from '../utils/terrainMath';
import { buildRiskScale, riskBandColor } from '../config/theme';
import { SCENE, YEAR_MAX } from '../config/constants';
import { useIsMobile } from '../hooks/useIsMobile';
import { clampLabelCenterX, clampLabelCenterY } from '../utils/labelLayout';

/** Scratch vector for label projection: reused so the per-frame position
 *  callback allocates nothing. */
const projected = new Vector3();

export const JobMarkers: React.FC = () => {
    const jobs = useStore((state) => state.jobs);
    const year = useStore((state) => state.year);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const selectedJob = useStore((state) => state.selectedJob);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const mapView = useStore((state) => state.mapView);
    const heightMode = useStore((state) => state.heightMode);
    const isOrbiting = useStore((state) => state.isOrbiting);

    const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);
    // Half-size of each rendered label, measured from the DOM once per render
    // and read back when projecting, so a label near an edge can be nudged
    // fully into view instead of hanging off it.
    const labelHalfSize = React.useRef<Map<string, { x: number; y: number }>>(new Map());
    const gl = useThree((state) => state.gl);
    const isMobile = useIsMobile();

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

    // While the user holds LMB (or touch) to rotate/pan/zoom, suppress foreground hover popups.
    useEffect(() => {
        if (isOrbiting) setHoveredJobId(null);
    }, [isOrbiting]);

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

        // Off on desktop so every leader line is the same length and label height
        // mirrors the terrain (see SCENE.LABEL.STAGGER_ENABLED). On a phone all 50
        // titles share 393px, so separation matters more than that mapping.
        if (!SCENE.LABEL.STAGGER_ENABLED && !isMobile) return withOffsets;

        // A phone views the terrain from much further back, so peaks that are far
        // apart in world units still land on top of each other on screen. Both the
        // collision radius and the separation step scale up to compensate.
        const collision = isMobile ? SCENE.LABEL.COLLISION_DISTANCE * 1.8 : SCENE.LABEL.COLLISION_DISTANCE;
        const step = isMobile ? SCENE.LABEL.VERTICAL_OFFSET * 1.7 : SCENE.LABEL.VERTICAL_OFFSET;
        const passes = isMobile ? 6 : 3;

        for (let iter = 0; iter < passes; iter++) {
            for (let i = 0; i < withOffsets.length; i++) {
                for (let j = i + 1; j < withOffsets.length; j++) {
                    const p1 = withOffsets[i];
                    const p2 = withOffsets[j];
                    const dx = p1.x - p2.x;
                    const dz = p1.z - p2.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);

                    if (dist < collision) {
                        const offsetDiff = Math.abs(p1.offset - p2.offset);
                        if (offsetDiff < step) {
                            withOffsets[j].offset += step;
                        }
                    }
                }
            }
        }
        return withOffsets;
    }, [peaks, filteredJobs, isMobile]);

    if (mapView === 'map') return null;

    const isGlobalSelectionActive = !!selectedJob;

    const markerItems = filteredJobs.flatMap((job) => {
        const filteredIndex = filteredJobs.findIndex(j => j.id === job.id);
        const peak = staggeredPeaks[filteredIndex];
        const isSelected = selectedJob?.id === job.id;
        if (isGlobalSelectionActive && !isSelected) return [];

        // Distance used to drop ~2 in 5 labels beyond SCENE.LOD.FAR, so zooming
        // out to see the whole terrain silently removed roles from view. Every
        // role keeps its label at every distance now, matching the desktop view.

        // Expanded hover stats are disabled during orbit so popups don't fight the camera.
        const isHovered = !isOrbiting && hoveredJobId === job.id;

        // The anchor ring/dot/leader-line always render for every LOD-visible
        // job — they carry the risk colour and keep the terrain legible at a
        // glance. Only the floating TEXT label is thinned on mobile, where all
        // 50 overlap into unreadable mush; every job stays one search away.
        // Every role carries its label on every device, matching the desktop
        // view. The old phone-only thinning hid 45 of 50 titles.
        const showLabelText = isMobile && isGlobalSelectionActive ? false : true;

        const pipColor = riskBandColor(job.automationCostIndex, riskScale);
        const labelHeight = SCENE.LABEL.BASE_HEIGHT + peak.offset;
        const surfaceY = calculateGaussianHeight(peak.x, peak.z, peaks) + TERRAIN_CONFIG.TERRAIN_OFFSET_Y;

        // Forecast stat is pinned to the terminal year (2030) regardless of the
        // slider, so it reads as "where this role ends up" instead of always
        // showing the 2025 baseline (0% by definition) when the slider starts there.
        const forecastGrowth = growthAtYearFromForecastFlat(forecastsFlat, filteredIndex, YEAR_MAX);
        const isDeclining = forecastGrowth < 0;
        const isGrowing = forecastGrowth > 0;
        const growthStr = `${forecastGrowth >= 0 ? '+' : ''}${forecastGrowth.toFixed(1)}%`;
        const growthColor = isGrowing ? '#4ade80' : isDeclining ? '#f87171' : '#94a3b8';
        const growthLabel = `${YEAR_MAX} Forecast`;

        // Workers stat tracks the slider: implied headcount at the scrubbed year,
        // using the same formula that drives the terrain peak in Workers mode.
        const sliderGrowth = growthAtYearFromForecastFlat(forecastsFlat, filteredIndex, year);
        const roundedYear = Math.round(year);
        const impliedWorkers = impliedEmploymentAtYear(job.employment, sliderGrowth);
        const workersStr = impliedWorkers >= 1_000_000
            ? (impliedWorkers / 1_000_000).toFixed(1) + 'M'
            : impliedWorkers >= 1_000
            ? Math.round(impliedWorkers / 1_000) + 'K'
            : Math.round(impliedWorkers).toString();
        const workersLabel = `${roundedYear} Workers`;

        return [{
            job,
            peak,
            surfaceY,
            isSelected,
            isHovered,
            showLabelText,
            pipColor,
            labelHeight,
            growthStr,
            growthColor,
            growthLabel,
            workersStr,
            workersLabel,
        }];
    }).sort((a, b) => Number(a.isHovered || a.isSelected) - Number(b.isHovered || b.isSelected));

    return (
        <group>
            {markerItems.map(({
                job, peak, surfaceY, isSelected, isHovered, showLabelText, pipColor, labelHeight,
                growthStr, growthColor, growthLabel, workersStr, workersLabel,
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
                            so many labels shared max z and later DOM siblings covered the popup).
                            showLabelText is always true on desktop; on mobile it's thinned to
                            the top employers + selected/hovered so the terrain stays readable —
                            every job is still one search away. */}
                        {showLabelText && (
                        <Html
                            position={[0, labelHeight, 0]}
                            center
                            // drei's default projection lets a label overhang the
                            // viewport when its peak sits near an edge. Same maths,
                            // then clamped so the whole box stays on screen.
                            calculatePosition={(obj, camera, size) => {
                                projected.setFromMatrixPosition(obj.matrixWorld).project(camera);
                                const x = (projected.x * size.width) / 2 + size.width / 2;
                                const y = -((projected.y * size.height) / 2) + size.height / 2;
                                const half = labelHalfSize.current.get(job.id);
                                if (!half) return [x, y];
                                return [
                                    clampLabelCenterX(x, half.x, size.width),
                                    clampLabelCenterY(y, half.y, size.height),
                                ];
                            }}
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
                                ref={(el) => {
                                    if (el) labelHalfSize.current.set(job.id, { x: el.offsetWidth / 2, y: el.offsetHeight / 2 });
                                }}
                                className={`flex flex-col max-w-[min(13rem,calc(100vw-2rem))] overflow-hidden rounded border shadow-sm cursor-pointer touch-none select-none transition-all duration-200 ${isSelected || isHovered ? 'bg-[#0F172A]/95 scale-105 ring-1 ring-white/25 border-slate-300/40 shadow-xl shadow-black/50' : 'bg-[#0F172A]/90 border-slate-600/40'} ${isHovered ? 'border-cyan-400/60' : ''}`}
                                onPointerDown={handleLabelPointerDown(job)}
                                onPointerEnter={() => {
                                    if (!isOrbiting) setHoveredJobId(job.id);
                                }}
                                onPointerLeave={() => setHoveredJobId(null)}
                            >
                                {/* Title row */}
                                <div className="flex items-center gap-1.5 px-1.5 py-0.5 max-md:gap-1 max-md:px-1 min-w-0">
                                    {/* The only risk indicator on the label now, so it reads
                                        bold and discrete rather than a point on a ramp. */}
                                    <div
                                        className="w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-black/30"
                                        style={{ backgroundColor: pipColor, boxShadow: `0 0 4px ${pipColor}` }}
                                    />
                                    <span className="text-white text-[10px] max-md:text-[9px] font-medium leading-tight tracking-wide font-sans truncate min-w-0" title={job.title}>{job.title}</span>
                                </div>

                                {/* Stats on hover/selection. Deliberately just workers + forecast:
                                    AI risk is carried by the colour of the dot above, and the old
                                    Sector row always read "Business" for every role. */}
                                {(isHovered || isSelected) && (
                                    // Stacked rows, not side-by-side columns: "2030 WORKERS" /
                                    // "2030 FORECAST" labels are long enough that splitting the
                                    // box in half made one label's text overflow into the other
                                    // column. A full-width row per stat has room for either label
                                    // at any year without competing for horizontal space.
                                    <div className="px-2 pb-1 pt-0 border-t border-slate-700/40 flex flex-col gap-y-0.5 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2 min-w-0">
                                            <span className="text-[8px] text-slate-500 uppercase tracking-wider leading-none whitespace-nowrap">{workersLabel}</span>
                                            <span className="text-[10px] text-slate-200 font-mono font-medium leading-none whitespace-nowrap">{workersStr}</span>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-2 min-w-0">
                                            <span className="text-[8px] text-slate-500 uppercase tracking-wider leading-none whitespace-nowrap">{growthLabel}</span>
                                            <span className="text-[10px] font-mono font-medium leading-none whitespace-nowrap" style={{ color: growthColor }}>
                                                {growthStr}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Html>
                        )}
                    </group>
            ))}
        </group>
    );
};
