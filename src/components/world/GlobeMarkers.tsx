import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { Html } from '@react-three/drei';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import { INDEX_CONTINENT_BY_CODE } from '../../utils/occupationIndex';
import { HIDDEN_LABEL_POSITION, isHiddenLabelPosition } from '../../utils/labelLayout';
import { continentAt, LAND_RADIUS, lonSinOf } from '../../utils/globeLayout';
import type { FamilyLayout } from '../../utils/worldLayout';
import { continentLabelPoint, GLOBE_PEAK_LABEL_LIFT, globePeakHeightAt, type GlobePeak, type GlobeScene } from './globeScene';
import { worldPointer } from './worldPointer';
import { useWorldView } from './worldCamera';
import { useLabelSafeBand } from './labelBand';
import { FamilyLabel, PeakLabel } from './WorldMarkers';
import { ContinentLabelButton } from './ContinentLabelButton';
import { familyAnchor, horizonAlpha, layoutGlobeLabels, type GlobeLabel } from './globeLabels';

const PEAK_HIT_RADIUS_PX = 28;

type GlobeItem =
    | { kind: 'region'; id: string; code: string; n: [number, number, number]; anchor: [number, number, number] }
    | { kind: 'family'; id: string; family: FamilyLayout; n: [number, number, number]; anchor: [number, number, number] }
    | { kind: 'peak'; id: string; g: GlobePeak };

function familyItem(f: FamilyLayout): GlobeItem {
    const n = familyAnchor(f, (f.rect.x0 + f.rect.x1) / 2);
    return { kind: 'family', id: `family:${f.family.id}`, family: f, n, anchor: [n[0] * LAND_RADIUS, n[1] * LAND_RADIUS, n[2] * LAND_RADIUS] };
}

const projected = new Vector3();
const ndc = new Vector2();
const raycaster = new Raycaster();
const landSphere = new Sphere(new Vector3(), LAND_RADIUS);
const hit = new Vector3();

/**
 * Labels and pointer input on the globe.
 *
 * Continent names (or, with the Kelley filter, the 50 Kelley roles) are
 * labelled only on the hemisphere facing the camera, fade out near the edge,
 * and never show through the globe. Collisions follow the flat map's rule:
 * when two continent names collide, the field with fewer workers (EP 2025)
 * is hidden. Tapping a continent, its name, or a Kelley peak asks the world
 * store for that field; CameraRig turns the globe and carries the camera in.
 */
