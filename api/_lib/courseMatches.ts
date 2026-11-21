/**
 * A job's catalog courses (Step 3), on the server only. The gateway hands them
 * to the Defend / Build and Roadmap prompts and to the link step, which turns
 * each catalog id into its checked catalog page. Jobs with no match get [] and
 * keep the #99 behaviour exactly.
 *
 * The data is api/_lib/courseMatchesData.ts, generated from
 * data/course_catalog/{catalog,matches}.json by scripts/build_course_matches_server.ts.
 */

import type { CatalogCourse } from '../../src/shared/aiPrompts.js';
import { COURSE_MATCHES_DATA } from './courseMatchesData.js';

/** The SOC a role key stands for: "soc:13-2011" directly, a Kelley "job-N" through its title's SOC. */
export function socForRoleKey(roleKey: string, data = COURSE_MATCHES_DATA): string | null {
    const m = roleKey.match(/^soc:(\d\d-\d{4})$/);
    if (m) return m[1];
    return data.kelley[roleKey] ?? null;
}

/** The job's matched catalog courses, in Step 2's order (most useful first); [] if none. */
export function matchedCoursesFor(roleKey: string, data = COURSE_MATCHES_DATA): CatalogCourse[] {
    const soc = socForRoleKey(roleKey, data);
    if (!soc) return [];
    return (data.jobs[soc] ?? []).flatMap((m) => {
        const c = data.courses[m.id];
        return c ? [{ id: m.id, ...c, reason: m.reason }] : [];
    });
}
