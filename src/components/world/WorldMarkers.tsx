import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { Html } from '@react-three/drei';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SCENE, YEAR_MIN, YEAR_MAX } from '../../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../../config/continents';
import { INDEX_CONTINENT_BY_CODE } from '../../utils/occupationIndex';
import { regionAt } from '../../utils/worldLayout';
import { formatGrowth, formatWorkersShort, growthColor } from '../../utils/roleFormat';
import { socPartnerTitles } from '../../utils/onet';
import { HIDDEN_LABEL_POSITION, isHiddenLabelPosition, layoutLabelsByWeight, type LabelCandidate } from '../../utils/labelLayout';
import { displayedPeakHeight, fieldMaxEmploymentAt, GROUND_Y, peakEmploymentAt, type ScenePeak, type WorldScene } from './worldScene';
import { worldPointer } from './worldPointer';
import { useLabelSafeBand } from './labelBand';
import { useWorldView } from './worldCamera';

/** Labelled peaks in a zoomed region: the largest by EP 2025 employment. */
export const REGION_LABEL_CAP = { mobile: 12, desktop: 25 } as const;
const PEAK_HIT_RADIUS_PX = 28;
const REGION_LABEL_Y = 0.6;

type MarkerItem =
    | { kind: 'region'; id: string; code: string; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'peak'; id: string; peak: ScenePeak; x: number; z: number; tipY: number; baseY: number };

const projected = new Vector3();
const ndc = new Vector2();
const raycaster = new Raycaster();
const groundPlane = new Plane(new Vector3(0, 1, 0), -GROUND_Y);
const groundHit = new Vector3();

/**
 * Every label on the flat map and all of its pointer input. Mounted for the
 * zoomed field view; the globe has its own (GlobeMarkers).
 *
 * World view: the 22 region labels (short names; the full BLS title is in the
 * hover card). Zoomed into a region: labels for its largest occupations only,
 * capped at REGION_LABEL_CAP; any other peak gets its label on hover, or on a
 * first tap on touch screens. With the Kelley filter on, the labels are the 50
 * Kelley roles, as the map has always shown them.
 *
 * As in the old JobMarkers, labels are pointer-events:none and the canvas owns
 * every gesture, so orbiting never fights a label. Taps and hovers are hit-
 * tested here against the same placements the declutter pass wrote.
 */
