/**
 * labelLayout.ts
 * --------------
 * Screen-space placement maths for the floating role labels.
 *
 * Kept pure (no three.js, no DOM) so it can be unit-tested the way the rest of
 * this repo tests logic. JobMarkers feeds it the projected position of a peak.
 */

/**
 * Nudge a label horizontally so its box stays inside the viewport.
 *
 * `x` is the projected centre of the label in CSS pixels; drei renders the
 * label centred on it, so the box spans `x ± halfWidth`. A peak near the left
 * or right edge would otherwise render its label half off-screen (observed on
 * production at 393px and 412px wide, where a label sat at left: -13px).
 *
 * When a label is wider than the viewport there is no position that fits, so
 * it is centred rather than being pinned to an arbitrary edge.
 */
export function clampLabelCenterX(
    x: number,
    halfWidth: number,
    viewportWidth: number,
    margin = 4,
): number {
    const min = halfWidth + margin;
    const max = viewportWidth - halfWidth - margin;
    if (min > max) return viewportWidth / 2;
    return Math.min(Math.max(x, min), max);
}

/** Same idea vertically, keeping a label clear of the top and bottom edges. */
export function clampLabelCenterY(
    y: number,
    halfHeight: number,
    viewportHeight: number,
    margin = 4,
): number {
    const min = halfHeight + margin;
    const max = viewportHeight - halfHeight - margin;
    if (min > max) return viewportHeight / 2;
    return Math.min(Math.max(y, min), max);
}
