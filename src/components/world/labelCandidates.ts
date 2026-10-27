import { Vector3, type Camera } from 'three';
import { SCENE } from '../../config/constants';
import { INDEX_CONTINENT_BY_CODE } from '../../utils/occupationIndex';
import { anchorHeightInBand, bandTopAt, HIDDEN_LABEL_POSITION, isHiddenLabelPosition, type LabelBand, type LabelCandidate } from '../../utils/labelLayout';
import { WORLD_BOUNDS, type FamilyLayout } from '../../utils/worldLayout';
import { displayedPeakHeight, GROUND_Y, type ScenePeak } from './worldScene';

/** World height of a region name above the ground. */
export const REGION_LABEL_Y = 0.6;
/** Gap, in CSS pixels, between a family name and the corner of its block. */
const FAMILY_LABEL_INSET = 6;

export type MarkerItem =
    | { kind: 'region'; id: string; code: string; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'family'; id: string; family: FamilyLayout; outside: boolean; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'peak'; id: string; peak: ScenePeak; x: number; z: number; tipY: number; baseY: number };

/** A peak's label: its leader line rises SCENE.LABEL.BASE_HEIGHT above the peak as drawn right now. */
export function peakMarker(p: ScenePeak, year: number, focused: string | null, fieldMax: number): MarkerItem {
    const top = GROUND_Y + displayedPeakHeight(p, year, focused, fieldMax);
    return { kind: 'peak', id: p.entry.key, peak: p, x: p.x, z: p.z, baseY: top, tipY: top + SCENE.LABEL.BASE_HEIGHT };
}

export function regionMarker(code: string, cx: number, cz: number): MarkerItem {
    return { kind: 'region', id: `region:${code}`, code, x: cx, z: cz, baseY: GROUND_Y, tipY: GROUND_Y + REGION_LABEL_Y };
}

/**
 * A family's name, just inside the far-left corner of its block; and a
 * fallback just outside the block (beyond the world's edge, or on the block's
 * top border), used only when the field names leave no room inside it
 * (phones). See dropFamilyFallbacks.
 */
export function familyMarkers(f: FamilyLayout): MarkerItem[] {
    const base = { kind: 'family' as const, family: f, x: f.rect.x0, z: f.rect.z0, baseY: GROUND_Y, tipY: GROUND_Y };
    return [
        { ...base, id: `family:${f.family.id}`, outside: false },
        { ...base, id: `family:${f.family.id}:outside`, outside: true },
    ];
}

/** Hide a family's outside fallback whenever its inside name was placed. */
export function dropFamilyFallbacks(items: readonly MarkerItem[], placements: Map<string, [number, number]>): void {
    for (const m of items) {
        if (m.kind !== 'family' || !m.outside) continue;
        const inside = placements.get(`family:${m.family.family.id}`);
        if (inside && !isHiddenLabelPosition(inside)) placements.set(m.id, HIDDEN_LABEL_POSITION);
    }
}

/** Workers (EP 2025) behind a label; bigger wins a collision. */
export function markerSize(m: MarkerItem): number {
    if (m.kind === 'peak') return m.peak.entry.ep2025 ?? 0;
    if (m.kind === 'region') return INDEX_CONTINENT_BY_CODE.get(m.code)?.ep.employment2025 ?? 0;
    return 0;
}

/**
 * Collision order: hovered / tapped first, then peaks and fields by size,
 * then the five family names, which take whatever room the field names leave
 * (sliding along the top of their block) and never hide one, then their
 * outside fallbacks.
 */
export function sortMarkers(items: MarkerItem[], isPriority: (m: MarkerItem) => boolean): MarkerItem[] {
    const tier = (m: MarkerItem) => (isPriority(m) ? 0 : m.kind === 'family' ? (m.outside ? 3 : 2) : 1);
    return items.sort((a, b) => tier(a) - tier(b) || markerSize(b) - markerSize(a));
}

/**
 * Weights for layoutLabelsByWeight: fields by EP 2025 workers, family names 0
 * (so one would give way to any field name it covered).
 * Peaks are left out; they are already in size order and never yield to a
 * field. The hovered label is left out so it never yields.
 */
export function labelWeights(items: readonly MarkerItem[], hoveredId: string | null): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of items) if (m.kind !== 'peak' && m.id !== hoveredId) out.set(m.id, markerSize(m));
    return out;
}

const projected = new Vector3();

