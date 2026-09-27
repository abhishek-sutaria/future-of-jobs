/**
 * labelLayout.ts
 * --------------
 * Screen-space placement maths for the floating role labels.
 *
 * Kept pure (no three.js, no DOM) so it can be unit-tested the way the rest of
 * this repo tests logic. JobMarkers feeds it the projected position of each
 * leader-line tip (the "anchor") once per frame.
 *
 * Invariant: the anchor always stays inside its label box. A label may be
 * nudged by at most its own half-size; if the anchor is off-screen, behind the
 * camera, or under the header / year-slider chrome, the label is HIDDEN
 * instead of being pinned to an edge. Pinning was the old behaviour and
 * produced leader lines that ran off-screen while their labels stayed in view
 * (Ray, Samsung foldable, Chrome).
 */

/** Vertical chrome the labels must stay clear of, in CSS pixels. */
export type LabelBand = { top: number; bottom: number };

/**
 * Parked far off-screen so drei's `<Html>` still mounts the node (we need its
 * measured size next frame) but nothing is painted in the viewport.
 */
export const HIDDEN_LABEL_POSITION: [number, number] = [-100000, -100000];

export function isHiddenLabelPosition(p: readonly number[]): boolean {
    return p[0] <= -99999 || p[1] <= -99999;
}

/**
 * Place a single label as close to its anchor as the viewport allows, without
 * ever letting the anchor leave the label box. Returns HIDDEN when no such
 * placement exists.
 */
export function resolveLabelPosition(
    anchorX: number,
    anchorY: number,
    halfWidth: number,
    halfHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    band: LabelBand,
    margin = 4,
): [number, number] {
    const minX = margin;
    const maxX = viewportWidth - margin;
    const minY = band.top;
    const maxY = viewportHeight - band.bottom;

    // Anchor itself must be in the usable band — otherwise any on-screen label
    // would detach from its leader line.
    if (
        !Number.isFinite(anchorX) ||
        !Number.isFinite(anchorY) ||
        anchorX < minX ||
        anchorX > maxX ||
        anchorY < minY ||
        anchorY > maxY
    ) {
        return HIDDEN_LABEL_POSITION;
    }

    // Room for a centred label. When the box is wider/taller than the band
    // there is no legal centre that keeps the whole box inside.
    const centreMinX = halfWidth + margin;
    const centreMaxX = viewportWidth - halfWidth - margin;
    const centreMinY = halfHeight + band.top;
    const centreMaxY = viewportHeight - halfHeight - band.bottom;
    if (centreMinX > centreMaxX || centreMinY > centreMaxY) {
        return HIDDEN_LABEL_POSITION;
    }

    const cx = Math.min(Math.max(anchorX, centreMinX), centreMaxX);
    const cy = Math.min(Math.max(anchorY, centreMinY), centreMaxY);

    // Nudge is capped at half-size so the anchor stays inside the box.
    if (Math.abs(cx - anchorX) > halfWidth || Math.abs(cy - anchorY) > halfHeight) {
        return HIDDEN_LABEL_POSITION;
    }

    return [cx, cy];
}

/** Axis-aligned box overlap with a uniform pad. Centres + half-extents. */
export function labelsCollide(
    ax: number,
    ay: number,
    aHalfW: number,
    aHalfH: number,
    bx: number,
    by: number,
    bHalfW: number,
    bHalfH: number,
    pad = 0,
): boolean {
    return (
        Math.abs(ax - bx) < aHalfW + bHalfW + pad &&
        Math.abs(ay - by) < aHalfH + bHalfH + pad
    );
}

export type LabelCandidate = {
    id: string;
    /** Projected tip of the leader line, CSS pixels. */
    anchorX: number;
    anchorY: number;
    halfWidth: number;
    halfHeight: number;
    /** False when the peak is behind the camera (NDC z outside [-1, 1]). */
    inFront: boolean;
};

type Placed = { id: string; x: number; y: number; halfW: number; halfH: number };

/** Nine nudges: centre, four edge midpoints, four corners. Sorted nearest-first. */
const NUDGE_ORDER: ReadonlyArray<readonly [number, number]> = (() => {
    const raw: Array<[number, number, number]> = [];
    for (const sx of [-1, 0, 1]) {
        for (const sy of [-1, 0, 1]) {
            raw.push([sx, sy, sx * sx + sy * sy]);
        }
    }
    raw.sort((a, b) => a[2] - b[2]);
    return raw.map(([sx, sy]) => [sx, sy] as const);
})();

