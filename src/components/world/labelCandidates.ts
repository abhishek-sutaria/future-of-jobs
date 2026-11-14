import { Vector3, type Camera } from 'three';
import { SCENE } from '../../config/constants';
import { INDEX_CONTINENT_BY_CODE } from '../../utils/occupationIndex';
import { anchorHeightInBand, bandTopAt, type LabelBand, type LabelCandidate } from '../../utils/labelLayout';
import type { FamilyLayout, MinorGroupLayout } from '../../utils/worldLayout';
import { isOnStage, levelKind, type WorldLevel } from '../../utils/worldLevel';
import { GROUND_Y, peakHeightAt, type ScenePeak } from './worldScene';

/** World height of a region name above the ground. */
export const REGION_LABEL_Y = 0.6;
/** How far above the hills a field's name floats over its tile. */
const RANGE_LABEL_Y = 1;
/** A minor group's name sits just above its block's ground, under the job labels. */
const GROUP_LABEL_Y = 0.3;

/**
 * Every label's x and z are on the world map's ground, at every level: a stage
 * is the world magnified, so the same point is the same job, field or group
 * everywhere, and buildLabelCandidates sends it to the screen through the
 * view's map.
 */
export type MarkerItem =
    | { kind: 'region'; id: string; code: string; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'family'; id: string; family: FamilyLayout; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'group'; id: string; group: MinorGroupLayout; x: number; z: number; tipY: number; baseY: number }
    | { kind: 'peak'; id: string; peak: ScenePeak; x: number; z: number; tipY: number; baseY: number };

/** A peak's label on the treemap: its leader line rises SCENE.LABEL.BASE_HEIGHT above the peak. */
export function peakMarker(p: ScenePeak, year: number): MarkerItem {
    const top = GROUND_Y + peakHeightAt(p.entry, year);
    return { kind: 'peak', id: p.entry.key, peak: p, x: p.x, z: p.z, baseY: top, tipY: top + SCENE.LABEL.BASE_HEIGHT };
}

/** A job's label on a stage. Its height comes from the surface, every frame (stageMarkerHeights). */
export function stagePeakMarker(p: ScenePeak): MarkerItem {
    return { kind: 'peak', id: p.entry.key, peak: p, x: p.x, z: p.z, baseY: GROUND_Y, tipY: GROUND_Y + SCENE.LABEL.BASE_HEIGHT };
}

/** A minor group's name, in the middle of its block on a field's stage. */
export function groupMarker(g: MinorGroupLayout): MarkerItem {
    return {
        kind: 'group',
        id: `group:${g.minor}`,
        group: g,
        x: (g.rect.x0 + g.rect.x1) / 2,
        z: (g.rect.z0 + g.rect.z1) / 2,
        baseY: GROUND_Y,
        tipY: GROUND_Y + GROUP_LABEL_Y,
    };
}

/** Stands a stage's labels on the surface as drawn right now. `surface` is the height above the ground at a world point. */
export function stageMarkerHeights(items: readonly MarkerItem[], surface: (x: number, z: number) => number): void {
    for (const item of items) {
        const base = GROUND_Y + surface(item.x, item.z);
        item.baseY = base;
        item.tipY = base + (item.kind === 'peak' ? SCENE.LABEL.BASE_HEIGHT : item.kind === 'group' ? GROUP_LABEL_Y : RANGE_LABEL_Y);
    }
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

/** Whether a label belongs to the level. One that is on its way out still shows for a moment, and must not take input. */
export function markerOnStage(m: MarkerItem, level: WorldLevel): boolean {
    if (m.kind === 'family') return levelKind(level) === 'world';
    return isOnStage(level, m.kind === 'region' ? m.code : m.kind === 'group' ? m.group.code : m.peak.entry.continent);
}

/** Workers (EP 2025) behind a label; bigger wins a collision. */
export function markerSize(m: MarkerItem): number {
    if (m.kind === 'peak') return m.peak.entry.ep2025 ?? 0;
    if (m.kind === 'region') return INDEX_CONTINENT_BY_CODE.get(m.code)?.ep.employment2025 ?? 0;
    // Among minor groups, the bigger block names itself first.
    if (m.kind === 'group') return m.group.keys.length;
    return 0;
}

/**
 * Collision order: hovered / tapped first, then peaks and fields by size.
 * Under the Kelley filter (`peaksFirst`) the job labels are what the user came
 * for, so field names take whatever room they leave. Minor-group names always
 * come last: they show only where the job labels leave room.
 */
export function sortMarkers(items: MarkerItem[], isPriority: (m: MarkerItem) => boolean, peaksFirst = false): MarkerItem[] {
    const tier = (m: MarkerItem) => (isPriority(m) ? 0 : m.kind === 'group' ? 3 : peaksFirst && m.kind === 'region' ? 2 : 1);
    return items.sort((a, b) => tier(a) - tier(b) || markerSize(b) - markerSize(a));
}

/**
 * Weights for layoutLabelsByWeight: fields by EP 2025 workers. Family names
 * show alone, so their weights never matter.
 * Peaks are left out; they are already in size order and never yield to a
 * field. Minor-group names are left out: they come last and take what is left.
 * The hovered label is left out so it never yields.
 */
export function labelWeights(items: readonly MarkerItem[], hoveredId: string | null): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of items) if (m.kind !== 'peak' && m.kind !== 'group' && m.id !== hoveredId) out.set(m.id, markerSize(m));
    return out;
}

const projected = new Vector3();

/** World ground to the screen's ground: the view's map at this frame. Identity at rest at the world. */
export type GroundMap = (x: number, z: number) => { x: number; z: number };
const sameGround: GroundMap = (x, z) => ({ x, z });

/**
 * Screen-space candidates for one declutter pass. `tips` receives the world
 * height each peak's leader line actually ends at: the full stalk, or lower
 * when the full one would push the label under the top chrome
 * (anchorHeightInBand), so a peak never loses its label for being tall.
 * `ground` carries each label's world position to where it is drawn.
 */
export function buildLabelCandidates(
    items: readonly MarkerItem[],
    camera: Camera,
    size: { width: number; height: number },
    band: LabelBand,
    halfSizes: ReadonlyMap<string, { x: number; y: number }>,
    out: LabelCandidate[],
    tips: Map<string, number>,
    ground: GroundMap = sameGround,
): void {
    out.length = 0;
    tips.clear();
    const toScreen = (wx: number, y: number, wz: number) => {
        const { x, z } = ground(wx, wz);
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
            // off their centre (phones need the room: 22 names in 390px). A minor
            // group's name stays on its block or does not show.
            slack: item.kind === 'peak' || item.kind === 'group' ? 1 : 3,
        });
    }
}
