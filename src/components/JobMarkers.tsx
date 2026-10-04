import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { Html, Line } from '@react-three/drei';
import { useStore } from '../store';
import type { Job } from '../types';
import { getTerrainPosition, calculateGaussianHeight, buildGrowthForecastFlatArray, growthAtYearFromForecastFlat, getVisualHeightForHumanWorkAtYear, getVisualHeightForWorkersAtYear, impliedEmploymentAtYear, type PeakData, TERRAIN_CONFIG } from '../utils/terrainMath';
import { buildRiskScale, riskBandColor } from '../config/theme';
import { SCENE, YEAR_MAX } from '../config/constants';
import { useIsMobile } from '../hooks/useIsMobile';
import { socAliasCount } from '../utils/onet';
import {
    HIDDEN_LABEL_POSITION,
    isHiddenLabelPosition,
    layoutLabels,
    type LabelCandidate,
} from '../utils/labelLayout';

/** Leader line that hides when declutter parks the label off-screen. */
const DeclutterAwareLeaderLine: React.FC<{
    jobId: string;
    labelHeight: number;
    placements: React.MutableRefObject<Map<string, [number, number]>>;
}> = ({ jobId, labelHeight, placements }) => {
    const groupRef = useRef<Group>(null);
    useFrame(() => {
        const pos = placements.current.get(jobId);
        const show = !!pos && !isHiddenLabelPosition(pos);
        if (groupRef.current) groupRef.current.visible = show;
    });
    return (
        <group ref={groupRef}>
            <Line
                points={[[0, 0, 0], [0, labelHeight, 0]]}
                color="white"
                lineWidth={0.5}
                transparent
                opacity={0.6}
            />
        </group>
    );
};