export const WorldMarkers: React.FC<{ scene: WorldScene }> = ({ scene }) => {
    const year = useStore((s) => s.year);
    const mapView = useStore((s) => s.mapView);
    const isOrbiting = useStore((s) => s.isOrbiting);
    const focused = useWorldStore((s) => s.focusedContinent);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    // On the way back up to the globe there is no field left to label.
    const leaving = useWorldView((s) => s.moving) && !focused;
    const isMobile = useIsMobile();

    // Hover and tap belong to the view they happened in: zooming, leaving a
    // region or toggling the Kelley filter drops them, and orbiting hides the
    // hover card. Derived during render rather than reset from an effect.
    const viewKey = `${focused ?? ''}|${kelleyOnly}`;
    const viewKeyRef = useRef(viewKey);
    const [hover, setHover] = useState<{ id: string; view: string } | null>(null);
    const [tap, setTap] = useState<{ key: string; view: string } | null>(null);
    const hoveredId = !isOrbiting && hover?.view === viewKey ? hover.id : null;
    const tappedKey = tap?.view === viewKey ? tap.key : null;
    const setHoveredId = (id: string | null) =>
        setHover((prev) => (prev?.id === id && prev?.view === viewKeyRef.current ? prev : id ? { id, view: viewKeyRef.current } : null));
    const setTappedKey = (key: string | null) => setTap(key ? { key, view: viewKeyRef.current } : null);

    const gl = useThree((s) => s.gl);
    const getThree = useThree((s) => s.get);

    const labelHalfSize = useRef<Map<string, { x: number; y: number }>>(new Map());
    const safeBand = useLabelSafeBand(viewKey);
    const placements = useRef<Map<string, [number, number]>>(new Map());
    const labelOffsets = useRef<Map<string, [number, number]>>(new Map());
    const candidates = useRef<LabelCandidate[]>([]);
    const itemsRef = useRef<MarkerItem[]>([]);
    // Screen-space peak tips for every tappable peak, labelled or not.
    const peakAnchors = useRef<Map<string, { x: number; y: number }>>(new Map());
    const tappablePeaksRef = useRef<ScenePeak[]>([]);
    // Read by the canvas listeners, which must not rebind mid-gesture.
    const tappedKeyRef = useRef<string | null>(null);
    const labelledKeysRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        const clear = () => {
            setHoveredId(null);
            worldPointer.hoverRegion = null;
            worldPointer.hoverPeakContinent = null;
            worldPointer.hoverPeakIndex = -1;
        };
        window.addEventListener('blur', clear);
        document.addEventListener('visibilitychange', clear);
        return () => {
            window.removeEventListener('blur', clear);
            document.removeEventListener('visibilitychange', clear);
            // Leaving for the globe: nothing on the flat map is hovered any more.
            clear();
        };
    }, []);

    // Peaks that can be hovered or tapped right now.
    const tappablePeaks = useMemo<ScenePeak[]>(() => {
        if (focused) return scene.peaksByContinent.get(focused) ?? [];
        if (kelleyOnly) return scene.peaks.filter((p) => p.entry.kind === 'kelley');
        return [];
    }, [scene, focused, kelleyOnly]);

    // Which peaks carry a label without being hovered.
    const labelledPeakKeys = useMemo<Set<string>>(() => {
        if (focused) {
            const inRegion = scene.peaksByContinent.get(focused) ?? [];
            if (kelleyOnly) return new Set(inRegion.filter((p) => p.entry.kind === 'kelley').map((p) => p.entry.key));
            const cap = isMobile ? REGION_LABEL_CAP.mobile : REGION_LABEL_CAP.desktop;
            return new Set(
                [...inRegion]
                    .sort((a, b) => (b.entry.ep2025 ?? 0) - (a.entry.ep2025 ?? 0))
                    .slice(0, cap)
                    .map((p) => p.entry.key),
            );
        }
        if (kelleyOnly) return new Set(tappablePeaks.map((p) => p.entry.key));
        return new Set();
    }, [scene, focused, kelleyOnly, isMobile, tappablePeaks]);

    const showRegionLabels = !focused && !kelleyOnly;

    const items = useMemo<MarkerItem[]>(() => {
        if (mapView !== 'globe') return [];
        const out: MarkerItem[] = [];
        const extra = new Set<string>();
        if (hoveredId && !hoveredId.startsWith('region:')) extra.add(hoveredId);
        if (tappedKey) extra.add(tappedKey);
        const fieldMax = focused ? fieldMaxEmploymentAt(scene.peaksByContinent.get(focused) ?? [], year) : 0;
        for (const p of tappablePeaks) {
            const key = p.entry.key;
            if (!labelledPeakKeys.has(key) && !extra.has(key)) continue;
            const top = GROUND_Y + displayedPeakHeight(p, year, focused, fieldMax);
            out.push({ kind: 'peak', id: key, peak: p, x: p.x, z: p.z, baseY: top, tipY: top + SCENE.LABEL.BASE_HEIGHT });
        }
        if (showRegionLabels) {
            for (const r of scene.layout.regions) {
                out.push({ kind: 'region', id: `region:${r.code}`, code: r.code, x: r.cx, z: r.cz, baseY: GROUND_Y, tipY: GROUND_Y + REGION_LABEL_Y });
            }
        }
        // Hovered / tapped first, then size: earlier items win collisions.
        const size = (m: MarkerItem) => (m.kind === 'peak' ? m.peak.entry.ep2025 ?? 0 : INDEX_CONTINENT_BY_CODE.get(m.code)?.ep.employment2025 ?? 0);
        const pri = (m: MarkerItem) => Number(m.id === hoveredId || m.id === tappedKey);
        out.sort((a, b) => pri(b) - pri(a) || size(b) - size(a));
        return out;
    }, [mapView, tappablePeaks, labelledPeakKeys, hoveredId, tappedKey, showRegionLabels, scene, year, focused]);

    const regionWeights = useRef<Map<string, number>>(new Map());

    useLayoutEffect(() => {
        regionWeights.current = new Map(
            items
                .filter((m) => m.kind === 'region' && m.id !== hoveredId)
                .map((m) => [m.id, INDEX_CONTINENT_BY_CODE.get((m as { code: string }).code)?.ep.employment2025 ?? 0]),
        );
        viewKeyRef.current = viewKey;
        itemsRef.current = items;
        tappablePeaksRef.current = tappablePeaks;
        tappedKeyRef.current = tappedKey;
        labelledKeysRef.current = labelledPeakKeys;
    }, [items, tappablePeaks, tappedKey, labelledPeakKeys, viewKey, hoveredId]);

    // Canvas-level input: hover, tap and click.
    useEffect(() => {
        const el = gl.domElement;
        let downX = 0;
        let downY = 0;
        let downT = 0;

        const local = (clientX: number, clientY: number) => {
            const rect = el.getBoundingClientRect();
            return { x: clientX - rect.left, y: clientY - rect.top, w: rect.width, h: rect.height };
        };

        const hitLabel = (x: number, y: number): MarkerItem | null => {
            for (const item of itemsRef.current) {
                const pos = placements.current.get(item.id);
                const half = labelHalfSize.current.get(item.id);
                if (!pos || isHiddenLabelPosition(pos) || !half) continue;
                if (Math.abs(x - pos[0]) <= half.x && Math.abs(y - pos[1]) <= half.y) return item;
            }
            return null;
        };

        const hitPeak = (x: number, y: number): ScenePeak | null => {
            let best: ScenePeak | null = null;
            let bestDist = PEAK_HIT_RADIUS_PX;
            for (const p of tappablePeaksRef.current) {
                const a = peakAnchors.current.get(p.entry.key);
                if (!a) continue;
                const d = Math.hypot(x - a.x, y - a.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = p;
                }
            }
            return best;
        };

        const hitGround = (x: number, y: number, w: number, h: number): { x: number; z: number } | null => {
            ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
            raycaster.setFromCamera(ndc, getThree().camera);
            return raycaster.ray.intersectPlane(groundPlane, groundHit) ? { x: groundHit.x, z: groundHit.z } : null;
        };

        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            downX = e.clientX;
            downY = e.clientY;
            downT = performance.now();
        };

        const onUp = (e: PointerEvent) => {
            if (e.button !== 0) return;
            if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 10 || performance.now() - downT >= 500) return;
            const { x, y, w, h } = local(e.clientX, e.clientY);
            const world = useWorldStore.getState();
            const touch = e.pointerType === 'touch';

            const label = hitLabel(x, y);
            if (label?.kind === 'region') {
                world.focusContinent(label.code);
                return;
            }
            if (label?.kind === 'peak') {
                world.openRole(label.peak.entry);
                return;
            }
            const peak = hitPeak(x, y);
            if (peak) {
                // Touch has no hover: the first tap shows the label, the next opens the role.
                if (touch && tappedKeyRef.current !== peak.entry.key && !labelledKeysRef.current.has(peak.entry.key)) {
                    setTappedKey(peak.entry.key);
                }
                else world.openRole(peak.entry);
                return;
            }
            setTappedKey(null);
            const g = hitGround(x, y, w, h);
            const region = g ? regionAt(scene.layout.regions, g.x, g.z) : null;
            if (region && region.code !== world.focusedContinent) world.focusContinent(region.code);
        };

        const onMove = (e: PointerEvent) => {
            const { x, y, w, h } = local(e.clientX, e.clientY);
            const g = hitGround(x, y, w, h);
            worldPointer.mouseX = g?.x ?? 1e6;
            worldPointer.mouseZ = g?.z ?? 1e6;
            if (e.pointerType === 'touch' || useStore.getState().isOrbiting) {
                el.style.cursor = '';
                return;
            }
            const label = hitLabel(x, y);
            const peak = label ? null : hitPeak(x, y);
            const hoverPeak = label?.kind === 'peak' ? label.peak : peak;
            const focusedNow = useWorldStore.getState().focusedContinent;
            const region = !hoverPeak
                ? label?.kind === 'region'
                    ? label.code
                    : (g ? regionAt(scene.layout.regions, g.x, g.z)?.code ?? null : null)
                : null;
            const id = hoverPeak ? hoverPeak.entry.key : region && !focusedNow ? `region:${region}` : null;
            setHoveredId(id);
            worldPointer.hoverPeakContinent = hoverPeak ? hoverPeak.entry.continent : null;
            worldPointer.hoverPeakIndex = hoverPeak ? hoverPeak.index : -1;
            worldPointer.hoverRegion = region && region !== focusedNow ? region : null;
            el.style.cursor = hoverPeak || (region && region !== focusedNow) ? 'pointer' : '';
        };

        const onLeave = () => {
            setHoveredId(null);
            worldPointer.hoverRegion = null;
            worldPointer.hoverPeakContinent = null;
            worldPointer.hoverPeakIndex = -1;
            worldPointer.mouseX = 1e6;
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
    }, [gl, getThree, scene]);

    // Leader lines for every peak label in one draw call.
    const leaderGeometry = useMemo(() => {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, items.length) * 6), 3));
        return g;
    }, [items.length]);
    useEffect(() => () => leaderGeometry.dispose(), [leaderGeometry]);

    // One declutter pass per frame, plus the screen-space tips used for hover/tap.
    useFrame((state) => {
        const { camera, size } = state;
        const list = candidates.current;
        list.length = 0;
        const yearNow = useStore.getState().year;
        const focusNow = useWorldStore.getState().focusedContinent;
        const fieldMaxNow = focusNow ? fieldMaxEmploymentAt(scene.peaksByContinent.get(focusNow) ?? [], yearNow) : 0;
        for (const p of tappablePeaksRef.current) {
            projected.set(p.x, GROUND_Y + displayedPeakHeight(p, yearNow, focusNow, fieldMaxNow), p.z).project(camera);
            if (projected.z < -1 || projected.z > 1) {
                peakAnchors.current.delete(p.entry.key);
                continue;
            }
            peakAnchors.current.set(p.entry.key, {
                x: (projected.x * size.width) / 2 + size.width / 2,
                y: -((projected.y * size.height) / 2) + size.height / 2,
            });
        }
        for (const item of itemsRef.current) {
            projected.set(item.x, item.tipY, item.z).project(camera);
            const half = labelHalfSize.current.get(item.id) ?? { x: 40, y: 10 };
            list.push({
                id: item.id,
                anchorX: (projected.x * size.width) / 2 + size.width / 2,
                anchorY: -((projected.y * size.height) / 2) + size.height / 2,
                halfWidth: half.x,
                halfHeight: half.y,
                inFront: projected.z >= -1 && projected.z <= 1,
                // A region name has no leader line, so it may sit a little further off its centre.
                slack: item.kind === 'region' ? 2 : 1,
            });
        }
        // Region labels compete by size: when two collide, the field with fewer
        // workers (EP 2025) is the one hidden. Hovered/tapped labels never yield.
        layoutLabelsByWeight(list, regionWeights.current, size.width, size.height, safeBand.current, placements.current, labelOffsets.current, 2, 4);

        const pos = leaderGeometry.getAttribute('position') as BufferAttribute;
        const arr = pos.array as Float32Array;
        let n = 0;
        for (const item of itemsRef.current) {
            if (item.kind !== 'peak') continue;
            const placed = placements.current.get(item.id);
            if (!placed || isHiddenLabelPosition(placed)) continue;
            arr.set([item.x, item.baseY, item.z, item.x, item.tipY, item.z], n * 6);
            n++;
        }
        leaderGeometry.setDrawRange(0, n * 2);
        pos.needsUpdate = true;
    });

    if (mapView !== 'globe' || leaving) return null;

    const anyHover = !!hoveredId;
    return (
        <group>
            <lineSegments geometry={leaderGeometry} frustumCulled={false}>
                <lineBasicMaterial color="#ffffff" transparent opacity={0.55} />
            </lineSegments>
            {items.map((item) => {
                const isHovered = item.id === hoveredId || item.id === tappedKey;
                return (
                    <Html
                        key={item.id}
                        position={[item.x, item.tipY, item.z]}
                        center
                        calculatePosition={() => placements.current.get(item.id) ?? HIDDEN_LABEL_POSITION}
                        wrapperClass={
                            isHovered ? 'foj-job-label foj-job-label--front' : anyHover ? 'foj-job-label foj-job-label--recessed' : 'foj-job-label'
                        }
                        zIndexRange={isHovered ? [16777271, 16777000] : [100, 0]}
                    >
                        <div
                            ref={(el) => {
                                if (el) labelHalfSize.current.set(item.id, { x: el.offsetWidth / 2, y: el.offsetHeight / 2 });
                            }}
                        >
                            {item.kind === 'region' ? (
                                <RegionLabel code={item.code} expanded={isHovered} />
                            ) : (
                                <PeakLabel peak={item.peak} expanded={isHovered} year={year} />
                            )}
                        </div>
                    </Html>
                );
            })}
        </group>
    );
};

