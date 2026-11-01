/**
 * The three levels of the 3D view and every way of moving between them, kept
 * pure so they can be tested without a camera or a store. World shows all five
 * families, a family only its block, a field only its peaks.
 *
 * A field's family always comes from familyOf: config/socFamilies is the one
 * place that says which field is in which family.
 */

import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { familyOf, SOC_FAMILIES } from '../config/socFamilies';
import { INDEX_CONTINENTS } from './occupationIndex';

/** The same two values worldStore holds, so a transition's result can be set on it directly. */
export interface WorldLevel {
    /** SocFamily.id of the open family; also set while one of its fields is open. */
    focusedFamily: number | null;
    /** Two-digit SOC major code of the open field. */
    focusedContinent: string | null;
}

export type LevelKind = 'world' | 'family' | 'field';

export const WORLD_LEVEL: WorldLevel = { focusedFamily: null, focusedContinent: null };

export const familyLevel = (id: number): WorldLevel => ({ focusedFamily: id, focusedContinent: null });

export const fieldLevel = (code: string): WorldLevel => ({ focusedFamily: familyOf(code).id, focusedContinent: code });

export const levelKind = (l: WorldLevel): LevelKind =>
    l.focusedContinent ? 'field' : l.focusedFamily != null ? 'family' : 'world';

/** One level up: a field to its family, a family to the world. The world stays where it is. */
export const levelUp = (l: WorldLevel): WorldLevel =>
    l.focusedContinent ? familyLevel(familyOf(l.focusedContinent).id) : WORLD_LEVEL;

/** Whether a field is on stage at this level. Everything else fades away and takes no input. */
export function isOnStage(l: WorldLevel, code: string): boolean {
    if (l.focusedContinent) return code === l.focusedContinent;
    if (l.focusedFamily != null) return familyOf(code).id === l.focusedFamily;
    return true;
}

export interface Crumb {
    key: string;
    label: string;
    /** Where this crumb goes. */
    level: WorldLevel;
    /** The level on screen: plain text, not a button. */
    current: boolean;
}

/** All families › family › field, up to the current level. Empty at the world, which has nothing above it. */
export function breadcrumbs(l: WorldLevel): Crumb[] {
    const kind = levelKind(l);
    if (kind === 'world') return [];
    const family = SOC_FAMILIES.find((f) => f.id === l.focusedFamily)!;
    const crumbs: Crumb[] = [
        { key: 'world', label: 'All families', level: WORLD_LEVEL, current: false },
        { key: 'family', label: family.shortName, level: familyLevel(family.id), current: kind === 'family' },
    ];
    if (l.focusedContinent) {
        crumbs.push({ key: 'field', label: CONTINENT_DISPLAY_NAMES[l.focusedContinent], level: l, current: true });
    }
    return crumbs;
}

/** The sentence the aria-live region reads out for this level. */
export function levelAnnouncement(l: WorldLevel, showingFields: boolean): string {
    const family = SOC_FAMILIES.find((f) => f.id === l.focusedFamily);
    if (l.focusedContinent) {
        return `${CONTINENT_DISPLAY_NAMES[l.focusedContinent]} field, in ${family!.shortName}. Back or Escape goes up to the family.`;
    }
    if (family) {
        return `${family.shortName} family, ${familySummary(family.id).fields} fields. Pick one from the fields menu. Back or Escape goes up to all families.`;
    }
    return showingFields
        ? 'Zoomed in: field names are showing. Pick any of the 22 fields from the fields menu.'
        : 'Zoomed out: the five job families are showing.';
}

export interface FamilySummary {
    /** All workers in 2025: the plain sum of its fields' BLS EP summary rows. */
    workers: number;
    fields: number;
    occupations: number;
}

/** A family's info line, as plain sums of its fields' published BLS figures. */
export function familySummary(id: number): FamilySummary {
    const fields = INDEX_CONTINENTS.filter((c) => familyOf(c.code).id === id);
    return {
        workers: fields.reduce((sum, c) => sum + c.ep.employment2025, 0),
        fields: fields.length,
        occupations: fields.reduce((sum, c) => sum + c.occupationCount, 0),
    };
}

/** Zooming out by hand past this many times the level's framing distance goes up one level. */
export const ZOOM_OUT_RATIO = 1.25;
/** Quiet time after a flight lands before the rule can fire, so a trackpad's coasting scroll cannot climb a second level. */
export const ZOOM_OUT_SETTLE_MS = 350;

/** Whether a hand zoom has left this level. Never during a flight, at the world, or before the camera has settled. */
export function zoomedOutOfLevel(kind: LevelKind, distance: number, framingDistance: number, flying: boolean, settled: boolean): boolean {
    if (kind === 'world' || flying || !settled) return false;
    return distance > framingDistance * ZOOM_OUT_RATIO;
}

export interface OpenLayers {
    panel: boolean;
    modal: boolean;
    picker: boolean;
}

/** Esc goes up one level, unless something on top of the map is open: that keeps its own Esc. */
export function escapeGoesUp(l: WorldLevel, open: OpenLayers): boolean {
    return levelKind(l) !== 'world' && !open.panel && !open.modal && !open.picker;
}

export interface PeakHit {
    key: string;
    /** The field the peak is in. */
    code: string;
}

export interface StageHit {
    label: { kind: 'family'; id: number } | { kind: 'field'; code: string } | ({ kind: 'peak' } & PeakHit) | null;
    peak: PeakHit | null;
    /** The field under the pointer on the ground. */
    ground: string | null;
}

export interface ClickContext {
    /** The 22 field names are showing, rather than the five family names. */
    fieldNames: boolean;
    touch: boolean;
    tappedKey: string | null;
    labelledKeys: ReadonlySet<string>;
}

export type ClickAction =
    | { kind: 'family'; id: number }
    | { kind: 'field'; code: string }
    | { kind: 'role'; key: string }
    /** Touch has no hover: the first tap on an unlabelled peak names it. */
    | { kind: 'reveal'; key: string }
    | null;

/**
 * What a click or tap does. Anything off stage counts as a miss, so the empty
 * area around a family or field does nothing.
 */
export function clickAction(l: WorldLevel, hit: StageHit, ctx: ClickContext): ClickAction {
    const kind = levelKind(l);
    const { label } = hit;
    if (label?.kind === 'family') return kind === 'world' ? { kind: 'family', id: label.id } : null;
    if (label?.kind === 'field') return isOnStage(l, label.code) ? { kind: 'field', code: label.code } : null;
    if (label?.kind === 'peak' && !isOnStage(l, label.code)) return null;
    // A hovered peak has a label too, but it is only naming itself: in a family
    // that is a click on the field, and only a Kelley label opens its job.
    if (label?.kind === 'peak' && (kind !== 'family' || ctx.labelledKeys.has(label.key))) return { kind: 'role', key: label.key };
    if (label?.kind === 'peak') return { kind: 'field', code: label.code };

    if (hit.peak && isOnStage(l, hit.peak.code)) {
        // A family's unlabelled peaks only name themselves: a click there is a click on the field.
        if (kind === 'family') return { kind: 'field', code: hit.peak.code };
        const { key } = hit.peak;
        return ctx.touch && ctx.tappedKey !== key && !ctx.labelledKeys.has(key) ? { kind: 'reveal', key } : { kind: 'role', key };
    }

    if (!hit.ground || !isOnStage(l, hit.ground) || kind === 'field') return null;
    return kind === 'world' && !ctx.fieldNames ? { kind: 'family', id: familyOf(hit.ground).id } : { kind: 'field', code: hit.ground };
}
