/**
 * The one rule for showing a course link in the browser: only a link the
 * server checked as the course's own page (kind 'course', https). Anything
 * else, including a search link kept in an older saved answer (before
 * 2026-11-22), gets no link: the course name shows as plain text.
 */
export function directCourseHref(link: unknown): string | null {
    if (!link || typeof link !== 'object') return null;
    const { kind, href } = link as { kind?: unknown; href?: unknown };
    if (kind !== 'course' || typeof href !== 'string' || !href.startsWith('https://')) return null;
    try {
        return new URL(href).protocol === 'https:' ? href : null;
    } catch {
        return null;
    }
}