/**
 * Screen-space candidates for one declutter pass. `tips` receives the world
 * height each peak's leader line actually ends at: the full stalk, or lower
 * when the full one would push the label under the top chrome
 * (anchorHeightInBand), so a peak never loses its label for being tall.
 */
export function buildLabelCandidates(
    items: readonly MarkerItem[],
    camera: Camera,
    size: { width: number; height: number },
    band: LabelBand,
    halfSizes: ReadonlyMap<string, { x: number; y: number }>,
    out: LabelCandidate[],
    tips: Map<string, number>,
): void {
    out.length = 0;
    tips.clear();
    const toScreen = (x: number, y: number, z: number) => {
        projected.set(x, y, z).project(camera);
        return {
            x: (projected.x * size.width) / 2 + size.width / 2,
            y: -((projected.y * size.height) / 2) + size.height / 2,
            inFront: projected.z >= -1 && projected.z <= 1,
        };
    };
    for (const item of items) {
        const half = halfSizes.get(item.id) ?? { x: 40, y: 10 };
        if (item.kind === 'family') {
            const { rect } = item.family;
            if (item.outside) {
                // Below the world's near edge for a bottom-row block, beyond the
                // far edge for a top-row block, and otherwise on the block's top
                // border, like a folder tab. Along the block's own width.
                const below = rect.z1 >= WORLD_BOUNDS.z1 - 1e-6 && rect.z0 > WORLD_BOUNDS.z0 + 1e-6;
                // A block inside the world has fields above it too: its tab sits on the border line.
                const onBorder = !below && rect.z0 > WORLD_BOUNDS.z0 + 1e-6;
                const z = below ? rect.z1 : rect.z0;
                const l = toScreen(rect.x0, GROUND_Y, z);
                const r = toScreen(rect.x1, GROUND_Y, z);
                const dy = onBorder ? 0 : below ? half.y + FAMILY_LABEL_INSET : -(half.y + FAMILY_LABEL_INSET);
                out.push({
                    id: item.id,
                    anchorX: l.x + half.x + FAMILY_LABEL_INSET,
                    anchorY: l.y + dy,
                    halfWidth: half.x,
                    halfHeight: half.y,
                    inFront: l.inFront,
                    slack: 4,
                    keepIn: {
                        left: l.x,
                        right: r.x,
                        top: below ? l.y : -Infinity,
                        bottom: below ? Infinity : onBorder ? l.y + half.y + 0.5 : l.y,
                    },
                });
                continue;
            }
            let z = rect.z0;
            let s = toScreen(rect.x0, GROUND_Y, z);
            const top = bandTopAt(band, s.x, s.x + 2 * half.x + FAMILY_LABEL_INSET);
            for (let k = 1; k <= 8 && s.inFront && s.y + FAMILY_LABEL_INSET < top; k++) {
                z = rect.z0 + ((rect.z1 - rect.z0) * k) / 16;
                s = toScreen(rect.x0, GROUND_Y, z);
            }
            out.push({
                id: item.id,
                anchorX: s.x + half.x + FAMILY_LABEL_INSET,
                anchorY: s.y + half.y + FAMILY_LABEL_INSET,
                halfWidth: half.x,
                halfHeight: half.y,
                inFront: s.inFront,
                // Free to slide along the block's top edge, or down it, but never out of the block.
                slack: 4,
                keepIn: {
                    left: s.x + FAMILY_LABEL_INSET - 0.5,
                    top: s.y + FAMILY_LABEL_INSET - 0.5,
                    right: toScreen(rect.x1, GROUND_Y, z).x - FAMILY_LABEL_INSET,
                    bottom: toScreen(rect.x0, GROUND_Y, rect.z1).y - FAMILY_LABEL_INSET,
                },
            });
            continue;
        }
        let tipY = item.tipY;
        if (item.kind === 'peak') {
            const sx = toScreen(item.x, item.tipY, item.z).x;
            const top = bandTopAt(band, sx - half.x, sx + half.x);
            tipY = anchorHeightInBand((y) => toScreen(item.x, y, item.z).y, GROUND_Y, item.tipY, top + half.y + 2);
            tips.set(item.id, tipY);
        }
        const s = toScreen(item.x, tipY, item.z);
        out.push({
            id: item.id,
            anchorX: s.x,
            anchorY: s.y,
            halfWidth: half.x,
            halfHeight: half.y,
            inFront: s.inFront,
            // A field name has no leader line, so it may sit further off its centre
            // (phones need the room: 22 names in 390px).
            slack: item.kind === 'region' ? 3 : 1,
        });
    }
}
