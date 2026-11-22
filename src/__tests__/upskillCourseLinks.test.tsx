// @vitest-environment jsdom
/**
 * Defend / Build (components/UpskillModal) shows only direct course links. An
 * answer saved before 2026-11-22 may still hold a search link: that course
 * shows its name as plain text, with no link and no search text.
 */

import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const COURSE = { href: 'https://www.coursera.org/learn/ai-for-everyone', kind: 'course', label: 'Open course' };
const OLD_SEARCH = { href: 'https://www.coursera.org/search?query=Made%20Up', kind: 'search', label: 'Search on Coursera' };
const OLD_WEB = { href: 'https://www.google.com/search?q=%22Old%20Web%22', kind: 'search', label: 'Search the web' };

const saved = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../utils/analysis', () => ({
    generateUpskillCourses: () => Promise.resolve({ result: saved.result }),
}));

import { UpskillModal } from '../components/UpskillModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function show(courses: unknown[]) {
    saved.result = { courses, whyTheseCourses: 'Because.' };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
        root.render(<UpskillModal isOpen onClose={() => {}} jobId="soc:13-2011" jobTitle="Accountants and Auditors" taskName="Prepare tax returns" mode="defend" aiRiskPercent={70} />);
    });
    // The modal loads its answer through a dynamic import: wait for the list (or give up after 2 s).
    for (let i = 0; i < 100 && !el.ownerDocument.body.textContent?.includes('Because.'); i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    expect(document.body.textContent).toContain('Because.');
    const text = document.body.textContent ?? '';
    const links = [...document.body.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    act(() => root.unmount());
    el.remove();
    return { text, links };
}

describe('Defend / Build course list', () => {
    it('an old saved answer with search links: every name stays, only the checked course is a link', async () => {
        const { text, links } = await show([
            { title: 'AI For Everyone', provider: 'Coursera', duration: '6 hours', level: 'Beginner', link: COURSE },
            { title: 'Made Up', provider: 'Coursera', duration: '4 weeks', level: 'Intermediate', link: OLD_SEARCH },
            { title: 'Old Web', provider: 'Nowhere', duration: '1 week', level: 'Beginner', link: OLD_WEB },
            { title: 'No Link Course', provider: 'edX', duration: '2 weeks', level: 'Advanced' },
        ]);
        expect(text).toContain('AI For Everyone');
        expect(text).toContain('Made Up');
        expect(text).toContain('Old Web');
        expect(text).toContain('No Link Course');
        expect(links).toEqual([['Open course', COURSE.href]]);
        expect(text).not.toMatch(/search/i);
    });

    it('no direct link at all: the names show, with no link and no search hint', async () => {
        const { text, links } = await show([
            { title: 'Made Up', provider: 'Coursera', duration: '4 weeks', level: 'Intermediate', link: OLD_SEARCH },
            { title: 'No Link Course', provider: 'edX', duration: '2 weeks', level: 'Advanced' },
        ]);
        expect(text).toContain('Made Up');
        expect(text).toContain('No Link Course');
        expect(links).toEqual([]);
        expect(text).not.toMatch(/search/i);
    });
});
