/**
 * How the hidden IU school filter shows on screen, as pure functions: where the
 * school list opens, the school chip's words, a job's risk in the chip's list,
 * the crimson rings' pulse, and what a filter does to one world peak. The
 * components (SchoolPicker, SchoolJobs, world/SchoolRings, world/WorldTerrain)
 * only draw what these say, and schoolJobs.test.tsx checks them.
 */

import { isHighlighted, schoolShortName, type Highlight } from './iuSchools';
import type { RoleKind } from './roles';
import { percentOf } from './scoreRounding';

/** Gap between the school button and its list, in px (Tailwind mt-1.5 / mb-1.5). */
export const LIST_GAP = 6;

/**
 * Where the school list opens: below the button, or above it only when it does
 * not fit below and there is more room above. Never over the button itself.
 */
export function listPlacement(trigger: { top: number; bottom: number }, listHeight: number, viewportHeight: number): 'below' | 'above' {
    const below = viewportHeight - trigger.bottom - LIST_GAP;
    const above = trigger.top - LIST_GAP;
    return below >= listHeight || below >= above ? 'below' : 'above';
}

/** The chip's words: "Kelley · 12 jobs here" in a family or field, "Kelley · 26 jobs" at the world. */
export function schoolChipLabel(school: { id: string; name: string }, count: number, atWorld: boolean): string {
    return `${schoolShortName(school)} · ${count} ${count === 1 ? 'job' : 'jobs'}${atWorld ? '' : ' here'}`;
}

/** A role's line in the list: its risk as the app shows it everywhere (whole percent, halves up), or "Not scored". */
export function riskText(risk: number | null): string {
    return risk == null ? 'Not scored' : `${percentOf(risk)}% AI exposure`;
}

/** One pulse of the crimson rings, in seconds: slow enough to read as a glow, not a blink. */
export const SCHOOL_RING_PULSE_SECONDS = 1.8;

/** How bright the rings are this frame, 0 to 1. Steady under reduced motion. */
export function ringPulse(seconds: number, reduced: boolean): number {
    if (reduced) return 0.5;
    return 0.5 + 0.5 * Math.sin((seconds / SCHOOL_RING_PULSE_SECONDS) * Math.PI * 2);
}

/** How far a world peak outside the Kelley filter fades toward the ground colour. */
export const WORLD_DIM_EMPHASIS = 0.22;

/**
 * What each filter does to one world peak: the Kelley filter dims what it
 * leaves out (emphasis, exactly as before the school filter), the IU school
 * greys and sinks what it leaves out (out = 1).
 */
export function peakFilterTargets(h: Highlight, role: { kind: RoleKind; soc: string }): { emphasis: number; out: 0 | 1 } {
    return {
        emphasis: isHighlighted({ kelleyOnly: h.kelleyOnly, school: null }, role) ? 1 : WORLD_DIM_EMPHASIS,
        out: h.school && !h.school.socs.has(role.soc) ? 1 : 0,
    };
}