export const RegionLabel: React.FC<{ code: string; expanded: boolean; hint?: string }> = ({ code, expanded, hint = 'click to explore' }) => {
    const c = INDEX_CONTINENT_BY_CODE.get(code)!;
    return (
        <div
            className={`flex flex-col w-max max-w-[min(15rem,calc(100vw-2rem))] rounded-md border select-none transition-all duration-200 ${
                expanded
                    ? 'bg-[#0F172A]/95 border-cyan-400/50 shadow-xl shadow-black/50'
                    // Phones: a compact two-line chip so all 22 names fit at 390px.
                    : 'bg-[#0F172A]/80 border-cyan-300/25 max-md:max-w-[3.9rem] max-md:rounded'
            }`}
        >
            <span className="px-2 py-1 max-md:px-1 max-md:py-px text-[11px] max-md:text-[8px] max-md:leading-[1.1] font-semibold tracking-wide max-md:tracking-normal text-cyan-50 whitespace-nowrap max-md:whitespace-normal max-md:text-center">
                {CONTINENT_DISPLAY_NAMES[code]}
            </span>
            {expanded && (
                <div className="px-2 pb-1.5 border-t border-slate-700/40 pt-1 space-y-0.5">
                    <p className="text-[9px] text-slate-400 leading-snug">{c.title}</p>
                    <p className="text-[10px] text-slate-200 font-mono">{formatWorkersShort(c.ep.employment2025)} workers in {YEAR_MIN}</p>
                    <p className="text-[10px] font-mono" style={{ color: growthColor(c.ep.percentChange) }}>
                        {formatGrowth(c.ep.percentChange)} by {YEAR_MAX}
                    </p>
                    <p className="text-[9px] text-slate-500">{c.occupationCount} occupations · {hint}</p>
                </div>
            )}
        </div>
    );
};

