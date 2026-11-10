/**
 * The hidden IU school filter's data: each IU Bloomington school with at least
 * one job, and the SOC codes of the jobs its degree programs lead to
 * (src/data/iu_school_jobs.json, built by scripts/build_iu_schools.ts; method
 * and gaps in docs/iu-schools.md). Loaded only when the filter is first
 * opened, so the main bundle never carries it.
 */

import type { RoleKind } from './roles';

export interface IuSchool {
    id: string;
    name: string;
    /** App occupations (SOC codes) the school's programs lead to. */
    jobs: readonly string[];
}

/** The school filter in force: a school and its jobs as a set. */
export interface SchoolFilter {
    id: string;
    name: string;
    socs: ReadonlySet<string>;
}

export const schoolFilterOf = (school: IuSchool): SchoolFilter => ({ id: school.id, name: school.name, socs: new Set(school.jobs) });

let loading: Promise<IuSchool[]> | null = null;

/** The schools, loaded once. A failed load can be tried again. */
export function loadIuSchools(): Promise<IuSchool[]> {
    loading ??= import('../data/iu_school_jobs.json')
        .then((m) => (m.default as { schools: IuSchool[] }).schools)
        .catch((err: unknown) => {
            loading = null;
            throw err;
        });
    return loading;
}

/**
 * Which roles stand out on the map: the Kelley filter (its 50 titles) and the
 * school filter (its jobs) together. A role stands out only if it passes both.
 */
export interface Highlight {
    kelleyOnly: boolean;
    school: SchoolFilter | null;
}

export const highlightOn = (h: Highlight): boolean => h.kelleyOnly || h.school !== null;

export const isHighlighted = (h: Highlight, role: { kind: RoleKind; soc: string }): boolean =>
    (!h.kelleyOnly || role.kind === 'kelley') && (!h.school || h.school.socs.has(role.soc));

/** A short key for "what is highlighted", to tell when a bake or a view must change. */
export const highlightKey = (h: Highlight): string => `${h.kelleyOnly ? 'k' : ''}|${h.school?.id ?? ''}`;

/** How many of `socs` (an occupation list: the world, a family or a field) the school's jobs include. */
export function countMatches(school: SchoolFilter, socs: Iterable<string>): number {
    let n = 0;
    for (const soc of socs) if (school.socs.has(soc)) n++;
    return n;
}
