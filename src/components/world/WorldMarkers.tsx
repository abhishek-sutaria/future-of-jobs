import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { Html } from '@react-three/drei';
import { useStore } from '../../store';
import { highlightKey, highlightOn, isHighlighted } from '../../utils/iuSchools';
import { useWorldStore } from '../../worldStore';
import { YEAR_MIN, YEAR_MAX } from '../../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../../config/continents';
import { INDEX_CONTINENT_BY_CODE } from '../../utils/occupationIndex';
import { familyOf } from '../../config/socFamilies';
import { regionAt } from '../../utils/worldLayout';
import { clickAction, isOnStage, levelKind, type StageHit, type WorldLevel } from '../../utils/worldLevel';
import { rayToSurface } from '../../utils/stageBake';
import { stageKey, type Stage } from '../../utils/stageLayout';
import { formatGrowth, formatWorkersShort, growthColor } from '../../utils/roleFormat';
import { socPartnerTitles } from '../../utils/onet';
import { HIDDEN_LABEL_POSITION, isHiddenLabelPosition, layoutLabelsByWeight, type LabelBand, type LabelCandidate } from '../../utils/labelLayout';
import type { FamilyLayout, MinorGroupLayout } from '../../utils/worldLayout';
import { GROUND_Y, peakEmploymentAt, peakHeightAt, type ScenePeak, type WorldScene } from './worldScene';
import { LABEL_FADE_MS, type LabelDecision } from '../../utils/labelLevel';
import { buildLabelCandidates, familyMarker, groupMarker, labelWeights, markerOnStage, peakMarker, regionMarker, sortMarkers, stageMarkerHeights, stagePeakMarker, type GroundMap, type MarkerItem } from './labelCandidates';
import { prefersReducedMotion } from './worldCamera';
import { worldPointer } from './worldPointer';
import { displayToWorld, layerOf, stageSurfaceAt, toDisplayX, toDisplayZ, worldView } from './worldView';
import { WORLD_LAYER } from '../../utils/stageTransition';
import { UNSCORED_LABEL } from '../../utils/blsScores';

/** Labels follow the view's map from the world's ground to the screen's. */
const toScreenGround: GroundMap = (x, z) => ({ x: toDisplayX(x), z: toDisplayZ(z) });

/**
 * Job labels offered to the declutter in an open field: the largest by EP 2025
 * employment, up to the 50 the live view offers, on every device. The declutter
 * then decides what fits, as it does there. Pins mark every job; any other label
 * comes on hover.
 */
export const STAGE_LABEL_CAP = 50;
const PEAK_HIT_RADIUS_PX = 28;
/** A family name's tap target reaches at least this far above and below its centre (44px in all). */
const FAMILY_HIT_HALF_HEIGHT_PX = 22;

const projected = new Vector3();
const ndc = new Vector2();
const raycaster = new Raycaster();
const groundPlane = new Plane(new Vector3(0, 1, 0), -GROUND_Y);
const groundHit = new Vector3();

/**
 * Every label on the world and all of its pointer input.
 *
 * Which set shows depends on the level, and at the world on the zoom (labelsAt,
 * utils/labelLevel). World, broad: the five BLS job families only, as buttons
 * that open the family. World, zoomed in: the 22 field names (short names; the
 * full BLS title is in the hover card). A family: its field names on their
 * tiles and nothing else, with or without the Kelley filter, so a click can only
 * mean a field. A field: labels for its largest
 * occupations, capped at STAGE_LABEL_CAP, in the live view's style; any other
 * job gets its label on hover, or on a first tap on touch screens; and its
 * minor groups' names, faintly, wherever the job labels leave room. With the
 * Kelley filter on, the job labels are the Kelley roles on stage, as the map has
 * always shown them.
 *
 * Every label keeps its world map position at every level and is drawn through
 * the view's map, so it rides along with its job or tile through a flight. A
 * stage's labels stand on its baked surface and belong to the stage that is
 * fully drawn, which trails the level by the moment a flight takes to hand over.
 * Nothing off stage is ever labelled, hovered or hit: the rules for what a click
 * does are in clickAction (utils/worldLevel).
 *
 * As in the old JobMarkers, labels are pointer-events:none and the canvas owns
 * every gesture, so orbiting never fights a label. Taps and hovers are hit-
 * tested here against the same placements the declutter pass wrote. That holds
 * for the family buttons too: pointers reach them through the canvas (so a
 * pinch or scroll that lands on one still zooms), keyboards and screen readers
 * through the button itself.
 */
