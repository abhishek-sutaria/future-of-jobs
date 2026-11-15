/**
 * Course links (shared/courseLinks.ts): every link Claude gives is checked on
 * the server before anyone sees it, and replaced with a search for the course
 * name when it fails any check. fetch is mocked: no network here.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    checkCourseUrl,
    linkCourse,
    linkCourses,
    providerFor,
    searchLinkFor,
    titleMatch,
    urlProblem,
    type FetchLike,
} from '../shared/courseLinks';
import { COURSE_PROVIDERS } from '../shared/courseProviders';
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

    it('a 404 → search on the provider for the exact course name', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('Page Not Found'), 404) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toMatchObject({ ok: false, reason: 'status 404' });
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: COURSE }, { fetch });
        expect(linked.link).toEqual({
            href: 'https://www.coursera.org/search?query=AI%20For%20Everyone',
            kind: 'search',
            label: 'Search on Coursera',
        });
    });

    it('a "not found" page served with a 200 → fallback', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('Course not found | Coursera', 'This course is no longer available')) });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toMatchObject({ ok: false, reason: 'a "not found" page' });
    });

    it('a redirect to the home page → fallback (and the home page is never fetched)', async () => {
        const fetch = fakeFetch({ [COURSE]: () => redirect('https://www.coursera.org/') });
        expect(await checkCourseUrl(COURSE, 'AI For Everyone', { fetch })).toMatchObject({ ok: false, reason: 'redirects to a home page' });
        expect(fetch.calls).toEqual([COURSE]);
    });

    it('a redirect to a search or sign-in page, or off the list → fallback', async () => {
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

    it('a page whose title is a different course → fallback', async () => {
        const fetch = fakeFetch({ [COURSE]: () => html(page('Introduction to Python Programming | Coursera')) });
        const r = await checkCourseUrl(COURSE, 'Financial Accounting Fundamentals', { fetch });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toMatch(/^title does not match \(0%/);
    });

    it('a link that does not answer in time → fallback, after about the timeout', async () => {
        const fetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        const t0 = Date.now();
        const r = await checkCourseUrl(COURSE, 'AI For Everyone', { fetch, timeoutMs: 50 });
        expect(r).toEqual({ ok: false, reason: 'timed out' });
        expect(Date.now() - t0).toBeLessThan(1000);
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: COURSE }, { fetch, timeoutMs: 50 });
        expect(linked.link.kind).toBe('search');
    });

    it('a domain not on the list is never fetched → fallback', async () => {
        const fetch = fakeFetch({});
        for (const url of ['https://free-courses.example/learn/ai', 'https://coursera.org.evil.example/learn/ai', 'https://notcoursera.org/learn/ai']) {
            expect(await checkCourseUrl(url, 'AI For Everyone', { fetch })).toEqual({ ok: false, reason: 'not on the provider list' });
        }
        expect(fetch.calls).toEqual([]);
        const linked = await linkCourse({ title: 'AI For Everyone', provider: 'Coursera', url: 'https://free-courses.example/learn/ai' }, { fetch });
        expect(linked.link.label).toBe('Search on Coursera');
    });

    it('an unknown provider → a web search for the course name', async () => {
        const fetch = fakeFetch({});
        const linked = await linkCourse({ title: 'Advanced Widget Auditing', provider: 'Widget Academy', url: 'https://widget.example/course/1' }, { fetch });
        expect(linked.link).toEqual({
            href: 'https://www.google.com/search?q=%22Advanced%20Widget%20Auditing%22%20Widget%20Academy',
            kind: 'search',
            label: 'Search the web',
        });
        expect(fetch.calls).toEqual([]);
    });

    it('a network error, a non-HTML file, or a page with no title → fallback', async () => {
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

describe('the fallback search', () => {
    it('uses the named provider’s own search, or a search of its site', () => {
        expect(searchLinkFor('Excel Essential Training', 'LinkedIn Learning')).toEqual({
            href: 'https://www.linkedin.com/learning/search?keywords=Excel%20Essential%20Training',
            kind: 'search',
            label: 'Search on LinkedIn Learning',
        });
        expect(searchLinkFor('Certified Internal Auditor', 'The Institute of Internal Auditors (IIA)')).toEqual({
            href: 'https://www.google.com/search?q=site%3Atheiia.org%20%22Certified%20Internal%20Auditor%22',
            kind: 'search',
            label: 'Search on The IIA',
        });
    });

    it('picks the provider by its longest name in Claude’s text', () => {
        expect(providerFor('Coursera (offered by Google)')?.name).toBe('Coursera');
        expect(providerFor('American Welding Society (AWS)')?.name).toBe('American Welding Society');
        expect(providerFor('AWS Skill Builder')?.name).toBe('AWS');
        expect(providerFor('Microsoft Learn')?.name).toBe('Microsoft Learn');
        expect(providerFor('Some Local College')).toBeNull();
    });

    it('every provider search link is https and on the provider’s own site or a web search', () => {
        for (const p of COURSE_PROVIDERS) {
            const href = searchLinkFor('Test Course', p.aliases[0]).href;
            expect(href.startsWith('https://')).toBe(true);
            expect(providerFor(p.aliases[0])?.name).toBe(p.name);
        }
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
        expect(out.map((c) => [c.title, c.link.kind, c.link.label])).toEqual([
            ['AI For Everyone', 'course', 'Open course'],
            ['Made Up Course', 'search', 'Search on Coursera'],
            ['No Link Course', 'search', 'Search on edX'],
            ['Null Link Course', 'search', 'Search on Udemy'],
        ]);
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
        const done2 = await AI_FEATURES.roadmap.finalize!(roadmap, { fetch }) as { courses: { link: { label: string } }[] };
        expect(done2.courses[0].link.label).toBe('Search the web');
    });

    it('a roadmap with no courses fails the check (the prompt always asks for them)', () => {
        expect(() => AI_FEATURES.roadmap.check({ phases: [{ title: 'M1', items: ['a'] }], resources: [], successMetrics: ['m'] },
            { roleKey: 'soc:13-2011', title: 'A', riskTask: 'r', targetTask: 't' })).toThrow();
    });
});

describe('the prompts ask for a link', () => {
    it('upskill and roadmap ask for each course’s url; versions bumped', () => {
        expect(buildUpskillPrompt('Accountants', 'Prepare tax returns', 'defend', 70)).toMatch(/"url": "https link to this exact course/);
        expect(buildUpskillPrompt('Accountants', 'Advise clients', 'build', 20)).toMatch(/"url": "https link to this exact course/);
        const roadmap = buildRoadmapPrompt('Accountants', 'Prepare tax returns', 'Advise clients');
        expect(roadmap).toMatch(/"courses": \[/);
        expect(roadmap).toMatch(/"url": "https link to this exact course/);
        expect(roadmap).not.toMatch(/"category": "Courses & Certifications"/);
        expect(AI_FEATURES.upskill.promptVersion).toBe('upskill-2');
        expect(AI_FEATURES.roadmap.promptVersion).toBe('roadmap-3');
    });
});

vi.restoreAllMocks();

describe('credential acronyms', () => {
    it('a certification page that names only the acronym in brackets matches', () => {
        expect(titleMatch('Progressive Care Certified Nurse (PCCN) Certification', ['PCCN (Adult) – Direct Care Eligibility Pathway - AACN'])).toBe(1);
        expect(titleMatch('Progressive Care Certified Nurse (PCCN) Certification', ['CCRN (Adult) | AACN'])).toBeLessThan(0.7);
    });

    it('O’Reilly, DeepLearning.AI and Becker are on the list', () => {
        expect(providerFor('O\'Reilly Media')?.name).toBe('O’Reilly');
        expect(providerFor('DeepLearning.AI')?.name).toBe('DeepLearning.AI');
        expect(urlProblem('https://www.deeplearning.ai/courses/generative-ai-for-software-development/')).toBeNull();
        expect(providerFor('Becker Professional Education')?.name).toBe('Becker');
    });
});
