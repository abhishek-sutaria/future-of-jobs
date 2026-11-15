import React from 'react';
import type { CourseLink } from '../utils/analysis';
import { IconExternalLink, IconSearch } from './ui/Icons';

/**
 * The link under a recommended course. The server checked it
 * (shared/courseLinks): "Open course" opens the course's own page; a search
 * link says where it searches. Opens in a new tab. Shows nothing for a link
 * that is missing or not https (an older saved answer has none).
 */
export const CourseLinkButton: React.FC<{ link?: CourseLink; courseTitle: string; className?: string }> = ({ link, courseTitle, className = '' }) => {
    if (!link || typeof link.href !== 'string' || !link.href.startsWith('https://')) return null;
    const direct = link.kind === 'course';
    return (
        <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="course-link"
            data-kind={direct ? 'course' : 'search'}
            aria-label={`${link.label}: ${courseTitle} (opens in a new tab)`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 sm:py-1.5 min-h-[40px] sm:min-h-0 text-xs font-semibold whitespace-nowrap transition-colors print:hidden ${
                direct
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200'
                    : 'border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.08] hover:text-white'
            } ${className}`}
        >
            {direct ? <IconExternalLink size={12} /> : <IconSearch size={12} />}
            {link.label}
        </a>
    );
};
