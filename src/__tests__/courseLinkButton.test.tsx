/**
 * The course link the panels show (components/CourseLinkButton), the roadmap
 * report that lists them, and the markdown export (the Defend / Build list:
 * upskillCourseLinks.test.tsx).
 * Only a checked course page is ever a link; a course without one is its name
 * as plain text. Older saved answers (before 2026-11-22) may still hold a
 * search link: those must show no link at all.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { CourseLinkButton } from '../components/CourseLinkButton';
import { RoadmapReport } from '../components/reports/RoadmapReport';
import { reportToMarkdown } from '../utils/reportExport';
import { directCourseHref } from '../utils/courseLink';
import type { CourseLink, RoadmapResult } from '../utils/analysis';

const dom = (html: string) => new JSDOM(html).window.document;
const COURSE: CourseLink = { href: 'https://www.coursera.org/learn/ai-for-everyone', kind: 'course', label: 'Open course' };
/** What answers saved before 2026-11-22 may hold. */
const OLD_SEARCH = { href: 'https://www.coursera.org/search?query=Made%20Up', kind: 'search', label: 'Search on Coursera' } as unknown as CourseLink;
const OLD_WEB = { href: 'https://www.google.com/search?q=%22Made%20Up%22', kind: 'search', label: 'Search the web' } as unknown as CourseLink;

describe('CourseLinkButton', () => {
    it('a checked link says "Open course" and opens in a new tab, safely', () => {
        const a = dom(renderToStaticMarkup(<CourseLinkButton link={COURSE} courseTitle="AI For Everyone" />)).querySelector('a')!;
        expect(a.textContent).toBe('Open course');
        expect(a.getAttribute('href')).toBe(COURSE.href);
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        expect(a.getAttribute('aria-label')).toBe('Open course: AI For Everyone (opens in a new tab)');
    });

    it('an old saved search link shows nothing', () => {
        expect(renderToStaticMarkup(<CourseLinkButton link={OLD_SEARCH} courseTitle="Made Up" />)).toBe('');
        expect(renderToStaticMarkup(<CourseLinkButton link={OLD_WEB} courseTitle="Made Up" />)).toBe('');
        // whatever its label says: only kind 'course' counts
        expect(renderToStaticMarkup(<CourseLinkButton link={{ ...OLD_SEARCH, label: 'Open course' }} courseTitle="Made Up" />)).toBe('');
    });

    it('shows nothing with no link or a link that is not https', () => {
        expect(renderToStaticMarkup(<CourseLinkButton courseTitle="X" />)).toBe('');
        expect(renderToStaticMarkup(<CourseLinkButton link={{ ...COURSE, href: 'javascript:alert(1)' }} courseTitle="X" />)).toBe('');
        expect(renderToStaticMarkup(<CourseLinkButton link={{ ...COURSE, href: 'http://www.coursera.org/learn/x' }} courseTitle="X" />)).toBe('');
        expect(renderToStaticMarkup(<CourseLinkButton link={{ ...COURSE, href: 'https://' }} courseTitle="X" />)).toBe('');
    });

    it('directCourseHref: only kind "course" over https', () => {
        expect(directCourseHref(COURSE)).toBe(COURSE.href);
        for (const bad of [OLD_SEARCH, OLD_WEB, null, undefined, 'https://x.org', {}, { kind: 'course' }, { kind: 'course', href: 5 }]) expect(directCourseHref(bad)).toBeNull();
    });
});

const ROADMAP: RoadmapResult = {
    phases: [{ title: 'Months 1-2', items: ['Step'] }],
    courses: [
        { title: 'AI For Everyone', provider: 'Coursera', link: COURSE },
        { title: 'No Link Course', provider: 'edX' },
        { title: 'Made Up', provider: 'Coursera', link: OLD_SEARCH },
    ],
    resources: [{ category: 'Tools & Platforms', items: ['Excel'] }],
    successMetrics: ['Metric'],
};

describe('roadmap report', () => {
    it('links only the checked course; the others, an old saved search link included, are plain names', () => {
        const doc = dom(renderToStaticMarkup(<RoadmapReport result={ROADMAP} />));
        const links = [...doc.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
        expect(links).toEqual([['Open course', COURSE.href]]);
        const text = doc.body.textContent!;
        expect(text).toContain('Courses & Certifications');
        expect(text).toContain('No Link Course');
        expect(text).toContain('Made Up');
        expect(text).toContain('Tools & Platforms');
        expect(text).not.toMatch(/search/i);
    });

    it('a roadmap with no direct link at all still lists the course names, with no search hint', () => {
        const none = { ...ROADMAP, courses: [{ title: 'No Link Course', provider: 'edX' }, { title: 'Made Up', provider: 'Coursera', link: OLD_SEARCH }] };
        const doc = dom(renderToStaticMarkup(<RoadmapReport result={none} />));
        expect(doc.querySelectorAll('a')).toHaveLength(0);
        expect(doc.body.textContent).toContain('No Link Course');
        expect(doc.body.textContent).toContain('Made Up');
        expect(doc.body.textContent).not.toMatch(/search/i);
    });

    it('an older saved roadmap (courses as text under resources) still shows, with no links', () => {
        const old = { ...ROADMAP, courses: undefined, resources: [{ category: 'Courses & Certifications', items: ['CPA Exam Review'] }] };
        const doc = dom(renderToStaticMarkup(<RoadmapReport result={old} />));
        expect(doc.body.textContent).toContain('CPA Exam Review');
        expect(doc.querySelectorAll('a')).toHaveLength(0);
    });

    it('the markdown export carries only direct course links, never a search URL', () => {
        const md = reportToMarkdown({ id: 'r1', kind: 'roadmap', jobId: 'soc:13-2011', jobTitle: 'Accountants', cacheKey: 'k', payload: ROADMAP, updatedAt: '2026-11-15T00:00:00Z' });
        expect(md).toContain('- [AI For Everyone](https://www.coursera.org/learn/ai-for-everyone) · Coursera (Open course)');
        expect(md).toContain('- No Link Course · edX');
        expect(md).toContain('- Made Up · Coursera');
        expect(md).not.toMatch(/search/i);
    });
});