/** Scratch vector for label projection: reused so the per-frame layout
 *  pass allocates nothing beyond the candidate list it already owns. */
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
    // and read back when projecting, so the shared declutter pass knows each
    // box's footprint.
    const labelHalfSize = useRef<Map<string, { x: number; y: number }>>(new Map());
    // Vertical band the labels may occupy. Measured from the real chrome rather
    // than hard-coded, because the header wraps differently across phone widths.
    const safeBand = useRef({ top: 4, bottom: 4 });
    // Shared per-frame declutter results: id → [cssX, cssY]. calculatePosition
    // only reads this; the useFrame pass below is the sole writer.
    const placements = useRef<Map<string, [number, number]>>(new Map());
    // Last accepted nudge per id — hysteresis so a label does not flicker
    // between two equally valid spots as the camera moves.
    const labelOffsets = useRef<Map<string, [number, number]>>(new Map());
    // Meta for the declutter pass: id + leader-line tip height. Written in
    // useLayoutEffect (not during render) so react-hooks/refs stays clean;
    // read only from useFrame.
    const labelMeta = useRef<Array<{ id: string; worldY: number }>>([]);
    // Peak-group instances by job id — filled by callback refs, read from useFrame.
    const groupById = useRef<Map<string, Group>>(new Map());
    // Reused candidate buffer so layoutLabels does not allocate per frame.
    const candidates = useRef<LabelCandidate[]>([]);
    // Screen-space peak tip anchors — used as a tappable proxy when declutter
    // parks a label at HIDDEN_LABEL_POSITION (otherwise those roles are search-only).
    const peakAnchors = useRef<Map<string, { x: number; y: number }>>(new Map());
    const PEAK_HIT_RADIUS_PX = 28;

    const gl = useThree((state) => state.gl);
    const isMobile = useIsMobile();

    // Measured on every viewport, not just phones: a short, wide window (1280x800,
    // 1024x768, a landscape phone at 844x390) puts the terrain's label band right
    // under the header too. Verified on production before this change: 5 labels
    // over the header at 1280x800, 6 at 1024x768 and 41 at 844x390.
    useEffect(() => {
        const measure = () => {
            const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
            const header = box('header');
            const search = box('[data-tour="tour-search"]');
            const slider = box('[data-tour="tour-slider"]');
            const top = Math.max(header?.bottom ?? 0, search?.bottom ?? 0, 4);
            const bottom = slider ? Math.max(window.innerHeight - slider.top, 4) : 4;
            safeBand.current = { top: top + 6, bottom: bottom + 6 };
        };
        measure();
        // The chrome mounts after the canvas, so measure again once it settles.
        const t = setTimeout(measure, 1200);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

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

    // Ref so the canvas hit-test listeners do not rebind when orbit starts
    // (rebinding would reset the tap-start coordinates mid-gesture).
    const isOrbitingRef = useRef(isOrbiting);
    useEffect(() => {
        isOrbitingRef.current = isOrbiting;
    }, [isOrbiting]);

    // Canvas owns every gesture. Labels are pointer-events:none (see index.css) so a
    // finger that lands on a title still hits the WebGL canvas and OrbitControls
    // rotates normally. The old path synthesised a pointerdown onto the canvas from
    // the label; on touch that left OrbitControls with a NaN camera and the
    // terrain vanished. Tap-to-select and mouse-hover are hit-tested here against
    // the same screen-space placements the declutter pass just wrote.
    useEffect(() => {
        const el = gl.domElement;
        let downX = 0;
        let downY = 0;
        let downT = 0;

        const canvasPoint = (clientX: number, clientY: number) => {
            const rect = el.getBoundingClientRect();
            return { x: clientX - rect.left, y: clientY - rect.top };
        };

        const hitTest = (clientX: number, clientY: number): string | null => {
            const { x, y } = canvasPoint(clientX, clientY);
            // labelMeta is importance-sorted (selected/hovered, then employment);
            // first match wins if two boxes ever share a pixel.
            for (const { id } of labelMeta.current) {
                const pos = placements.current.get(id);
                if (!pos || isHiddenLabelPosition(pos)) continue;
                const half = labelHalfSize.current.get(id);
                if (!half) continue;
                if (Math.abs(x - pos[0]) <= half.x && Math.abs(y - pos[1]) <= half.y) {
                    return id;
                }
            }
            // Declutter-hidden labels: fall back to a small hit radius on the peak tip
            // so crowded phones can still tap roles that lost their title.
            let bestId: string | null = null;
            let bestDist = PEAK_HIT_RADIUS_PX;
            for (const { id } of labelMeta.current) {
                const pos = placements.current.get(id);
                if (pos && !isHiddenLabelPosition(pos)) continue;
                const anchor = peakAnchors.current.get(id);
                if (!anchor) continue;
                const d = Math.hypot(x - anchor.x, y - anchor.y);
                if (d < bestDist) {
                    bestDist = d;
                    bestId = id;
                }
            }
            return bestId;
        };

        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            downX = e.clientX;
            downY = e.clientY;
            downT = performance.now();
        };

        const onUp = (e: PointerEvent) => {
            if (e.button !== 0) return;
            // Movement is the real drag-vs-tap discriminator. The time bound is
            // only a backstop; 300ms was too tight for real finger taps (and for
            // touch-event delivery latency on phones), so allow half a second.
            const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moved >= 10 || performance.now() - downT >= 500) return;
            const id = hitTest(e.clientX, e.clientY);
            if (!id) return;
            const job = jobs.find((j) => j.id === id);
            if (job) setSelectedJob(job);
        };

        const onMove = (e: PointerEvent) => {
            // Touch has no hover; while orbiting, popups are suppressed.
            if (e.pointerType === 'touch' || isOrbitingRef.current) {
                el.style.cursor = '';
                return;
            }
            const id = hitTest(e.clientX, e.clientY);
            setHoveredJobId(id);
            el.style.cursor = id ? 'pointer' : '';
        };

        const onLeave = () => {
            setHoveredJobId(null);
            el.style.cursor = '';
        };

        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', onLeave);
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
            el.style.cursor = '';
        };
    }, [gl, jobs, setSelectedJob]);

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
                : getVisualHeightForHumanWorkAtYear(job.employment, g, job.automationCostIndex, year);
            const { x, z } = getTerrainPosition(i, jobs);
            return { x, z, height: h } as PeakData;
        });
        return nextPeaks;
    }, [filteredJobs, jobs, year, heightMode, forecastsFlat]);

    // Stagger: vertical offset to separate overlapping labels.
    // Disabled while SCENE.LABEL.STAGGER_ENABLED is false on every device —
    // the old mobile-only path pushed labelHeight up without a bound, which
    // sent leader-line tips off the top of a phone viewport (Ray, foldable).
    // Equal-length lines also restore the documented mapping: label height on
    // screen mirrors the terrain beneath it. Declutter (layoutLabels) handles
    // overlap by hiding crowded labels rather than stretching the lines.
    const staggeredPeaks = useMemo(() => {
        const withOffsets = peaks.map((p, i) => ({ ...p, offset: 0, id: filteredJobs[i].id }));

        if (!SCENE.LABEL.STAGGER_ENABLED) return withOffsets;

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

    // One shared declutter pass per frame. Projects every leader-line tip,
    // places each label as close to its own tip as it can get without covering
    // an already-placed label, and parks the rest at HIDDEN_LABEL_POSITION.
    // That is what keeps the line attached to its label: the tip is the
    // anchor, and resolveLabelPosition / layoutLabels refuse any placement
    // that would leave the tip outside the box.
    useFrame((state) => {
        const meta = labelMeta.current;
        if (meta.length === 0) return;

        const { camera, size } = state;
        const list = candidates.current;
        list.length = 0;

        for (const a of meta) {
            const half = labelHalfSize.current.get(a.id) ?? { x: 40, y: 10 };
            // The Html's local position is [0, labelHeight, 0] inside the peak
            // group — project that world point, not the peak base.
            const group = groupById.current.get(a.id);
            if (!group) continue;
            projected.set(0, a.worldY, 0);
            group.localToWorld(projected);
            projected.project(camera);
            const inFront = projected.z >= -1 && projected.z <= 1;
            const x = (projected.x * size.width) / 2 + size.width / 2;
            const y = -((projected.y * size.height) / 2) + size.height / 2;
            peakAnchors.current.set(a.id, { x, y });
            list.push({
                id: a.id,
                anchorX: x,
                anchorY: y,
                halfWidth: half.x,
                halfHeight: half.y,
                inFront,
            });
        }

        layoutLabels(
            list,
            size.width,
            size.height,
            safeBand.current,
            placements.current,
            labelOffsets.current,
            2,
            4,
        );
    });

    // Task view and the US map both sit as opaque overlays on top of this
    // canvas. JobMarkers still mounts (hooks must stay unconditional) but the
    // JSX returns null so the 50 Html DOM nodes are not kept alive under an
    // opaque panel. Landscape also pauses the WebGL loop for those views.
    const isGlobalSelectionActive = !!selectedJob;

    const markerItems = useMemo(() => {
        if (mapView !== 'globe') return [] as Array<{
            job: Job;
            peak: PeakData & { offset: number; id: string };
            surfaceY: number;
            isSelected: boolean;
            isHovered: boolean;
            showLabelText: boolean;
            pipColor: string;
            labelHeight: number;
            growthStr: string;
            growthColor: string;
            growthLabel: string;
            workersStr: string;
            workersLabel: string;
            socShareNote: string | null;
        }>;

        const items = filteredJobs.flatMap((job) => {
            const filteredIndex = filteredJobs.findIndex(j => j.id === job.id);
            const peak = staggeredPeaks[filteredIndex];
            const isSelected = selectedJob?.id === job.id;
            if (isGlobalSelectionActive && !isSelected) return [];

            // Expanded hover stats are disabled during orbit so popups don't fight the camera.
            const isHovered = !isOrbiting && hoveredJobId === job.id;

            // Every role carries its label on every device. The shared declutter
            // pass (layoutLabels) hides crowded ones rather than thinning by
            // employment count up front.
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
            const aliasN = socAliasCount(job.title);
            const socShareNote = aliasN > 1
                ? `1/${aliasN} of shared SOC`
                : null;

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
                socShareNote,
            }];
        });

        // Selected / hovered first, then employment descending — layoutLabels
        // walks this order so the roles that matter most keep their labels when
        // the band is crowded.
        items.sort((a, b) => {
            const aPri = Number(a.isHovered || a.isSelected);
            const bPri = Number(b.isHovered || b.isSelected);
            if (aPri !== bPri) return bPri - aPri;
            return b.job.employment - a.job.employment;
        });
        return items;
    }, [
        mapView, filteredJobs, staggeredPeaks, selectedJob, isGlobalSelectionActive,
        isOrbiting, hoveredJobId, isMobile, riskScale, peaks, forecastsFlat, year,
    ]);

    // Publish the ordered tip list for useFrame after commit — never during render.
    useLayoutEffect(() => {
        labelMeta.current = markerItems.map((m) => ({
            id: m.job.id,
            worldY: m.labelHeight,
        }));
    }, [markerItems]);

    if (mapView !== 'globe') return null;

    return (
        <group>
            {markerItems.map(({
                job, peak, surfaceY, isSelected, isHovered, showLabelText, pipColor, labelHeight,
                growthStr, growthColor, growthLabel, workersStr, workersLabel,
            }) => (
                    <group
                        key={job.id}
                        ref={(g) => {
                            if (g) groupById.current.set(job.id, g);
                            else groupById.current.delete(job.id);
                        }}
                        position={[peak.x, surfaceY, peak.z]}
                    >
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

                        {/* Leader line — always BASE_HEIGHT (stagger off). The
                            tip is the label's anchor; layoutLabels refuses any
                            placement that would leave this tip outside the box,
                            so the line never runs off-screen while the label
                            stays pinned in view. Hidden when declutter parks
                            the label off-screen so orphan lines do not linger. */}
                        <DeclutterAwareLeaderLine
                            jobId={job.id}
                            labelHeight={labelHeight}
                            placements={placements}
                        />

                        {/* Label — drei rewrites host z-index from camera distance. On hover we
                            force this host to the front AND pin every other host to the back
                            (previously --front stuck forever when wrapperClass went undefined,
                            so many labels shared max z and later DOM siblings covered the popup).
                            Placement is owned by the shared useFrame declutter pass; this
                            callback only reads the result (with a first-frame fallback that
                            parks the label until the pass has run). */}
                        {showLabelText && (
                        <Html
                            position={[0, labelHeight, 0]}
                            center
                            calculatePosition={() => {
                                return placements.current.get(job.id) ?? HIDDEN_LABEL_POSITION;
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
                                className={`flex flex-col max-w-[min(13rem,calc(100vw-2rem))] overflow-hidden rounded border shadow-sm select-none transition-all duration-200 ${isSelected || isHovered ? 'bg-[#0F172A]/95 scale-105 ring-1 ring-white/25 border-slate-300/40 shadow-xl shadow-black/50' : 'bg-[#0F172A]/90 border-slate-600/40'} ${isHovered ? 'border-cyan-400/60' : ''}`}
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
                                        {socShareNote && (
                                            <div className="text-[8px] text-slate-500 leading-none" title="National OES headcount for this SOC is split equally across alias titles on the 3D map">
                                                {socShareNote}
                                            </div>
                                        )}
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
