import { Vector3, type Camera } from 'three';
import { LAND_RADIUS } from '../../utils/globeLayout';
import { anchorHeightInBand, bandTopAt, layoutLabelsByWeight, type LabelBand, type LabelCandidate } from '../../utils/labelLayout';

/**
 * Labels on the globe show only on the side facing the camera and fade out
 * toward its edge. `facing` is how far a point is inside the horizon: the
 * cosine of its angle from the camera direction minus that of the horizon
 * (R / camera distance). Hidden below FACING_HIDE, full above FACING_FULL.
 */
export const FACING_HIDE = 0.04;
export const FACING_FULL = 0.22;
/** Below this opacity a label is not placed at all, so a near-invisible one never crowds out a readable one. */
export const MIN_PLACED_ALPHA = 0.12;

/** Visibility of a surface point (unit normal n) seen from a camera at c: 0 behind the horizon, 1 well inside it. */
export function horizonAlpha(nx: number, ny: number, nz: number, cx: number, cy: number, cz: number, radius = LAND_RADIUS): number {
    const d = Math.hypot(cx, cy, cz);
    if (!(d > radius)) return 0;
    const facing = (nx * cx + ny * cy + nz * cz) / d - radius / d;
    if (facing <= FACING_HIDE) return 0;
    return Math.min(1, (facing - FACING_HIDE) / (FACING_FULL - FACING_HIDE));
}

export interface GlobeLabel {
    id: string;
    /** Unit normal of the surface point the label belongs to. */
    n: readonly [number, number, number];
    /** World position of the label's anchor (above that point). */
    anchor: readonly [number, number, number];
    halfWidth: number;
    halfHeight: number;
    /** How far the label may sit off its anchor, in half-sizes (see LabelCandidate.slack). */
    slack?: number;
    /**
     * A peak label's foot (where its peak meets the land). When the anchor
     * would put the label under the top chrome, the anchor slides toward the
     * foot until it fits (anchorHeightInBand), so a tall peak keeps its label.
     */
    foot?: readonly [number, number, number];
    /** Hang the label below and to the right of its anchor (a family name at its cell's north-west corner). */
    hang?: boolean;
}

/** Gap, in CSS pixels, between a hanging label and its anchor. */
const HANG_GAP = 4;

const projected = new Vector3();

/**
 * One frame of label placement on the globe: labels behind the horizon (or
 * too faint) are left out entirely, the rest go through the flat map's
 * collision pass, where the smaller field (lower weight) yields. Writes
 * screen positions to `out` (absent = hidden) and each label's opacity to
 * `alphas`. `tips` receives, for each label with a foot, how far up from the
 * foot (0) to its full anchor (1) the anchor ended up.
 */
export function layoutGlobeLabels(
    labels: readonly GlobeLabel[],
    weights: ReadonlyMap<string, number>,
    camera: Camera,
    width: number,
    height: number,
    band: LabelBand,
    out: Map<string, [number, number]>,
    offsets: Map<string, [number, number]>,
    alphas: Map<string, number>,
    hideAll = false,
    tips?: Map<string, number>,
): void {
    const { x: cx, y: cy, z: cz } = camera.position;
    const list: LabelCandidate[] = [];
    for (const label of labels) {
        const [nx, ny, nz] = label.n;
        const alpha = hideAll ? 0 : horizonAlpha(nx, ny, nz, cx, cy, cz);
        alphas.set(label.id, alpha);
        // Behind the horizon: no label, and no say in where the others go.
        if (alpha < MIN_PLACED_ALPHA) continue;
        const [ax, ay, az] = label.anchor;
        const toScreen = (t: number) => {
            const f = label.foot;
            if (f) projected.set(f[0] + (ax - f[0]) * t, f[1] + (ay - f[1]) * t, f[2] + (az - f[2]) * t);
            else projected.set(ax, ay, az);
            projected.project(camera);
            return { x: (projected.x * width) / 2 + width / 2, y: -((projected.y * height) / 2) + height / 2, z: projected.z };
        };
        let t = 1;
        if (label.foot) {
            const sx = toScreen(1).x;
            t = anchorHeightInBand((u) => toScreen(u).y, 0, 1, bandTopAt(band, sx - label.halfWidth, sx + label.halfWidth) + label.halfHeight + 2);
            tips?.set(label.id, t);
        }
        const s = toScreen(t);
        const dx = label.hang ? label.halfWidth + HANG_GAP : 0;
        const dy = label.hang ? label.halfHeight + HANG_GAP : 0;
        list.push({
            id: label.id,
            anchorX: s.x + dx,
            anchorY: s.y + dy,
            halfWidth: label.halfWidth,
            halfHeight: label.halfHeight,
            inFront: s.z >= -1 && s.z <= 1,
            slack: label.slack,
        });
    }
    layoutLabelsByWeight(list, weights, width, height, band, out, offsets, 2, 4);
}