export const GlobeMarkers: React.FC<{ globe: GlobeScene }> = ({ globe }) => {
    const year = useStore((s) => s.year);
    const mapView = useStore((s) => s.mapView);
    const isOrbiting = useStore((s) => s.isOrbiting);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const moving = useWorldView((s) => s.moving);

    const viewKey = `globe|${kelleyOnly}`;
    const viewKeyRef = useRef(viewKey);
    const [hover, setHover] = useState<{ id: string; view: string } | null>(null);
    const [tap, setTap] = useState<{ key: string; view: string } | null>(null);
    const hoveredId = !isOrbiting && !moving && hover?.view === viewKey ? hover.id : null;
    const tappedKey = tap?.view === viewKey ? tap.key : null;
    const setHoveredId = (id: string | null) =>
        setHover((prev) => (prev?.id === id && prev?.view === viewKeyRef.current ? prev : id ? { id, view: viewKeyRef.current } : null));
    const setTappedKey = (key: string | null) => setTap(key ? { key, view: viewKeyRef.current } : null);

    const gl = useThree((s) => s.gl);
    const getThree = useThree((s) => s.get);

    const safeBand = useLabelSafeBand(viewKey);
    const labelHalfSize = useRef<Map<string, { x: number; y: number }>>(new Map());
    const labelEls = useRef<Map<string, HTMLDivElement>>(new Map());
    const placements = useRef<Map<string, [number, number]>>(new Map());
    const labelOffsets = useRef<Map<string, [number, number]>>(new Map());
    const alphas = useRef<Map<string, number>>(new Map());
    const labels = useRef<GlobeLabel[]>([]);
    const itemsRef = useRef<GlobeItem[]>([]);
    const peakAnchors = useRef<Map<string, { x: number; y: number }>>(new Map());
    const tappablePeaksRef = useRef<GlobePeak[]>([]);
    const tappedKeyRef = useRef<string | null>(null);
    const regionWeights = useRef<Map<string, number>>(new Map());
    // How far up its stalk each Kelley label's anchor ended up this frame (1 = full stalk).
    const tipFractions = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        const clear = () => {
            setHoveredId(null);
            worldPointer.hoverRegion = null;
            worldPointer.hoverPeakContinent = null;
            worldPointer.hoverPeakIndex = -1;
            worldPointer.overGlobe = false;
            worldPointer.overLabel = false;
        };
        window.addEventListener('blur', clear);
        document.addEventListener('visibilitychange', clear);
        return () => {
            window.removeEventListener('blur', clear);
            document.removeEventListener('visibilitychange', clear);
            clear();
            worldPointer.globeX = worldPointer.globeY = worldPointer.globeZ = 0;
        };
    }, []);

    // Kelley peaks are tappable on the globe, as they were on the flat world view.
    const tappablePeaks = useMemo<GlobePeak[]>(
        () => (kelleyOnly ? [...globe.peakByKey.values()].filter((g) => g.peak.entry.kind === 'kelley') : []),
        [globe, kelleyOnly],
    );

    const items = useMemo<GlobeItem[]>(() => {
        if (mapView !== 'globe') return [];
        const out: GlobeItem[] = kelleyOnly
            ? tappablePeaks.map((g) => ({ kind: 'peak' as const, id: g.peak.entry.key, g }))
            : [
                ...globe.layout.continents.map((c) => {
                    const anchor = continentLabelPoint(c);
                    const l = Math.hypot(...anchor);
                    return { kind: 'region' as const, id: `region:${c.code}`, code: c.code, n: [anchor[0] / l, anchor[1] / l, anchor[2] / l] as [number, number, number], anchor };
                }),
                ...globe.layout.families.map(familyItem),
            ];
        // Hovered / tapped first, then size, then the family names, which take
        // whatever room is left: earlier items win collisions.
        const size = (m: GlobeItem) =>
            m.kind === 'peak' ? m.g.peak.entry.ep2025 ?? 0 : m.kind === 'region' ? INDEX_CONTINENT_BY_CODE.get(m.code)?.ep.employment2025 ?? 0 : 0;
        const tier = (m: GlobeItem) => (m.id === hoveredId || m.id === tappedKey ? 0 : m.kind === 'family' ? 2 : 1);
        out.sort((a, b) => tier(a) - tier(b) || size(b) - size(a));
        return out;
    }, [mapView, kelleyOnly, tappablePeaks, globe, hoveredId, tappedKey]);

    useLayoutEffect(() => {
        // Continent names compete by size (EP 2025), family names weigh 0 (they
        // give way to any continent name they would hide); a hovered one never yields.
        regionWeights.current = new Map(
            items
                .filter((m) => m.kind !== 'peak' && m.id !== hoveredId)
                .map((m) => [m.id, m.kind === 'region' ? INDEX_CONTINENT_BY_CODE.get(m.code)?.ep.employment2025 ?? 0 : 0]),
        );
        viewKeyRef.current = viewKey;
        itemsRef.current = items;
        tappablePeaksRef.current = tappablePeaks;
        tappedKeyRef.current = tappedKey;
    }, [items, tappablePeaks, tappedKey, viewKey, hoveredId]);

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
        const busy = () => useWorldView.getState().moving || useWorldView.getState().view !== 'globe';

        // Continent names are buttons of their own (ContinentLabelButton); only
        // the Kelley peak labels are hit-tested here.
        const hitLabel = (x: number, y: number): GlobeItem | null => {
            for (const item of itemsRef.current) {
                if (item.kind !== 'peak') continue;
                const pos = placements.current.get(item.id);
                const half = labelHalfSize.current.get(item.id);
                if (!pos || isHiddenLabelPosition(pos) || !half || (alphas.current.get(item.id) ?? 0) < 0.3) continue;
                if (Math.abs(x - pos[0]) <= half.x && Math.abs(y - pos[1]) <= half.y) return item;
            }
            return null;
        };

        const hitPeak = (x: number, y: number): GlobePeak | null => {
            let best: GlobePeak | null = null;
            let bestDist = PEAK_HIT_RADIUS_PX;
            for (const g of tappablePeaksRef.current) {
                const a = peakAnchors.current.get(g.peak.entry.key);
                if (!a) continue;
                const d = Math.hypot(x - a.x, y - a.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = g;
                }
            }
            return best;
        };

        /** The point of the globe under the pointer, as a unit vector, or null off the globe. */
        const hitGlobe = (x: number, y: number, w: number, h: number): Vector3 | null => {
            ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
            raycaster.setFromCamera(ndc, getThree().camera);
            return raycaster.ray.intersectSphere(landSphere, hit) ? hit.clone().normalize() : null;
        };
        const continentUnder = (p: Vector3 | null) => {
            if (!p) return null;
            const [lon, s] = lonSinOf(p.x, p.y, p.z);
            return continentAt(globe.layout.continents, lon, s);
        };

        const onDown = (e: PointerEvent) => {
            worldPointer.lastInteraction = performance.now();
            worldPointer.interacted = true;
            if (e.button !== 0) return;
            downX = e.clientX;
            downY = e.clientY;
            downT = performance.now();
        };

        const onUp = (e: PointerEvent) => {
            worldPointer.lastInteraction = performance.now();
            if (e.button !== 0 || busy()) return;
            if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 10 || performance.now() - downT >= 500) return;
            const { x, y, w, h } = local(e.clientX, e.clientY);
            const world = useWorldStore.getState();
            const touch = e.pointerType === 'touch';

            const label = hitLabel(x, y);
            if (label?.kind === 'peak') {
                world.openRole(label.g.peak.entry);
                return;
            }
            const peak = hitPeak(x, y);
            if (peak) {
                // Touch has no hover: the first tap shows the card, the next opens the role.
                if (touch && tappedKeyRef.current !== peak.peak.entry.key) setTappedKey(peak.peak.entry.key);
                else world.openRole(peak.peak.entry);
                return;
            }
            setTappedKey(null);
            const c = continentUnder(hitGlobe(x, y, w, h));
            if (c) world.focusContinent(c.code);
        };

        const onMove = (e: PointerEvent) => {
            const { x, y, w, h } = local(e.clientX, e.clientY);
            if (e.pointerType === 'touch' || useStore.getState().isOrbiting || busy()) {
                el.style.cursor = '';
                return;
            }
            const p = hitGlobe(x, y, w, h);
            worldPointer.overGlobe = !!p;
            worldPointer.globeX = p?.x ?? 0;
            worldPointer.globeY = p?.y ?? 0;
            worldPointer.globeZ = p?.z ?? 0;
            const label = hitLabel(x, y);
            const peak = label ? null : hitPeak(x, y);
            const hoverPeak = label?.kind === 'peak' ? label.g : peak;
            const region = !hoverPeak ? continentUnder(p)?.code ?? null : null;
            setHoveredId(hoverPeak ? hoverPeak.peak.entry.key : region ? `region:${region}` : null);
            worldPointer.hoverPeakContinent = hoverPeak ? hoverPeak.peak.entry.continent : null;
            worldPointer.hoverPeakIndex = hoverPeak ? hoverPeak.peak.index : -1;
            worldPointer.hoverRegion = region;
            // Holding the pointer over the globe keeps it still under it.
            if (p) worldPointer.lastInteraction = performance.now();
            el.style.cursor = hoverPeak || region ? 'pointer' : '';
        };

        const onLeave = () => {
            setHoveredId(null);
            worldPointer.hoverRegion = null;
            worldPointer.hoverPeakContinent = null;
            worldPointer.hoverPeakIndex = -1;
            worldPointer.overGlobe = false;
            worldPointer.globeX = worldPointer.globeY = worldPointer.globeZ = 0;
            el.style.cursor = '';
        };

        const onWheel = () => {
            worldPointer.lastInteraction = performance.now();
            worldPointer.interacted = true;
        };

        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', onLeave);
        el.addEventListener('wheel', onWheel, { passive: true });
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
            el.removeEventListener('wheel', onWheel);
            el.style.cursor = '';
        };
    }, [gl, getThree, globe]);

    // Leader lines for the Kelley peak labels in one draw call; their alpha follows each label's.
    const leaderGeometry = useMemo(() => {
        const g = new BufferGeometry();
        const n = Math.max(1, items.length);
        g.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3));
        g.setAttribute('color', new BufferAttribute(new Float32Array(n * 8), 4));
        return g;
    }, [items.length]);
    useEffect(() => () => leaderGeometry.dispose(), [leaderGeometry]);

    useFrame((state) => {
        const { camera, size } = state;
        const cx = camera.position.x;
        const cy = camera.position.y;
        const cz = camera.position.z;
        const hidden = useWorldView.getState().moving;
        const yearNow = useStore.getState().year;
        const screen = (wx: number, wy: number, wz: number) => {
            projected.set(wx, wy, wz).project(camera);
            return {
                x: (projected.x * size.width) / 2 + size.width / 2,
                y: -((projected.y * size.height) / 2) + size.height / 2,
                front: projected.z >= -1 && projected.z <= 1,
            };
        };

        // Screen-space tips of the tappable peaks on the near side.
        for (const g of tappablePeaksRef.current) {
            const [nx, ny, nz] = g.dir;
            if (hidden || horizonAlpha(nx, ny, nz, cx, cy, cz) <= 0) {
                peakAnchors.current.delete(g.peak.entry.key);
                continue;
            }
            const r = LAND_RADIUS + globePeakHeightAt(g.peak.entry, yearNow);
            const s = screen(nx * r, ny * r, nz * r);
            if (s.front) peakAnchors.current.set(g.peak.entry.key, { x: s.x, y: s.y });
            else peakAnchors.current.delete(g.peak.entry.key);
        }

        const list = labels.current;
        list.length = 0;
        for (const item of itemsRef.current) {
            const half = labelHalfSize.current.get(item.id) ?? { x: 40, y: 10 };
            if (item.kind === 'region') {
                list.push({ id: item.id, n: item.n, anchor: item.anchor, halfWidth: half.x, halfHeight: half.y, slack: 2 });
                continue;
            }
            if (item.kind === 'family') {
                const n = familyAnchor(item.family, Math.atan2(cx, cz));
                list.push({
                    id: item.id,
                    n,
                    anchor: [n[0] * LAND_RADIUS, n[1] * LAND_RADIUS, n[2] * LAND_RADIUS],
                    halfWidth: half.x,
                    halfHeight: half.y,
                    slack: 2,
                    hang: true,
                });
                continue;
            }
            const [nx, ny, nz] = item.g.dir;
            const r = LAND_RADIUS + globePeakHeightAt(item.g.peak.entry, yearNow) + GLOBE_PEAK_LABEL_LIFT;
            list.push({
                id: item.id,
                n: item.g.dir,
                anchor: [nx * r, ny * r, nz * r],
                // A tall peak's label slides down its stalk, then onto the peak, rather than vanish under the chrome.
                foot: [nx * LAND_RADIUS, ny * LAND_RADIUS, nz * LAND_RADIUS],
                halfWidth: half.x,
                halfHeight: half.y,
                slack: 1,
            });
        }
        layoutGlobeLabels(
            list, regionWeights.current, camera, size.width, size.height, safeBand.current,
            placements.current, labelOffsets.current, alphas.current, hidden, tipFractions.current,
        );

        for (const item of itemsRef.current) {
            const el = labelEls.current.get(item.id);
            if (el) {
                const a = String(Math.round((alphas.current.get(item.id) ?? 0) * 100) / 100);
                if (el.style.opacity !== a) el.style.opacity = a;
            }
        }

        const pos = leaderGeometry.getAttribute('position') as BufferAttribute;
        const col = leaderGeometry.getAttribute('color') as BufferAttribute;
        const p = pos.array as Float32Array;
        const c = col.array as Float32Array;
        let k = 0;
        for (const item of itemsRef.current) {
            if (item.kind !== 'peak') continue;
            const placed = placements.current.get(item.id);
            if (!placed || isHiddenLabelPosition(placed)) continue;
            const [nx, ny, nz] = item.g.dir;
            const r0 = LAND_RADIUS + globePeakHeightAt(item.g.peak.entry, yearNow);
            // The stalk ends where the label's anchor did; a label lowered onto the peak has none.
            const r1 = LAND_RADIUS + (r0 + GLOBE_PEAK_LABEL_LIFT - LAND_RADIUS) * (tipFractions.current.get(item.id) ?? 1);
            if (r1 <= r0) continue;
            p.set([nx * r0, ny * r0, nz * r0, nx * r1, ny * r1, nz * r1], k * 6);
            const a = (alphas.current.get(item.id) ?? 0) * 0.55;
            c.set([1, 1, 1, a, 1, 1, 1, a], k * 8);
            k++;
        }
        leaderGeometry.setDrawRange(0, k * 2);
        pos.needsUpdate = true;
        col.needsUpdate = true;
    });

    if (mapView !== 'globe') return null;

    const anyHover = !!hoveredId;
    return (
        <group>
            <lineSegments geometry={leaderGeometry} frustumCulled={false}>
                <lineBasicMaterial vertexColors transparent />
            </lineSegments>
            {items.map((item) => {
                const isHovered = item.id === hoveredId || item.id === tappedKey;
                // Only drei's depth ordering reads this; calculatePosition places the label.
                const r = item.kind === 'peak' ? LAND_RADIUS + globePeakHeightAt(item.g.peak.entry, year) + GLOBE_PEAK_LABEL_LIFT : 0;
                const position: [number, number, number] = item.kind === 'peak' ? [item.g.dir[0] * r, item.g.dir[1] * r, item.g.dir[2] * r] : item.anchor;
                return (
                    <Html
                        key={item.id}
                        position={position}
                        center
                        calculatePosition={() => placements.current.get(item.id) ?? HIDDEN_LABEL_POSITION}
                        wrapperClass={
                            isHovered ? 'foj-job-label foj-job-label--front' : anyHover ? 'foj-job-label foj-job-label--recessed' : 'foj-job-label'
                        }
                        zIndexRange={isHovered ? [16777271, 16777000] : [100, 0]}
                    >
                        <div
                            data-globe-label={item.kind}
                            ref={(el) => {
                                if (el) {
                                    labelEls.current.set(item.id, el);
                                    labelHalfSize.current.set(item.id, { x: el.offsetWidth / 2, y: el.offsetHeight / 2 });
                                } else labelEls.current.delete(item.id);
                            }}
                        >
                            {item.kind === 'region' ? (
                                <ContinentLabelButton
                                    code={item.code}
                                    expanded={isHovered}
                                    onHover={(on) => setHoveredId(on ? item.id : null)}
                                />
                            ) : item.kind === 'family' ? (
                                <FamilyLabel family={item.family} />
                            ) : (
                                <PeakLabel peak={item.g.peak} expanded={isHovered} year={year} />
                            )}
                        </div>
                    </Html>
                );
            })}
        </group>
    );
};