export const PeakLabel: React.FC<{ peak: ScenePeak; expanded: boolean; year: number }> = ({ peak, expanded, year }) => {
    const { entry } = peak;
    const partners = entry.kind === 'kelley' ? socPartnerTitles(entry.title) : [];
    return (
        <div
            className={`flex flex-col max-w-[min(13rem,calc(100vw-2rem))] overflow-hidden rounded border shadow-sm select-none transition-all duration-200 ${
                expanded ? 'bg-[#0F172A]/95 scale-105 ring-1 ring-white/25 border-cyan-400/60 shadow-xl shadow-black/50' : 'bg-[#0F172A]/90 border-slate-600/40'
            }`}
        >
            <div className="flex items-center gap-1.5 px-1.5 py-0.5 max-md:gap-1 max-md:px-1 min-w-0">
                <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 ring-1 ring-black/30"
                    style={{ backgroundColor: peak.pipColor, boxShadow: entry.scored ? `0 0 4px ${peak.pipColor}` : undefined }}
                />
                <span className="text-white text-[10px] max-md:text-[9px] font-medium leading-tight tracking-wide font-sans truncate min-w-0" title={entry.title}>
                    {entry.title}
                </span>
            </div>
            {expanded && (
                <div className="px-2 pb-1 pt-0 border-t border-slate-700/40 flex flex-col gap-y-0.5 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-[8px] text-slate-500 uppercase tracking-wider leading-none whitespace-nowrap">{Math.round(year)} Jobs</span>
                        <span className="text-[10px] text-slate-200 font-mono font-medium leading-none whitespace-nowrap">
                            {formatWorkersShort(peakEmploymentAt(entry, year))}
                        </span>
                    </div>
                    {partners.length > 0 && (
                        <div className="text-[8px] text-slate-500 leading-none" title="BLS employment for this code is split equally across the titles that share it on the 3D map">
                            Split w/{partners.join(', ')}
                        </div>
                    )}
                    {entry.epPercentChange != null && (
                        <div className="flex items-baseline justify-between gap-2 min-w-0">
                            <span className="text-[8px] text-slate-500 uppercase tracking-wider leading-none whitespace-nowrap">{YEAR_MIN}–{String(YEAR_MAX).slice(2)} Growth</span>
                            <span className="text-[10px] font-mono font-medium leading-none whitespace-nowrap" style={{ color: growthColor(entry.epPercentChange) }}>
                                {formatGrowth(entry.epPercentChange)}
                            </span>
                        </div>
                    )}
                    {!entry.scored && <div className="text-[8px] text-slate-500 leading-none">AI scores coming soon</div>}
                </div>
            )}
        </div>
    );
};