/**
 * The labels on screen, following the ones the zoom calls for: `fading` while
 * the old set fades out, then the new set mounts (and fades in by itself).
 */
function useLabelCrossfade<T>(target: T): { shown: T; fading: boolean } {
    const [shown, setShown] = useState(target);
    useEffect(() => {
        if (shown === target) return;
        const t = setTimeout(() => setShown(target), prefersReducedMotion() ? 0 : LABEL_FADE_MS);
        return () => clearTimeout(t);
    }, [shown, target]);
    return { shown, fading: shown !== target };
}

export const WorldMarkers: React.FC<{ scene: WorldScene }> = ({ scene }) => {
    const year = useStore((s) => s.year);
    const mapView = useStore((s) => s.mapView);
    const isOrbiting = useStore((s) => s.isOrbiting);
    const focusedContinent = useWorldStore((s) => s.focusedContinent);
    const focusedFamily = useWorldStore((s) => s.focusedFamily);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const school = useWorldStore((s) => s.school);
    const highlight = useMemo(() => ({ kelleyOnly, school }), [kelleyOnly, school]);
    const filterOn = highlightOn(highlight);
    const labels = useWorldStore((s) => s.labels);
    const drawnStage = useWorldStore((s) => s.drawnStage);
    // The level the labels on screen belong to: it changes with them, so the
    // old set fades out whole rather than losing its off-stage names at once.
    const target = useMemo<{ labels: LabelDecision; drawnStage: Stage | null } & WorldLevel>(
        () => ({ labels, drawnStage, focusedFamily, focusedContinent }),
        [labels, drawnStage, focusedFamily, focusedContinent],
    );
    const { shown, fading } = useLabelCrossfade(target);
    const focused = shown.focusedContinent;
    const family = shown.focusedFamily;
    // The level's stage once it is on the mesh. Until then, nothing to label.
    const stage = shown.drawnStage?.key === stageKey(shown) ? shown.drawnStage : null;

    // Hover and tap belong to the view they happened in: zooming, changing
    // level or changing the Kelley or school filter drops them, and orbiting
    // hides the hover card. Derived during render rather than reset from an effect.
    const viewKey = `${focused ?? ''}|${family ?? ''}|${highlightKey(highlight)}|${shown.labels.level}`;
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
    const safeBand = useRef<LabelBand>({ top: 4, bottom: 4 });
    const placements = useRef<Map<string, [number, number]>>(new Map());
    const labelOffsets = useRef<Map<string, [number, number]>>(new Map());
    const candidates = useRef<LabelCandidate[]>([]);
    // World height each peak's leader line ends at this frame (lowered under tall chrome).
    const tipHeights = useRef<Map<string, number>>(new Map());
    const itemsRef = useRef<MarkerItem[]>([]);
    const stageRef = useRef<Stage | null>(null);
    // Screen-space peak tips for every tappable peak, labelled or not.
    const peakAnchors = useRef<Map<string, { x: number; y: number }>>(new Map());
    const tappablePeaksRef = useRef<ScenePeak[]>([]);
    // Read by the canvas listeners, which must not rebind mid-gesture.
    const tappedKeyRef = useRef<string | null>(null);
    const labelledKeysRef = useRef<Set<string>>(new Set());
    const familyNodes = useRef<Map<string, HTMLElement>>(new Map());

    // The family buttons are about to go: a keyboard user on one carries on
    // from Back, or the field picker if it stayed at the world, not from the
    // top of the page. Back mounts in another React root, so give it a frame.
    useEffect(() => {
        if (labels.families) return;
        if (!document.activeElement?.closest('[data-family-label]')) return;
        const raf = requestAnimationFrame(() => {
            (document.querySelector<HTMLElement>('[data-world-back]') ?? document.querySelector<HTMLElement>('[data-field-picker]'))?.focus();
        });
        return () => cancelAnimationFrame(raf);
    }, [labels.families]);

    useEffect(() => {
        const measure = () => {
            const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
            const header = box('header');
            const search = box('[data-tour="tour-search"]');
            const bar = box('[data-world-bar]');
            const slider = box('[data-tour="tour-slider"]');
            // The header and search run the width of the screen; the fields
            // bar (picker and trail, info line under them) only covers its left side.
            const top = Math.max(header?.bottom ?? 0, search?.bottom ?? 0, 4);
            const bottom = slider ? Math.max(window.innerHeight - slider.top, 4) : 4;
            const blocks = bar && bar.bottom > top ? [{ left: bar.left - 6, right: bar.right + 6, bottom: bar.bottom + 6 }] : [];
            safeBand.current = { top: top + 6, bottom: bottom + 6, blocks };
        };
        measure();
        // The chrome mounts after the canvas and re-wraps as buttons come and
        // go, so watch it rather than only the window.
        const t = setTimeout(measure, 1200);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        for (const sel of ['header', '[data-world-bar]', '[data-tour="tour-slider"]']) {
            const el = document.querySelector(sel);
            if (el && observer) observer.observe(el);
        }
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            clearTimeout(t);
            observer?.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, [focused, family, kelleyOnly, school]);

    // Nothing stays lit from the level before.
    useEffect(() => {
        worldPointer.hoverRegion = null;
        worldPointer.hoverFamily = null;
        worldPointer.hoverPeakContinent = null;
        worldPointer.hoverPeakIndex = -1;
    }, [focusedFamily, focusedContinent]);

    useEffect(() => {
        const clear = () => {
            setHoveredId(null);
            worldPointer.hoverRegion = null;
            worldPointer.hoverFamily = null;
            worldPointer.hoverPeakContinent = null;
            worldPointer.hoverPeakIndex = -1;
        };
        window.addEventListener('blur', clear);
        document.addEventListener('visibilitychange', clear);
        return () => {
            window.removeEventListener('blur', clear);
            document.removeEventListener('visibilitychange', clear);
        };
    }, []);

    // Peaks that can be hovered or tapped right now. A family has none: it offers
    // its fields, and job roles only appear once one is open. A school shows
    // only its jobs, so the rest of a field cannot be opened while one is picked.
    const tappablePeaks = useMemo<ScenePeak[]>(() => {
        if (stage) {
            if (stage.kind !== 'field') return [];
            const peaks = stage.jobs.map((j) => scene.peakByKey.get(j.key)!);
            return school ? peaks.filter((p) => isHighlighted(highlight, p.entry)) : peaks;
        }
        if (levelKind(shown) === 'world' && shown.labels.jobs && filterOn) return scene.peaks.filter((p) => isHighlighted(highlight, p.entry));
        return [];
    }, [scene, stage, shown, highlight, school, filterOn]);

    // Which peaks carry a label without being hovered: the largest jobs, or with
    // a filter on, the jobs it keeps (a school's largest first, as many as fit).
    const labelledPeakKeys = useMemo<Set<string>>(() => {
        const largest = (peaks: ScenePeak[]) => new Set(
            [...peaks]
                .sort((a, b) => (b.entry.ep2025 ?? 0) - (a.entry.ep2025 ?? 0))
                .slice(0, STAGE_LABEL_CAP)
                .map((p) => p.entry.key),
        );
        if (stage?.kind === 'field' && !filterOn) return largest(tappablePeaks);
        if (school) return largest(tappablePeaks.filter((p) => isHighlighted(highlight, p.entry)));
        if (kelleyOnly) return new Set(tappablePeaks.filter((p) => p.entry.kind === 'kelley').map((p) => p.entry.key));
        return new Set();
    }, [stage, kelleyOnly, school, highlight, filterOn, tappablePeaks]);

    const items = useMemo<MarkerItem[]>(() => {
        if (mapView !== 'globe') return [];
        const out: MarkerItem[] = [];
        const extra = new Set<string>();
        if (hoveredId && !hoveredId.startsWith('region:')) extra.add(hoveredId);
        if (tappedKey) extra.add(tappedKey);
        for (const p of tappablePeaks) {
            const key = p.entry.key;
            if (!labelledPeakKeys.has(key) && !extra.has(key)) continue;
            out.push(stage ? stagePeakMarker(p) : peakMarker(p, year));
        }
        if (stage) {
            // A family's field names on their tiles; a field's minor groups, which take what room is left.
            if (stage.kind === 'family') {
                for (const tile of stage.tiles) {
                    const r = scene.layout.regionByCode.get(tile.code)!;
                    out.push(regionMarker(r.code, r.cx, r.cz));
                }
            }
            else for (const g of scene.layout.minorGroupsByContinent.get(stage.jobs[0]?.code ?? '') ?? []) out.push(groupMarker(g));
        }
        // The world's own labels wait until the stage has fully gone.
        else if (levelKind(shown) === 'world' && !shown.drawnStage) {
            if (shown.labels.fields) for (const r of scene.layout.regions) out.push(regionMarker(r.code, r.cx, r.cz));
            if (shown.labels.families) for (const f of scene.layout.families) out.push(familyMarker(f));
        }
        // Earlier items win collisions.
        return sortMarkers(out, (m) => m.id === hoveredId || m.id === tappedKey, filterOn);
    }, [mapView, tappablePeaks, labelledPeakKeys, hoveredId, tappedKey, shown, stage, scene, year, filterOn]);

    const regionWeights = useRef<Map<string, number>>(new Map());

    useLayoutEffect(() => {
        regionWeights.current = labelWeights(items, hoveredId);
        viewKeyRef.current = viewKey;
        itemsRef.current = items;
        tappablePeaksRef.current = tappablePeaks;
        tappedKeyRef.current = tappedKey;
        labelledKeysRef.current = labelledPeakKeys;
        stageRef.current = stage;
    }, [items, tappablePeaks, tappedKey, labelledPeakKeys, viewKey, hoveredId, stage]);

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
            const level = useWorldStore.getState();
            for (const item of itemsRef.current) {
                // Minor-group names only name their block: a click goes through to the jobs.
                if (item.kind === 'group' || !markerOnStage(item, level)) continue;
                const pos = placements.current.get(item.id);
                const half = labelHalfSize.current.get(item.id);
                if (!pos || isHiddenLabelPosition(pos) || !half) continue;
                const halfY = item.kind === 'family' ? Math.max(half.y, FAMILY_HIT_HALF_HEIGHT_PX) : half.y;
                if (Math.abs(x - pos[0]) <= half.x && Math.abs(y - pos[1]) <= halfY) return item;
            }
            return null;
        };

        const hitPeak = (x: number, y: number): ScenePeak | null => {
            const level = useWorldStore.getState();
            let best: ScenePeak | null = null;
            let bestDist = PEAK_HIT_RADIUS_PX;
            for (const p of tappablePeaksRef.current) {
                if (!isOnStage(level, p.entry.continent)) continue;
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

        // Where the pointer meets the ground plane, on screen (for the cursor glow).
        const hitScreenGround = (x: number, y: number, w: number, h: number): { x: number; z: number } | null => {
            ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
            raycaster.setFromCamera(ndc, getThree().camera);
            return raycaster.ray.intersectPlane(groundPlane, groundHit) ? { x: groundHit.x, z: groundHit.z } : null;
        };
        // The same point on the world map's ground.
        const hitGround = (x: number, y: number, w: number, h: number): { x: number; z: number } | null => {
            const g = hitScreenGround(x, y, w, h);
            return g ? displayToWorld(g.x, g.z) : null;
        };

        // On a stage the point under the pointer is on the hills, not the plane
        // behind them: a tall hill stands well in front of its own foot. A
        // family's tiles are its world fields, magnified, so the field under the
        // point is the world region there.
        const hitStage = (x: number, y: number, w: number, h: number, stage: Stage): string | null => {
            const surface = worldView.surfaces.get(stage.key);
            if (!surface) return null;
            ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
            raycaster.setFromCamera(ndc, getThree().camera);
            const { origin, direction } = raycaster.ray;
            const hit = rayToSurface(
                [origin.x, origin.y, origin.z],
                [direction.x, direction.y, direction.z],
                GROUND_Y,
                (px, pz) => {
                    const p = displayToWorld(px, pz);
                    return stageSurfaceAt(surface, p.x, p.z);
                },
            );
            if (!hit) return null;
            const p = displayToWorld(hit.x, hit.z);
            const code = regionAt(scene.layout.regions, p.x, p.z)?.code ?? null;
            return code && stage.tiles.some((t) => t.code === code) ? code : null;
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
            const label = hitLabel(x, y);
            const peak = label ? null : hitPeak(x, y);
            const stage = stageRef.current;
            const g = label || peak || stage ? null : hitGround(x, y, w, h);
            const hit: StageHit = {
                label: label?.kind === 'family'
                    ? { kind: 'family', id: label.family.family.id }
                    : label?.kind === 'region'
                        ? { kind: 'field', code: label.code }
                        : label?.kind === 'peak'
                            ? { kind: 'peak', key: label.peak.entry.key, code: label.peak.entry.continent }
                            : null,
                peak: peak && { key: peak.entry.key, code: peak.entry.continent },
                ground: stage && !label && !peak ? hitStage(x, y, w, h, stage) : g ? regionAt(scene.layout.regions, g.x, g.z)?.code ?? null : null,
            };
            const action = clickAction(world, hit, {
                fieldNames: world.labels.fields,
                touch: e.pointerType === 'touch',
                tappedKey: tappedKeyRef.current,
                labelledKeys: labelledKeysRef.current,
            });
            if (action?.kind === 'reveal') {
                setTappedKey(action.key);
                return;
            }
            setTappedKey(null);
            if (action?.kind === 'family') world.focusFamily(action.id);
            if (action?.kind === 'field') world.focusContinent(action.code);
            if (action?.kind === 'role') world.openRole(scene.peakByKey.get(action.key)!.entry);
        };

        const onMove = (e: PointerEvent) => {
            const { x, y, w, h } = local(e.clientX, e.clientY);
            const screen = hitScreenGround(x, y, w, h);
            const g = screen ? displayToWorld(screen.x, screen.z) : null;
            worldPointer.mouseX = screen?.x ?? 1e6;
            worldPointer.mouseZ = screen?.z ?? 1e6;
            if (e.pointerType === 'touch' || useStore.getState().isOrbiting) {
                el.style.cursor = '';
                return;
            }
            const label = hitLabel(x, y);
            const peak = label ? null : hitPeak(x, y);
            const hoverPeak = label?.kind === 'peak' ? label.peak : peak;
            const world = useWorldStore.getState();
            const focusedNow = world.focusedContinent;
            const stage = stageRef.current;
            const under = stage ? hitStage(x, y, w, h, stage) : levelKind(world) === 'world' && g ? regionAt(scene.layout.regions, g.x, g.z)?.code ?? null : null;
            const onStage = under && isOnStage(world, under) ? under : null;
            // At the broad view a click opens the whole family, so the whole family lights.
            const hoverFamily = label?.kind === 'family'
                ? label.family.family.id
                : !label && !hoverPeak && world.labels.families && onStage
                    ? familyOf(onStage).id
                    : null;
            const region = !hoverPeak && hoverFamily == null
                ? label?.kind === 'region'
                    ? label.code
                    : onStage
                : null;
            const id = hoverFamily != null ? `family:${hoverFamily}` : hoverPeak ? hoverPeak.entry.key : region && !focusedNow ? `region:${region}` : null;
            setHoveredId(id);
            // The glow on a treemap peak has nothing to light on a stage.
            worldPointer.hoverPeakContinent = hoverPeak && !stage ? hoverPeak.entry.continent : null;
            worldPointer.hoverPeakIndex = hoverPeak && !stage ? hoverPeak.index : -1;
            worldPointer.hoverRegion = region && region !== focusedNow && !stage ? region : null;
            worldPointer.hoverFamily = label?.kind === 'family' ? null : hoverFamily;
            el.style.cursor = hoverFamily != null || hoverPeak || (region && region !== focusedNow) ? 'pointer' : '';
        };

        const onLeave = () => {
            setHoveredId(null);
            worldPointer.hoverRegion = null;
            worldPointer.hoverFamily = null;
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
        const stageNow = stageRef.current;
        const drawn = stageNow ? worldView.surfaces.get(stageNow.key) : undefined;
        // What a pin stands on right now, at a world point: the baked surface as far as the flight has grown it.
        const surface = (x: number, z: number) => (drawn ? stageSurfaceAt(drawn, x, z) : 0);
        const worldLift = layerOf(WORLD_LAYER).mult;
        if (stageNow) stageMarkerHeights(itemsRef.current, surface);
        for (const p of tappablePeaksRef.current) {
            const onStage = !!stageNow?.byKey.get(p.entry.key);
            const top = onStage ? surface(p.x, p.z) : peakHeightAt(p.entry, yearNow) * worldLift;
            projected.set(toDisplayX(p.x), GROUND_Y + top, toDisplayZ(p.z));
            projected.project(camera);
            if (projected.z < -1 || projected.z > 1) {
                peakAnchors.current.delete(p.entry.key);
                continue;
            }
            peakAnchors.current.set(p.entry.key, {
                x: (projected.x * size.width) / 2 + size.width / 2,
                y: -((projected.y * size.height) / 2) + size.height / 2,
            });
        }
        buildLabelCandidates(itemsRef.current, camera, size, safeBand.current, labelHalfSize.current, list, tipHeights.current, toScreenGround);
        // Region labels compete by size: when two collide, the field with fewer
        // workers (EP 2025) is the one hidden. Hovered/tapped labels never yield.
        // Job labels go through the live declutter, largest first.
        layoutLabelsByWeight(list, regionWeights.current, size.width, size.height, safeBand.current, placements.current, labelOffsets.current, 2, 4);

        // A family name panned off screen is parked, and must not take focus there.
        for (const [id, node] of familyNodes.current) {
            const pos = placements.current.get(id);
            node.style.visibility = !pos || isHiddenLabelPosition(pos) ? 'hidden' : '';
        }

        const pos = leaderGeometry.getAttribute('position') as BufferAttribute;
        const arr = pos.array as Float32Array;
        let n = 0;
        for (const item of itemsRef.current) {
            if (item.kind !== 'peak') continue;
            const placed = placements.current.get(item.id);
            if (!placed || isHiddenLabelPosition(placed)) continue;
            // A label lowered onto the peak itself has no stalk left to draw.
            const tip = tipHeights.current.get(item.id) ?? item.tipY;
            if (tip <= item.baseY) continue;
            const x = toDisplayX(item.x);
            const z = toDisplayZ(item.z);
            arr.set([x, item.baseY, z, x, tip, z], n * 6);
            n++;
        }
        leaderGeometry.setDrawRange(0, n * 2);
        pos.needsUpdate = true;
    });

    if (mapView !== 'globe') return null;

    // A hovered region has no label of its own at the broad view, and must not dim the family names.
    const anyHover = items.some((item) => item.id === hoveredId);
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
                            className={fading ? 'foj-label-fade foj-label-fade--out' : 'foj-label-fade'}
                            ref={(el) => {
                                if (el) labelHalfSize.current.set(item.id, { x: el.offsetWidth / 2, y: el.offsetHeight / 2 });
                                if (item.kind !== 'family') return;
                                if (el) familyNodes.current.set(item.id, el);
                                else familyNodes.current.delete(item.id);
                            }}
                        >
                            {item.kind === 'region' ? (
                                <RegionLabel code={item.code} expanded={isHovered} />
                            ) : item.kind === 'group' ? (
                                <GroupLabel group={item.group} />
                            ) : item.kind === 'family' ? (
                                <FamilyLabel family={item.family} highlighted={isHovered} leaving={fading} />
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

const RegionLabel: React.FC<{ code: string; expanded: boolean }> = ({ code, expanded }) => {
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
                    <p className="text-[9px] text-slate-500">{c.occupationCount} occupations · click to explore</p>
                </div>
            )}
        </div>
    );
};

/** A SOC minor group's name on its block in an open field: faint, so the job labels lead. */
const GroupLabel: React.FC<{ group: MinorGroupLayout }> = ({ group }) => (
    <div
        title={group.title}
        className="w-max max-w-[11rem] max-md:max-w-[7.5rem] px-1 select-none text-[9px] max-md:text-[8px] leading-tight font-medium uppercase tracking-wider text-cyan-100/45 text-center"
    >
        {group.title}
    </div>
);

/** A BLS job family: its name, and the way in from the broad view. */
export const FamilyLabel: React.FC<{ family: FamilyLayout; highlighted: boolean; leaving: boolean }> = ({ family, highlighted, leaving }) => (
    <button
        type="button"
        data-family-label
        tabIndex={leaving ? -1 : 0}
        aria-label={`${family.family.shortName}: open this family`}
        title={family.family.title}
        onClick={() => useWorldStore.getState().focusFamily(family.family.id)}
        className={`block w-max max-w-[13rem] max-md:max-w-[9.5rem] px-1.5 py-0.5 rounded-sm bg-[#0F172A]/60 select-none text-[11px] max-md:text-[9px] leading-tight font-semibold uppercase tracking-[0.12em] max-md:tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
            highlighted ? 'text-cyan-100' : 'text-cyan-200/80'
        }`}
    >
        {family.family.shortName}
    </button>
);

export const PeakLabel: React.FC<{ peak: ScenePeak; expanded: boolean; year: number }> = ({ peak, expanded, year }) => {
    const { entry } = peak;
    const partners = entry.kind === 'kelley' ? socPartnerTitles(entry.title) : [];
    // The whole title, in at most two lines (three on phones): a long title
    // widens its chip past the usual cap rather than being cut off.
    const fit = (lines: number) => `${Math.ceil(entry.title.length / lines) + 6}ch`;
    return (
        <div
            style={{ '--fit-2': fit(2), '--fit-3': fit(3) } as React.CSSProperties}
            // Title font on the chip itself, so the ch widths above are the title's.
            className={`flex flex-col w-max text-[10px] max-md:text-[9px] max-w-[min(max(13rem,var(--fit-2)),calc(100vw-2rem))] max-md:max-w-[min(max(9.5rem,var(--fit-3)),calc(100vw-2rem))] overflow-hidden rounded border shadow-sm select-none transition-all duration-200 ${
                expanded ? 'bg-[#0F172A]/95 scale-105 ring-1 ring-white/25 border-cyan-400/60 shadow-xl shadow-black/50' : 'bg-[#0F172A]/90 border-slate-600/40'
            }`}
        >
            <div className="flex items-start gap-1.5 px-1.5 py-0.5 max-md:gap-1 max-md:px-1 min-w-0">
                <div
                    className="w-1.5 h-1.5 mt-[3px] max-md:mt-[2.5px] rounded-full flex-shrink-0 ring-1 ring-black/30"
                    style={{ backgroundColor: peak.pipColor, boxShadow: entry.scored ? `0 0 4px ${peak.pipColor}` : undefined }}
                />
                <span className="text-white text-[10px] max-md:text-[9px] font-medium leading-tight tracking-wide font-sans min-w-0 break-words">
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
                    {!entry.scored && <div className="text-[8px] text-slate-500 leading-none">{UNSCORED_LABEL.title} · {UNSCORED_LABEL.detail}</div>}
                </div>
            )}
        </div>
    );
};
