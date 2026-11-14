import type { LevelKind } from './worldLevel';

/**
 * Which labels the world shows. Kept pure, like labelLayout, so it can be
 * tested without a camera: at the world they follow the zoom, which
 * world/CameraRig feeds in once per frame; a family and a field have a fixed
 * set whatever the zoom. Everything else reads the result from the store.
 *
 * Zoom is a ratio against the whole-world framing (1 = the default view, 2 =
 * twice as close), not a camera distance: that framing sits 83 units out on a
 * desktop and 112 on a phone, and one threshold has to mean the same on both.
 */

/**
 * The zoom at which the 22 field names replace the five family names. Low on
 * purpose: past about 1.2 a 1470x801 screen starts losing the near row of
 * fields under the year slider, and all 22 should arrive together.
 */
export const FIELD_LABEL_ZOOM = 1.12;
/** Field names come in this far above FIELD_LABEL_ZOOM and go this far below it, so stopping near it cannot flicker. */
export const FIELD_LABEL_ZOOM_BUFFER = 0.03;
/** Zoom the Kelley filter flies the whole world to: clear of the buffer, so its job labels always end up on screen. */
export const FIELD_ARRIVAL_ZOOM = FIELD_LABEL_ZOOM + 2 * FIELD_LABEL_ZOOM_BUFFER;
/** Each half of the crossfade, in ms. Must match the .foj-label-fade timings in index.css. */
export const LABEL_FADE_MS = 140;

export interface LabelDecision {
    level: 'broad' | 'fields' | 'family' | 'field';
    /** The five BLS family names. */
    families: boolean;
    /** Field names: all 22 at the world, the ones on stage otherwise. */
    fields: boolean;
    /** Job labels may show (which ones is still WorldMarkers' call). */
    jobs: boolean;
}

export const BROAD_LABELS: LabelDecision = { level: 'broad', families: true, fields: false, jobs: false };
export const FIELD_LABELS: LabelDecision = { level: 'fields', families: false, fields: true, jobs: true };
/** Inside a family: its field names. Job labels only come with the Kelley filter, or on hover. */
export const FAMILY_LEVEL_LABELS: LabelDecision = { level: 'family', families: false, fields: true, jobs: false };
/** Inside a field: its own name and its job labels. */
export const FIELD_LEVEL_LABELS: LabelDecision = { level: 'field', families: false, fields: true, jobs: true };

/** The labels for `zoom`, given the ones showing now. Between the two switch points the current set stays. */
export function decideLabels(zoom: number, current: LabelDecision): LabelDecision {
    if (!Number.isFinite(zoom)) return current;
    if (zoom >= FIELD_LABEL_ZOOM + FIELD_LABEL_ZOOM_BUFFER) return FIELD_LABELS;
    if (zoom <= FIELD_LABEL_ZOOM - FIELD_LABEL_ZOOM_BUFFER) return BROAD_LABELS;
    return current;
}

/** The labels a level calls for. Only the world looks at the zoom. */
export function labelsAt(kind: LevelKind, zoom: number, current: LabelDecision): LabelDecision {
    if (kind === 'family') return FAMILY_LEVEL_LABELS;
    if (kind === 'field') return FIELD_LEVEL_LABELS;
    return decideLabels(zoom, current === FIELD_LABELS ? FIELD_LABELS : BROAD_LABELS);
}
