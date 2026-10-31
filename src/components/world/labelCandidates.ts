import { Vector3, type Camera } from 'three';
import { SCENE } from '../../config/constants';
import { INDEX_CONTINENT_BY_CODE } from '../../utils/occupationIndex';
import { anchorHeightInBand, bandTopAt, type LabelBand, type LabelCandidate } from '../../utils/labelLayout';
import type { FamilyLayout } from '../../utils/worldLayout';
import { displayedPeakHeight, GROUND_Y, type ScenePeak } from './worldScene';

/** World height of a region name above the ground. */
export const REGION_LABEL_Y = 0.6;

export type MarkerItem =
    | { kind: 'region'; id: string; code: string; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'family'; id: string; family: FamilyLayout; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'peak'; id: string; peak: ScenePeak; x: number; z: number; tipY: number; baseY: number };

/** A peak's label: its leader line rises SCENE.LABEL.BASE_HEIGHT above the peak as drawn right now. */
export function peakMarker(p: ScenePeak, year: number, focused: string | null, fieldMax: number): MarkerItem {
    const top = GROUND_Y + displayedPeakHeight(p, year, focused, fieldMax);
    return { kind: 'peak', id: p.entry.key, peak: p, x: p.x, z: p.z, baseY: top, tipY: top + SCENE.LABEL.BASE_HEIGHT };
}

export function regionMarker(code: string, cx: number, cz: number): MarkerItem {
    return { kind: 'region', id: `region:${code}`, code, x: cx, z: cz, baseY: GROUND_Y, tipY: GROUND_Y + REGION_LABEL_Y };
}

/** A family's name, in the middle of its block. */
export function familyMarker(f: FamilyLayout): MarkerItem {
    return {
        kind: 'family',
        id: `family:${f.family.id}`,
        family: f,
        x: (f.rect.x0 + f.rect.x1) / 2,
        z: (f.rect.z0 + f.rect.z1) / 2,
        baseY: GROUND_Y,
        tipY: GROUND_Y + REGION_LABEL_Y,
    };
}

/** Workers (EP 2025) behind a label; bigger wins a collision. */
export function markerSize(m: MarkerItem): number {
    if (m.kind === 'peak') return m.peak.entry.ep2025 ?? 0;
    if (m.kind === 'region') return INDEX_CONTINENT_BY_CODE.get(m.code)?.ep.employment2025 ?? 0;
    return 0;
}

/**
 * Collision order: hovered / tapped first, then peaks and fields by size.
 * Inside a zoomed field (`peaksFirst`) the job labels are what the user came
 * for, so field names take whatever room they leave.
 */
export function sortMarkers(items: MarkerItem[], isPriority: (m: MarkerItem) => boolean, peaksFirst = false): MarkerItem[] {
    const tier = (m: MarkerItem) => (isPriority(m) ? 0 : peaksFirst && m.kind === 'region' ? 2 : 1);
    return items.sort((a, b) => tier(a) - tier(b) || markerSize(b) - markerSize(a));
}

/**
 * Weights for layoutLabelsByWeight: fields by EP 2025 workers. Family names
 * show alone, so their weights never matter.
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
            // Field and family names have no leader line, so they may sit further
            // off their centre (phones need the room: 22 names in 390px).
            slack: item.kind === 'peak' ? 1 : 3,
        });
    }
}
