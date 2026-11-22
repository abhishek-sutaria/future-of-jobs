import React from 'react';
import type { CourseLink } from '../utils/analysis';
import { directCourseHref } from '../utils/courseLink';
import { IconExternalLink } from './ui/Icons';

/**
 * "Open course" under a recommended course: the course's own page, which the
 * server checked (shared/courseLinks). Opens in a new tab. Shows nothing for a
 * course with no checked link, so its name stays plain text; that includes a
 * search link kept in an older saved answer (utils/courseLink).
 */
export const CourseLinkButton: React.FC<{ link?: CourseLink; courseTitle: string; className?: string }> = ({ link, courseTitle, className = '' }) => {
    const href = directCourseHref(link);
    if (!href) return null;
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="course-link"
            aria-label={`Open course: ${courseTitle} (opens in a new tab)`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-0 text-xs font-semibold whitespace-nowrap transition-colors print:hidden border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200 ${className}`}
        >
            <IconExternalLink size={12} />
            Open course
        </a>
    );
};
