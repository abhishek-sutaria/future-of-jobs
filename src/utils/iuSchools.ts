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

/** Short names for the school's chip ("Kelley · 12 jobs here"); any other school shows its full name. */
export const SCHOOL_SHORT_NAMES: Readonly<Record<string, string>> = {
    coas: 'Arts & Sciences',
    eskenazi: 'Eskenazi',
    'hamilton-lugar': 'Hamilton Lugar',
    jacobs: 'Jacobs',
    kelley: 'Kelley',
    luddy: 'Luddy',
    maurer: 'Maurer',
    media: 'Media School',
    oneill: 'O’Neill',
    education: 'Education',
    medicine: 'Medicine',
    nursing: 'Nursing',
    optometry: 'Optometry',
    'public-health': 'Public Health',
    'social-work': 'Social Work',
};

export const schoolShortName = (school: { id: string; name: string }): string => SCHOOL_SHORT_NAMES[school.id] ?? school.name;

/**
 * The roles that stand out in a scope (the whole map, a family or a field):
 * exactly the peaks drawn at full colour there, one per role, so a Kelley code
 * shared by two titles counts twice, as it stands twice on the map.
 */
export function highlightedRoles<T extends { kind: RoleKind; soc: string }>(roles: readonly T[], h: Highlight, inScope: (role: T) => boolean = () => true): T[] {
    return roles.filter((r) => inScope(r) && isHighlighted(h, r));
}

/**
 * The one count a school shows everywhere (its menu row, its chip at the
 * world, the list's rows, the screen-reader note): the roles it picks out on
 * the whole map, one per peak, so a SOC held by two Kelley titles counts twice.
 */
export function schoolRoleCount(school: Pick<IuSchool, 'jobs'> | SchoolFilter, roles: readonly { kind: RoleKind; soc: string }[]): number {
    const socs = 'socs' in school ? school.socs : new Set(school.jobs);
    let n = 0;
    for (const r of roles) if (socs.has(r.soc)) n++;
    return n;
}

/** How many of `socs` (an occupation list: the world, a family or a field) the school's jobs include. */
export function countMatches(school: SchoolFilter, socs: Iterable<string>): number {
    let n = 0;
    for (const soc of socs) if (school.socs.has(soc)) n++;
    return n;
}