/**
 * One shared per-frame pass: project every label, place each as close to its
 * own anchor as it can get without covering an already-placed label, hide it
 * if nothing fits. `offsets` carries the last accepted nudge per id so a label
 * does not flicker between two equally valid spots as the camera moves.
 *
 * Callers pass `items` already sorted by importance (selected/hovered first,
 * then employment descending) — earlier items win collisions.
 */
export function layoutLabels(
    items: readonly LabelCandidate[],
    viewportWidth: number,
    viewportHeight: number,
    band: LabelBand,
    out: Map<string, [number, number]>,
    offsets: Map<string, [number, number]>,
    pad = 2,
    margin = 4,
): void {
    out.clear();
    const placed: Placed[] = [];

    const minX = margin;
    const maxX = viewportWidth - margin;
    const minY = band.top;
    const maxY = viewportHeight - band.bottom;

    for (const item of items) {
        const { id, anchorX, anchorY, halfWidth, halfHeight, inFront } = item;

        if (
            !inFront ||
            !Number.isFinite(anchorX) ||
            !Number.isFinite(anchorY) ||
            halfWidth <= 0 ||
            halfHeight <= 0 ||
            anchorX < minX ||
            anchorX > maxX ||
            anchorY < minY ||
            anchorY > maxY
        ) {
            out.set(id, HIDDEN_LABEL_POSITION);
            offsets.delete(id);
            continue;
        }

        const centreMinX = halfWidth + margin;
        const centreMaxX = viewportWidth - halfWidth - margin;
        const centreMinY = halfHeight + band.top;
        const centreMaxY = viewportHeight - halfHeight - band.bottom;
        if (centreMinX > centreMaxX || centreMinY > centreMaxY) {
            out.set(id, HIDDEN_LABEL_POSITION);
            offsets.delete(id);
            continue;
        }

        const fits = (cx: number, cy: number): boolean => {
            // Anchor must stay inside the label box.
            if (Math.abs(cx - anchorX) > halfWidth || Math.abs(cy - anchorY) > halfHeight) {
                return false;
            }
            // Whole box inside the usable band.
            if (
                cx - halfWidth < minX - 0.001 ||
                cx + halfWidth > maxX + 0.001 ||
                cy - halfHeight < minY - 0.001 ||
                cy + halfHeight > maxY + 0.001
            ) {
                return false;
            }
            for (const p of placed) {
                if (labelsCollide(cx, cy, halfWidth, halfHeight, p.x, p.y, p.halfW, p.halfH, pad)) {
                    return false;
                }
            }
            return true;
        };

        // Hysteresis: reuse the previous nudge when it is still legal.
        const prev = offsets.get(id);
        let chosen: [number, number] | null = null;
        if (prev) {
            const hx = anchorX + prev[0];
            const hy = anchorY + prev[1];
            if (fits(hx, hy)) chosen = [hx, hy];
        }

        if (!chosen) {
            for (const [sx, sy] of NUDGE_ORDER) {
                const cx = anchorX + sx * halfWidth;
                const cy = anchorY + sy * halfHeight;
                // Also allow the viewport-clamped centre (same as resolveLabelPosition)
                // when a pure grid nudge would overshoot the band.
                const candidates: Array<[number, number]> = [[cx, cy]];
                if (sx === 0 && sy === 0) {
                    const clampedX = Math.min(Math.max(anchorX, centreMinX), centreMaxX);
                    const clampedY = Math.min(Math.max(anchorY, centreMinY), centreMaxY);
                    if (clampedX !== cx || clampedY !== cy) {
                        candidates.push([clampedX, clampedY]);
                    }
                }
                for (const [tx, ty] of candidates) {
                    if (fits(tx, ty)) {
                        chosen = [tx, ty];
                        break;
                    }
                }
                if (chosen) break;
            }
        }

        if (!chosen) {
            out.set(id, HIDDEN_LABEL_POSITION);
            offsets.delete(id);
            continue;
        }

        out.set(id, chosen);
        offsets.set(id, [chosen[0] - anchorX, chosen[1] - anchorY]);
        placed.push({ id, x: chosen[0], y: chosen[1], halfW: halfWidth, halfH: halfHeight });
    }
}
