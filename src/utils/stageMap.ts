/**
 * The one map from the world map's ground to a family's or field's stage. A
 * stage is its rectangle on the world map, magnified: every job, field tile and
 * minor-group block lands where this map sends its world position, so nothing
 * changes neighbours between levels. Flights blend from one map to the next
 * (blendMaps), which is what makes a level change a zoom rather than a new scene.
 *
 * Pure, like worldLayout, so it can be tested without a camera.
 */

import { rectDepth, rectWidth, type Rect } from './worldLayout';

/**
 * A map of the ground: x' = sx x + tx, z' = sz z + tz. Both scales are positive,
 * so order along each axis is kept and no two points swap places.
 */
export interface PlaneMap {
    sx: number;
    sz: number;
    tx: number;
    tz: number;
}

export const IDENTITY_MAP: Readonly<PlaneMap> = { sx: 1, sz: 1, tx: 0, tz: 0 };

export const mapX = (m: PlaneMap, x: number): number => m.sx * x + m.tx;
export const mapZ = (m: PlaneMap, z: number): number => m.sz * z + m.tz;

export function mapPoint(m: PlaneMap, x: number, z: number): { x: number; z: number } {
    return { x: mapX(m, x), z: mapZ(m, z) };
}

export function mapRect(m: PlaneMap, r: Rect): Rect {
    return { x0: mapX(m, r.x0), z0: mapZ(m, r.z0), x1: mapX(m, r.x1), z1: mapZ(m, r.z1) };
}

export function invertMap(m: PlaneMap): PlaneMap {
    return { sx: 1 / m.sx, sz: 1 / m.sz, tx: -m.tx / m.sx, tz: -m.tz / m.sz };
}

/** `outer` after `inner`. */
export function composeMaps(outer: PlaneMap, inner: PlaneMap): PlaneMap {
    return { sx: outer.sx * inner.sx, sz: outer.sz * inner.sz, tx: outer.sx * inner.tx + outer.tx, tz: outer.sz * inner.tz + outer.tz };
}

/** The map's magnification, the same on both axes unless a field was stretched. */
export const mapScale = (m: PlaneMap): number => Math.sqrt(m.sx * m.sz);

export const isIdentityMap = (m: PlaneMap): boolean => m.sx === 1 && m.sz === 1 && m.tx === 0 && m.tz === 0;

/**
 * The box every stage is fitted into, in stage units, around the middle of the
 * live 3D view. 50 across is what a 390px phone shows with room at both edges
 * from its portrait camera, and the live disc's reach on a desktop; 38 deep keeps
 * the near edge clear of the year slider on a laptop.
 */
export const STAGE_FIT = { width: 50, depth: 38 } as const;

/**
 * No field's stage is more than one and a half times as long one way as the
 * other. Past that a field is too thin to read: seen from the live camera's
 * 32.5 degrees, a deep field (Business & Finance is 1:1.75) shows as a narrow
 * column with its labels piled up, and on a phone it would use a third of the
 * screen's width. So its short side is stretched to 1.5, toward a square; the
 * other fields keep their world shape. The stretch is one positive scale per
 * axis, so every job keeps its neighbours. Families never stretch: a family is
 * its world block, magnified.
 */
export const FIELD_MAX_ASPECT = 1.5;

/** How much a field's short side is stretched, per axis: 1 for every field already within FIELD_MAX_ASPECT. */
export function fieldStretch(rect: Rect): { x: number; z: number } {
    const a = rectWidth(rect) / rectDepth(rect);
    return {
        x: a < 1 / FIELD_MAX_ASPECT ? 1 / (FIELD_MAX_ASPECT * a) : 1,
        z: a > FIELD_MAX_ASPECT ? a / FIELD_MAX_ASPECT : 1,
    };
}

/**
 * The stage map for a world rectangle: the rectangle's centre goes to the
 * middle of the view, where the camera looks and orbits, and it is magnified to
 * fill STAGE_FIT. A uniform scale and a translation; a field outside
 * FIELD_MAX_ASPECT also stretches its short side.
 */
export function stageMapFor(rect: Rect, kind: 'family' | 'field'): PlaneMap {
    const stretch = kind === 'field' ? fieldStretch(rect) : { x: 1, z: 1 };
    const s = Math.min(STAGE_FIT.width / (rectWidth(rect) * stretch.x), STAGE_FIT.depth / (rectDepth(rect) * stretch.z));
    const sx = s * stretch.x;
    const sz = s * stretch.z;
    return { sx, sz, tx: -sx * (rect.x0 + rect.x1) / 2, tz: -sz * (rect.z0 + rect.z1) / 2 };
}

/**
 * The map partway through a flight from `from` to `to`, at k from 0 to 1.
 * Scale moves evenly in log terms, as a camera zoom does, and the anchor (a
 * world point, the middle of the block being zoomed into or out of) slides in
 * a straight line from where `from` shows it to where `to` shows it. Both ends
 * are exact, and every point moves continuously in between.
 */
export function blendMaps(from: PlaneMap, to: PlaneMap, k: number, anchor: { x: number; z: number }): PlaneMap {
    const sx = from.sx * (to.sx / from.sx) ** k;
    const sz = from.sz * (to.sz / from.sz) ** k;
    const ax = mapX(from, anchor.x) + (mapX(to, anchor.x) - mapX(from, anchor.x)) * k;
    const az = mapZ(from, anchor.z) + (mapZ(to, anchor.z) - mapZ(from, anchor.z)) * k;
    if (k >= 1) return { ...to };
    return { sx, sz, tx: ax - sx * anchor.x, tz: az - sz * anchor.z };
}
