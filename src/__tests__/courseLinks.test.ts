/**
 * Course links (shared/courseLinks.ts): every link Claude gives is checked on
 * the server before anyone sees it. One that fails any check is dropped: the
 * course keeps its name and gets no link (no search fallback since
 * 2026-11-22). fetch is mocked: no network here.
 */

import { describe, it, expect } from 'vitest';
import {
    checkCourseUrl,
    linkCourse,
    linkCourses,
    providerOfUrl,
    titleMatch,
    urlProblem,
    type FetchLike,
} from '../shared/courseLinks';
import { AI_FEATURES } from '../shared/aiFeatures';
import { buildRoadmapPrompt, buildUpskillPrompt } from '../shared/aiPrompts';

const COURSE = 'https://www.coursera.org/learn/ai-for-everyone';
const page = (title: string, h1 = title) =>
    `<!doctype html><html><head><title>${title}</title><meta property="og:title" content="${title}"></head><body><h1>${h1}</h1></body></html>`;
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (location: string, status = 301) => new Response(null, { status, headers: { location } });

/** A fetch that answers by URL; anything else is a network error. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): FetchLike & { calls: string[] } {
    const calls: string[] = [];
    const f = (async (url: string) => {
        calls.push(url);
        const route = routes[url];
        if (!route) throw new TypeError('fetch failed');
        return route();
    }) as FetchLike & { calls: string[] };
    f.calls = calls;
    return f;
}

describe('checking one link', () => {
    it('a good link: https, on the list, loads, title names the course → "Open course"', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('AI For Everyone | Coursera')) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toEqual({ ok: true, href: COURSE });
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: COURSE }, { fetch });
        expect(linked.link).toEqual({ href: COURSE, kind: 'course', label: 'Open course' });
    });

    it('a 404 → no link at all: the course keeps its name, with no link field', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('Page Not Found'), 404) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toMatchObject({ ok: false, reason: 'status 404' });
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: COURSE }, { fetch });
        expect(linked).toEqual({ title: 'AI For Everyone', provider: 'Coursera' });
        expect('link' in linked).toBe(false);
    });

    it('a "not found" page served with a 200 → no link', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('Course not found | Coursera', 'This course is no longer available')) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toMatchObject({ ok: false, reason: 'a "not found" page' });
    });

    it('a redirect to the home page → no link (and the home page is never fetched)', async () => {
        const fetch = fakeFetch({ [COURSE]: () => redirect('https://www.coursera.org/') });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toMatchObject({ ok: false, reason: 'redirects to a home page' });
        expect(fetch.calls).toEqual([COURSE]);
    });

    it('a redirect to a search or sign-in page, or off the list → no link', async () => {
        for (const [to, reason] of [
            ['/search?query=ai', 'redirects to a search page'],
            ['https://www.linkedin.com/authwall?trk=1', 'redirects to a not a course page on this site'],
            ['https://evil.example/course', 'redirects to a not on the provider list'],
            ['http://www.coursera.org/learn/ai-for-everyone', 'redirects to a not https'],
        ]) {
            const fetch = fakeFetch({ [COURSE]: () => redirect(to, 302) });
            expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toEqual({ ok: false, reason });
        }
    });

    it('follows a good redirect and links the page it lands on', async () => {
        const moved = 'https://www.coursera.org/learn/ai-for-everyone-2026';
        const fetch = fakeFetch({ [COURSE]: () => redirect(moved), [moved]: () => html(page('AI For Everyone | Coursera')) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toEqual({ ok: true, href: moved });
    });

    it('stops after 5 redirects', async () => {
        const fetch = fakeFetch({ [COURSE]: () => redirect(COURSE) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toEqual({ ok: false, reason: 'too many redirects' });
        expect(fetch.calls).toHaveLength(6);
    });

    it('a page whose title is a different course → no link', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('Introduction to Python Programming | Coursera')) });
        const r = await checkCourseUrl(COURSE, 'Financial Accounting Fundamentals', { fetch });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toMatch(/^title does not match \(0%/);
    });

    it('a link that does not answer in time → no link, after about the timeout', async () => {
        const fetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        const t0 = Date.now();
        const r = await checkCourseUrl(COURSE, 'AI For Everyone', { fetch, timeoutMs: 50 });
        expect(r).toEqual({ ok: false, reason: 'timed out' });
        expect(Date.now() - t0).toBeLessThan(1000);
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: COURSE }, { fetch, timeoutMs: 50 });
        expect('link' in linked).toBe(false);
    });

    it('a domain not on the list is never fetched → no link', async () => {
        const fetch = fakeFetch({});
        for (const url of ['https://free-courses.example/learn/ai', 'https://coursera.org.evil.example/learn/ai', 'https://notcoursera.org/learn/ai']) {
            expect(await checkCourseUrl(url, 'AI For Everyone', { fetch })).toEqual({ ok: false, reason: 'not on the provider list' });
        }
        expect(fetch.calls).toEqual([]);
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: 'https://free-courses.example/learn/ai' }, { fetch });
        expect('link' in linked).toBe(false);
    });

    it('an unknown provider → no link (never a web search), and nothing is fetched', async () => {
        const fetch = fakeFetch({});
        const linked = await linkCourse({ title: 'Advanced Widget Auditing', provider: 'Widget Academy', url: 'https://widget.example/course/1' }, { fetch });
        expect(linked).toEqual({ title: 'Advanced Widget Auditing', provider: 'Widget Academy' });
        expect(fetch.calls).toEqual([]);
    });

    it('a network error, a non-HTML file, or a page with no title → no link', async () => {
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch: fakeFetch({}) })).toMatchObject({ ok: false, reason: 'failed to load (fetch failed)' });
        const pdf = fakeFetch({ [COURSE]: () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }) });
        expect((await checkCourseUrl(COURSE, 'AI For Everyone', { fetch: pdf })).ok).toBe(false);
        const blank = fakeFetch({ [COURSE]: () => html('<html><body>hi</body></html>') });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch: blank })).toEqual({ ok: false, reason: 'page has no title' });
    });
});

describe('the URL rules (no fetch)', () => {
    it('only https, no credentials or odd ports', () => {
        expect(urlProblem('http://www.coursera.org/learn/x')).toBe('not https');
        expect(urlProblem('https://a:b@www.coursera.org/learn/x')).toBe('carries credentials');
        expect(urlProblem('https://www.coursera.org:8443/learn/x')).toBe('unusual port');
        expect(urlProblem('not a url')).toBe('not a URL');
        expect(urlProblem('javascript:alert(1)')).toBe('not https');
    });

    it('home, search, listing, topic and sign-in pages are never course pages', () => {
        expect(urlProblem('https://www.coursera.org/')).toBe('home page');
        expect(urlProblem('https://learn.microsoft.com/en-us/')).toBe('home page');
        expect(urlProblem('https://www.coursera.org/search?query=ai')).toBe('search page');
        expect(urlProblem('https://www.coursera.org/courses?query=ai')).toBe('search page');
        expect(urlProblem('https://learn.microsoft.com/en-us/training/')).toBe('listing page');
        expect(urlProblem('https://www.coursera.org/browse/business')).toBe('listing or article page');
        expect(urlProblem('https://www.coursera.org/articles/what-is-pmp')).toBe('listing or article page');
        expect(urlProblem('https://www.edx.org/learn/project-management')).toBe('topic page');
        expect(urlProblem('https://www.linkedin.com/in/someone')).toBe('not a course page on this site');
        expect(urlProblem('https://www.linkedin.com/learning/')).toBe('listing page');
        expect(urlProblem('https://www.udemy.com/join/login-popup/')).toBe('sign-in or error page');
    });

    it('real course pages pass', () => {
        for (const url of [
            COURSE,
            'https://www.coursera.org/professional-certificates/google-data-analytics',
            'https://www.edx.org/learn/project-management/rochester-institute-of-technology-project-management',
            'https://www.linkedin.com/learning/excel-essential-training-microsoft-365-17231101',
            'https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/',
            'https://aws.amazon.com/certification/certified-cloud-practitioner/',
            'https://www.pmi.org/certifications/project-management-pmp',
        ]) expect(urlProblem(url)).toBeNull();
    });
});

describe('matching the page title', () => {
    it('ignores case, punctuation, site names and generic words like "Professional Certificate"', () => {
        expect(titleMatch('Google Data Analytics Professional Certificate', ['Google Data Analytics | Coursera'])).toBe(1);
        expect(titleMatch('Project Management Professional (PMP)®', ['Project Management Professional (PMP) Certification | PMI'])).toBe(1);
        expect(titleMatch('Microsoft Certified: Azure Fundamentals', ['Microsoft Certified: Azure Fundamentals - Certifications | Microsoft Learn'])).toBe(1);
    });

    it('a different course scores low', () => {
        expect(titleMatch('Financial Accounting Fundamentals', ['Introduction to Python Programming | Coursera'])).toBe(0);
        expect(titleMatch('Healthcare Data Analytics', ['Google Data Analytics | Coursera'])).toBeLessThan(0.7);
    });
});

describe('the provider list', () => {
    it('finds a URL\'s provider by its domain or a subdomain of it, never a look-alike', () => {
        expect(providerOfUrl(new URL('https://www.coursera.org/learn/x'))?.name).toBe('Coursera');
        expect(providerOfUrl(new URL('https://learn.microsoft.com/en-us/x'))?.name).toBe('Microsoft Learn');
        expect(providerOfUrl(new URL('https://www.aws.org/certification/x'))?.name).toBe('American Welding Society');
        expect(providerOfUrl(new URL('https://coursera.org.evil.example/learn/x'))).toBeNull();
    });
});

describe('a whole answer', () => {
    it('checks every link at once, keeps the order, and drops Claude’s raw URL', async () => {
        const bad = 'https://www.coursera.org/learn/does-not-exist';
        let inFlight = 0;
        let maxInFlight = 0;
        const slow = (r: () => Response) => async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((ok) => setTimeout(ok, 20));
            inFlight--;
            return r();
        };
        const fetch = fakeFetch({
            [COURSE]: slow(() => html(page('AI For Everyone | Coursera'))),
            [bad]: slow(() => html(page('Not Found'), 404)),
        });
        const out = await linkCourses([
            { title: 'AI For Everyone', provider: 'Coursera', url: COURSE, level: 'Beginner' },
            { title: 'Made Up Course', provider: 'Coursera', url: bad, level: 'Advanced' },
            { title: 'No Link Course', provider: 'edX', url: '' },
            { title: 'Null Link Course', provider: 'Udemy', url: null },
        ], { fetch });
        expect(maxInFlight).toBe(2);
        expect(out.map((c) => [c.title, c.link?.kind ?? null, c.link?.label ?? null])).toEqual([
            ['AI For Everyone', 'course', 'Open course'],
            ['Made Up Course', null, null],
            ['No Link Course', null, null],
            ['Null Link Course', null, null],
        ]);
        for (const c of out.slice(1)) expect('link' in c).toBe(false);
        for (const c of out) expect('url' in c).toBe(false);
        expect(out[0]).toMatchObject({ level: 'Beginner' });
    });

    it('the upskill and roadmap features check links before the answer is kept', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('AI For Everyone | Coursera')) });
        const upskill = AI_FEATURES.upskill.check({
            courses: [{ title: 'AI For Everyone', provider: 'Coursera', url: COURSE, duration: '6 hours', level: 'Beginner' }],
            whyTheseCourses: 'x',
        }, { roleKey: 'soc:13-2011', title: 'Accountants', taskName: 't', mode: 'defend', riskPercent: 60 });
        const done = await AI_FEATURES.upskill.finalize!(upskill, { fetch }) as { courses: { link: unknown; url?: string }[] };
        expect(done.courses[0].link).toEqual({ href: COURSE, kind: 'course', label: 'Open course' });
        expect(done.courses[0].url).toBeUndefined();

        const roadmap = AI_FEATURES.roadmap.check({
            phases: [{ title: 'M1', items: ['a'] }],
            courses: [{ title: 'Unknown Thing', provider: 'Nowhere Institute', url: 'https://nowhere.example/x' }],
            resources: [],
            successMetrics: ['m'],
        }, { roleKey: 'soc:13-2011', title: 'Accountants', riskTask: 'r', targetTask: 't' });
        const done2 = await AI_FEATURES.roadmap.finalize!(roadmap, { fetch }) as { courses: { title: string; link?: unknown }[] };
        // a whole answer with no direct link still lists the course, by name only
        expect(done2.courses).toEqual([{ title: 'Unknown Thing', provider: 'Nowhere Institute' }]);
    });

    it('an answer needs at least one course (an empty or missing list is rejected); fewer than asked passes', () => {
        const input = { roleKey: 'soc:13-2011', title: 'A', riskTask: 'r', targetTask: 't' };
        const one = [{ title: 'Certified Internal Auditor', provider: 'The IIA', url: '' }];
        expect(() => AI_FEATURES.roadmap.check({ phases: [{ title: 'M1', items: ['a'] }], courses: one, resources: [], successMetrics: ['m'] }, input)).not.toThrow();
        expect(() => AI_FEATURES.roadmap.check({ phases: [{ title: 'M1', items: ['a'] }], courses: [], resources: [], successMetrics: ['m'] }, input)).toThrow();
        expect(() => AI_FEATURES.roadmap.check({ phases: [{ title: 'M1', items: ['a'] }], resources: [], successMetrics: ['m'] }, input)).toThrow();
        const up = { roleKey: 'soc:13-2011', title: 'A', taskName: 't', mode: 'build' as const, riskPercent: 10 };
        expect(() => AI_FEATURES.upskill.check({ courses: [], whyTheseCourses: '' }, up)).toThrow();
        expect(() => AI_FEATURES.upskill.check({ courses: [{ ...one[0], duration: '', level: '' }], whyTheseCourses: '' }, up)).not.toThrow();
    });
});

describe('the prompts ask for a link', () => {
    it('upskill and roadmap ask for each course’s url (empty if unsure), with no web search; versions bumped', () => {
        expect(buildUpskillPrompt('Accountants', 'Prepare tax returns', 'defend', 70)).toMatch(/"url": "https link to this exact course/);
        expect(buildUpskillPrompt('Accountants', 'Advise clients', 'build', 20)).toMatch(/or an empty string if you are not sure of it/);
        const roadmap = buildRoadmapPrompt('Accountants', 'Prepare tax returns', 'Advise clients');
        expect(roadmap).toMatch(/"courses": \[/);
        expect(roadmap).toMatch(/"url": "https link to this exact course/);
        expect(roadmap).not.toMatch(/"category": "Courses & Certifications"/);
        for (const p of [roadmap, buildUpskillPrompt('A', 't', 'defend', 50)]) expect(p).not.toMatch(/web_search|search result/i);
        // Bumped past every version that saved search links (up to upskill-5, roadmap-6), so none of those answers is reused.
        expect(AI_FEATURES.upskill.promptVersion).toBe('upskill-6');
        expect(AI_FEATURES.roadmap.promptVersion).toBe('roadmap-7');
    });
});

describe('credential acronyms', () => {
    it('a certification page that names only the acronym in brackets matches', () => {
        expect(titleMatch('Progressive Care Certified Nurse (PCCN) Certification', ['PCCN (Adult) – Direct Care Eligibility Pathway - AACN'])).toBe(1);
        expect(titleMatch('Progressive Care Certified Nurse (PCCN) Certification', ['CCRN (Adult) | AACN'])).toBeLessThan(0.7);
    });

    it('O’Reilly, DeepLearning.AI and Becker are on the list', () => {
        expect(providerOfUrl(new URL('https://www.oreilly.com/library/view/x/123/'))?.name).toBe('O’Reilly');
        expect(urlProblem('https://www.deeplearning.ai/courses/generative-ai-for-software-development/')).toBeNull();
        expect(providerOfUrl(new URL('https://www.becker.com/cpa-review'))?.name).toBe('Becker');
    });
});
