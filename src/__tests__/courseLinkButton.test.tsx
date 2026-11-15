/**
 * The course link the panels show (components/CourseLinkButton), the roadmap
 * report that lists them, and the markdown export.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { CourseLinkButton } from '../components/CourseLinkButton';
import { RoadmapReport } from '../components/reports/RoadmapReport';
import { reportToMarkdown } from '../utils/reportExport';
import type { RoadmapResult } from '../utils/analysis';

const dom = (html: string) => new JSDOM(html).window.document;
const COURSE = { href: 'https://www.coursera.org/learn/ai-for-everyone', kind: 'course' as const, label: 'Open course' };
const SEARCH = { href: 'https://www.coursera.org/search?query=Made%20Up', kind: 'search' as const, label: 'Search on Coursera' };

describe('CourseLinkButton', () => {
    it('a checked link says "Open course" and opens in a new tab, safely', () => {
        const a = dom(renderToStaticMarkup(<CourseLinkButton link={COURSE} courseTitle="AI For Everyone" />)).querySelector('a')!;
        expect(a.textContent).toBe('Open course');
        expect(a.getAttribute('href')).toBe(COURSE.href);
        expect(a.getAttribute('target')).toBe('_blank');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        expect(a.getAttribute('data-kind')).toBe('course');
        expect(a.getAttribute('aria-label')).toBe('Open course: AI For Everyone (opens in a new tab)');
    });

    it('a fallback says where it searches', () => {
        const a = dom(renderToStaticMarkup(<CourseLinkButton link={SEARCH} courseTitle="Made Up" />)).querySelector('a')!;
        expect(a.textContent).toBe('Search on Coursera');
        expect(a.getAttribute('data-kind')).toBe('search');
    });

    it('shows nothing with no link (older saved answers) or a link that is not https', () => {
        expect(renderToStaticMarkup(<CourseLinkButton courseTitle="X" />)).toBe('');
        expect(renderToStaticMarkup(<CourseLinkButton link={{ ...COURSE, href: 'javascript:alert(1)' }} courseTitle="X" />)).toBe('');
        expect(renderToStaticMarkup(<CourseLinkButton link={{ ...COURSE, href: 'http://www.coursera.org/learn/x' }} courseTitle="X" />)).toBe('');
    });
});

const ROADMAP: RoadmapResult = {
    phases: [{ title: 'Months 1-2', items: ['Step'] }],
    courses: [
        { title: 'AI For Everyone', provider: 'Coursera', link: COURSE },
        { title: 'Made Up', provider: 'Coursera', link: SEARCH },
    ],
    resources: [{ category: 'Tools & Platforms', items: ['Excel'] }],
    successMetrics: ['Metric'],
};

describe('roadmap report', () => {
    it('lists the courses with their links, above the other resources', () => {
        const doc = dom(renderToStaticMarkup(<RoadmapReport result={ROADMAP} />));
        const links = [...doc.querySelectorAll('[data-testid="course-link"]')].map((a) => [a.textContent, a.getAttribute('href')]);
        expect(links).toEqual([['Open course', COURSE.href], ['Search on Coursera', SEARCH.href]]);
        expect(doc.body.textContent).toContain('Courses & Certifications');
        expect(doc.body.textContent).toContain('Tools & Platforms');
    });

    it('an older saved roadmap (courses as text under resources) still shows, with no links', () => {
        const old = { ...ROADMAP, courses: undefined, resources: [{ category: 'Courses & Certifications', items: ['CPA Exam Review'] }] };
        const doc = dom(renderToStaticMarkup(<RoadmapReport result={old} />));
        expect(doc.body.textContent).toContain('CPA Exam Review');
        expect(doc.querySelectorAll('a')).toHaveLength(0);
    });

    it('the markdown export carries the checked links', () => {
        const md = reportToMarkdown({ id: 'r1', kind: 'roadmap', jobId: 'soc:13-2011', jobTitle: 'Accountants', cacheKey: 'k', payload: ROADMAP, updatedAt: '2026-11-15T00:00:00Z' });
        expect(md).toContain('- [AI For Everyone](https://www.coursera.org/learn/ai-for-everyone) · Coursera (Open course)');
        expect(md).toContain('- [Made Up](https://www.coursera.org/search?query=Made%20Up) · Coursera (Search on Coursera)');
    });
});
