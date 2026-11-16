/**
 * The course catalog builder (scripts/lib/courseCatalog.ts): parsing each
 * provider's own list, the filters (courses only, English, not retired, link
 * passes the app's checkCourseUrl), robots.txt, the polite fetcher, and the
 * committed catalog's shape. fetch is mocked: no network here.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    canonicalUrl,
    certCandidate,
    checkCandidate,
    dedupeByUrl,
    notEnglish,
    pageFacts,
    parseMsCatalog,
    parseRobots,
    parseSkillsCatalogPage,
    parseSkillsItems,
    perHost,
    PoliteFetcher,
    recheckEntry,
    robotsAllows,
    selectGrowPages,
    shortDescription,
    sitemapLocs,
    sortEntries,
    USER_AGENT,
    type CatalogEntry,
    type MsCatalog,
} from '../../scripts/lib/courseCatalog';
import type { FetchLike } from '../shared/courseLinks';

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const page = (title: string, extra = '', lang = 'en-us') =>
    `<!doctype html><html lang="${lang}"><head><title>${title}</title><meta name="description" content="About ${title}."></head><body><h1>${title}</h1>${extra}</body></html>`;

/** A fetch that answers by URL; robots.txt allows everything unless given. Records calls and headers. */
function fakeFetch(routes: Record<string, () => Response>): FetchLike & { calls: string[]; agents: string[] } {
    const calls: string[] = [];
    const agents: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
        calls.push(url);
        agents.push(new Headers(init?.headers).get('user-agent') ?? '');
        const route = routes[url];
        if (route) return route();
        if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
        throw new TypeError('fetch failed');
    }) as FetchLike & { calls: string[]; agents: string[] };
    f.calls = calls;
    f.agents = agents;
    return f;
}

const noWait = { minIntervalMs: 0, sleep: async () => {}, now: () => Date.parse('2026-11-15T12:00:00Z') };

// ── Text ────────────────────────────────────────────────────────────────────

describe('text helpers', () => {
    it('cuts descriptions at a word boundary, at most 200 characters, tags and entities out', () => {
        const long = `<p>${'Learn data analysis with spreadsheets and SQL. '.repeat(10)}</p>`;
        const d = shortDescription(long)!;
        expect(d.length).toBeLessThanOrEqual(200);
        expect(d.endsWith('…')).toBe(true);
        expect(d).not.toMatch(/<|&/);
        expect(shortDescription('Short &amp; sweet')).toBe('Short & sweet');
        // Google Skills meta tags are encoded twice
        expect(shortDescription('Complete the &amp;lt;b&amp;gt;Kubernetes&amp;lt;/b&amp;gt; course')).toBe('Complete the Kubernetes course');
        expect(shortDescription('')).toBeUndefined();
        expect(shortDescription('Disaster recovery on Azure\u200b')).toBe('Disaster recovery on Azure');
    });

    it('tells English from other languages', () => {
        expect(notEnglish('Introduction to data analysis for your career')).toBeNull();
        expect(notEnglish('Introducción a los datos para la nube y el aprendizaje de las máquinas')).toBe('not English');
        expect(notEnglish('Introdução aos dados da nuvem com uma ferramenta do Google para os dados')).toBe('not English');
        expect(notEnglish('Google Cloud の基礎: コア インフラストラクチャ')).toBe('not English (non-Latin script)');
        expect(notEnglish('Azure DevOps')).toBeNull();
    });

    it('drops the sites\' tracking parameters from URLs', () => {
        expect(canonicalUrl('https://learn.microsoft.com/en-us/training/paths/x/?WT.mc_id=api_CatalogApi')).toBe('https://learn.microsoft.com/en-us/training/paths/x/');
        expect(canonicalUrl('/course_templates/783?catalog_rank=%7B%22rank%22%3A1%7D', 'https://www.skills.google')).toBe('https://www.skills.google/course_templates/783');
        expect(canonicalUrl('https://example.org/a?id=3#top')).toBe('https://example.org/a?id=3');
    });
});

// ── robots.txt ──────────────────────────────────────────────────────────────

describe('robots.txt', () => {
    const txt = [
        '# comment',
        'User-agent: GPTBot',
        'Disallow: /',
        '',
        'User-agent: *',
        'Disallow: /search',
        'Disallow: /courses?page=',
        'Allow: /courses?page=1$',
        'Disallow: /*/answers/',
        'Crawl-delay: 10',
        'Sitemap: https://example.org/sitemap.xml',
    ].join('\n');
    const r = parseRobots(txt);

    it('reads the "*" group when none names us, with its crawl delay and sitemaps', () => {
        expect(r.crawlDelaySec).toBe(10);
        expect(r.sitemaps).toEqual(['https://example.org/sitemap.xml']);
        expect(robotsAllows(r, 'https://example.org/learn/x')).toBe(true);
        expect(robotsAllows(r, 'https://example.org/search?q=a')).toBe(false);
        expect(robotsAllows(r, 'https://example.org/en-us/answers/123')).toBe(false);
    });

    it('longest match wins, "$" anchors, Allow wins a tie', () => {
        expect(robotsAllows(r, 'https://example.org/courses?page=1')).toBe(true);
        expect(robotsAllows(r, 'https://example.org/courses?page=12')).toBe(false);
        expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\n'), 'https://x.org/a')).toBe(true);
    });

    it('uses our own group when one names us, and an empty Disallow allows all', () => {
        const own = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: FutureOfJobsCourseCatalog\nDisallow:\n');
        expect(robotsAllows(own, 'https://x.org/anything')).toBe(true);
        expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /\n'), 'https://x.org/anything')).toBe(false);
    });
});

// ── The polite fetcher ──────────────────────────────────────────────────────

describe('PoliteFetcher', () => {
    it('says who it is, obeys robots.txt, and downloads each URL once per run', async () => {
        const f = fakeFetch({
            'https://x.org/robots.txt': () => new Response('User-agent: *\nDisallow: /private\n'),
            'https://x.org/a': () => html('a'),
        });
        const pf = new PoliteFetcher({ fetch: f, ...noWait });
        await pf.fetch('https://x.org/a');
        await pf.fetch('https://x.org/a');
        await expect(pf.fetch('https://x.org/private/b')).rejects.toThrow(/robots\.txt disallows/);
        expect(f.calls).toEqual(['https://x.org/robots.txt', 'https://x.org/a']);
        expect(f.agents.every((a) => a === USER_AGENT)).toBe(true);
        expect(USER_AGENT).toMatch(/FutureOfJobsCourseCatalog/);
        expect(USER_AGENT).not.toMatch(/Mozilla|Chrome/);
    });

    it('spaces requests to one host (or the site\'s Crawl-delay, if longer)', async () => {
        let clock = 0;
        const waits: number[] = [];
        const f = fakeFetch({
            'https://x.org/robots.txt': () => new Response('User-agent: *\nCrawl-delay: 3\n'),
            'https://x.org/1': () => html('1'),
            'https://x.org/2': () => html('2'),
        });
        const pf = new PoliteFetcher({ fetch: f, minIntervalMs: 1000, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
        await pf.fetch('https://x.org/1');
        await pf.fetch('https://x.org/2');
        expect(waits).toEqual([3000, 3000]); // never before the first request; then the site's 3 s crawl delay
    });

    it('treats a robots.txt that errors as "nothing allowed", and a missing one as "all allowed"', async () => {
        const f = fakeFetch({
            'https://down.org/robots.txt': () => new Response('', { status: 503 }),
            'https://none.org/robots.txt': () => new Response('', { status: 404 }),
            'https://none.org/a': () => html('a'),
        });
        const pf = new PoliteFetcher({ fetch: f, ...noWait });
        await expect(pf.fetch('https://down.org/a')).rejects.toThrow(/robots/);
        await expect(pf.fetch('https://none.org/a')).resolves.toBeInstanceOf(Response);
    });

    it('reuses the build\'s page cache, and stores what it downloads', async () => {
        const stored: string[] = [];
        const f = fakeFetch({ 'https://x.org/b': () => html('fresh') });
        const pf = new PoliteFetcher({
            fetch: f,
            ...noWait,
            cache: {
                get: (url) => (url === 'https://x.org/a' ? { url, status: 200, contentType: 'text/html', body: 'cached', fetchedAt: 0 } : undefined),
                set: (p) => { stored.push(p.url); },
            },
        });
        expect(await (await pf.fetch('https://x.org/a')).text()).toBe('cached');
        expect(await (await pf.fetch('https://x.org/b')).text()).toBe('fresh');
        expect(f.calls).not.toContain('https://x.org/a');
        expect(stored).toContain('https://x.org/b');
    });
});

// ── Microsoft Learn ─────────────────────────────────────────────────────────

const MS: MsCatalog = {
    learningPaths: [
        { uid: 'learn.path-a', type: 'learningPath', title: 'Analyze data with Power BI', url: 'https://learn.microsoft.com/en-us/training/paths/analyze-data/?WT.mc_id=api_CatalogApi', summary: '<p>Learn to <b>analyze</b> data.</p>', levels: ['beginner'], roles: ['data-analyst'], products: ['power-bi'], subjects: ['data-analytics'], locale: 'en-us', duration_in_minutes: 102 },
        { uid: 'learn.path-fr', type: 'learningPath', title: 'Analyser des données', url: 'https://learn.microsoft.com/fr-fr/training/paths/x/', locale: 'fr-fr' },
    ],
    mergedCertifications: [
        { uid: 'certification.data-analyst', type: 'cert', title: 'Microsoft Certified: Power BI Data Analyst Associate', url: 'https://learn.microsoft.com/en-us/credentials/certifications/data-analyst-associate/?WT.mc_id=api_CatalogApi', summary: 'Demonstrate methods.', levels: ['intermediate'], roles: ['data-analyst'], products: ['power-bi'], skills: ['Prepare the data'] },
    ],
    courses: [{ uid: 'course.pl-300t00', type: 'course', title: 'Microsoft Power BI Data Analyst', url: 'https://learn.microsoft.com/en-us/training/courses/pl-300t00/', duration_in_hours: 24, levels: ['beginner'] }],
    appliedSkills: [{ uid: 'applied-skill.x', title: 'Microsoft Applied Skills: Create reports', url: 'https://learn.microsoft.com/en-us/credentials/applied-skills/x/', locale: 'en-us' }],
    products: [{ id: 'power', name: 'Power Platform', children: [{ id: 'power-bi', name: 'Power BI' }] }],
    roles: [{ id: 'data-analyst', name: 'Data Analyst' }],
    subjects: [{ id: 'data', name: 'Data', children: [{ id: 'data-analytics', name: 'Data analytics' }] }],
    levels: [{ id: 'beginner', name: 'Beginner' }, { id: 'intermediate', name: 'Intermediate' }],
};

describe('Microsoft Learn Catalog API', () => {
    const got = parseMsCatalog(MS);

    it('keeps English learning paths, courses, certifications and Applied Skills, with the API\'s own fields', () => {
        expect(got.map((c) => c.id)).toEqual([
            'microsoft-learn:path:learn.path-a',
            'microsoft-learn:course:course.pl-300t00',
            'microsoft-learn:certification:certification.data-analyst',
            'microsoft-learn:applied-skill:applied-skill.x',
        ]);
        const path = got[0];
        expect(path).toMatchObject({ title: 'Analyze data with Power BI', type: 'course', level: 'Beginner', duration: '102 minutes', price: 'unknown', description: 'Learn to analyze data.' });
        expect(path.url).toBe('https://learn.microsoft.com/en-us/training/paths/analyze-data/');
        expect(path.tags).toEqual(['Power BI', 'Data Analyst', 'Data analytics']); // ids turned into the API's own names
        expect(got[1]).toMatchObject({ type: 'course', duration: '24 hours' });
        expect(got[2]).toMatchObject({ type: 'certification', level: 'Intermediate', tags: ['Power BI', 'Data Analyst', 'Prepare the data'] });
        expect(got[3]).toMatchObject({ type: 'certificate' });
    });

    it('never invents a field the API does not give', () => {
        const applied = got[3];
        expect(applied.level).toBeUndefined();
        expect(applied.duration).toBeUndefined();
        expect(applied.description).toBeUndefined();
        expect(applied.price).toBe('unknown');
    });
});

// ── Google Skills ───────────────────────────────────────────────────────────

const skillsPage = (items: object[], count = 2) =>
    `<html><body><ql-search-result-container pagedSearchResults='${JSON.stringify({ searchResults: items, resultsCount: count, itemsPerPage: 8, path: '/catalog/list' }).replace(/"/g, '&quot;')}' relaunch></ql-search-result-container></body></html>`;

describe('Google Skills catalog pages', () => {
    const items = [
        { type: 'course', title: 'Manage Kubernetes in Google Cloud', description: 'Complete the intermediate <b>Manage Kubernetes</b> skill badge course.', path: '/course_templates/783?catalog_rank=%7B%22rank%22%3A1%7D', duration: '30 minutes', level: 'intermediate', credentialType: 'skill_badge', paid: false },
        { type: 'lab', title: 'A Tour of Google Cloud Hands-on Labs', path: '/focuses/2794?catalog_rank=x', duration: '45 minutes', level: 'introductory', paid: false },
        { type: 'course', title: 'Paid course', path: '/course_templates/9', paid: true },
        { type: 'course', title: 'Manage Kubernetes in Google Cloud', path: '/course_templates/783?catalog_rank=other' },
        { type: 'learning_path', title: 'Getting Started with Google Cloud', path: '/paths/8?catalog_rank=x', duration: '15 hours 46 minutes', level: null, paid: null },
    ];

    it('reads the list each page carries as data', () => {
        const p = parseSkillsCatalogPage(skillsPage(items, 1312));
        expect(p.resultsCount).toBe(1312);
        expect(p.itemsPerPage).toBe(8);
        expect(p.items).toHaveLength(5);
        expect(() => parseSkillsCatalogPage('<html></html>')).toThrow(/pagedSearchResults/);
    });

    it('keeps courses and learning paths (labs are dropped with a reason), once each, with the page\'s fields', () => {
        const { candidates, dropped } = parseSkillsItems(items);
        expect(candidates.map((c) => c.id)).toEqual(['google-skills:course_templates/783', 'google-skills:course_templates/9', 'google-skills:paths/8']);
        expect(candidates[2]).toMatchObject({ type: 'course', duration: '15 hours 46 minutes', price: 'unknown', url: 'https://www.skills.google/paths/8' });
        expect(candidates[2].level).toBeUndefined();
        expect(candidates[0]).toMatchObject({
            url: 'https://www.skills.google/course_templates/783',
            type: 'course',
            level: 'Intermediate',
            duration: '30 minutes',
            price: 'unknown', // "paid: false" alone does not say the course is free
            description: 'Complete the intermediate Manage Kubernetes skill badge course.',
            tags: ['skill badge'],
        });
        expect(candidates[1].price).toBe('paid');
        expect(dropped).toEqual([expect.objectContaining({ id: 'google-skills:focuses/2794', reason: 'a lab, not a course' })]);
    });
});

// ── Grow with Google ────────────────────────────────────────────────────────

describe('Grow with Google sitemap', () => {
    const xml = `<?xml version="1.0"?><urlset>
        <url><loc>https://grow.google/</loc></url>
        <url><loc>https://grow.google/certificates</loc></url>
        <url><loc>https://grow.google/certificates/data-analytics/</loc></url>
        <url><loc>https://grow.google/certificates/digital-marketing-ecommerce/c1-foundations-of-digital-marketing</loc></url>
        <url><loc>https://grow.google/certificates/en_ca/it-support/</loc></url>
        <url><loc>https://grow.google/intl/apac/certificates/data-analytics/</loc></url>
        <url><loc>https://grow.google/ai-essentials/</loc></url>
        <url><loc>https://grow.google/grow-your-career/articles/what-is-data-analytics/</loc></url>
        <url><loc>https://grow.google/ai-professional/c8-aiforappdeployment</loc></url>
    </urlset>`;

    it('keeps US-English certificate and course pages; regional copies, articles and landing pages are left out', () => {
        const locs = sitemapLocs(xml);
        expect(locs).toHaveLength(9);
        const got = selectGrowPages(locs);
        expect(got.map((c) => [c.id, c.type])).toEqual([
            ['grow-google:certificates/data-analytics', 'certificate'],
            ['grow-google:certificates/digital-marketing-ecommerce/c1-foundations-of-digital-marketing', 'course'],
            ['grow-google:ai-essentials', 'course'],
            ['grow-google:ai-professional/c8-aiforappdeployment', 'course'],
        ]);
        expect(got.every((c) => c.title === '' && c.fromPage)).toBe(true); // the title comes from the page itself
        expect(got[0].url).toBe('https://grow.google/certificates/data-analytics/');
    });
});

// ── Certification bodies ────────────────────────────────────────────────────

describe('certification bodies', () => {
    const cert = { key: 'iia-cia', listingUrl: 'https://www.theiia.org/en/certifications/', url: 'https://www.theiia.org/en/certifications/cia/', linkText: 'Certified Internal Auditor' };

    it('keeps a hand-reviewed page only while the official listing still links to it under that text', () => {
        const listing = '<a href="/en/certifications/cia/"><span>Certified Internal Auditor</span></a><a href="/en/certifications/crma/">CRMA</a>';
        expect(certCandidate(cert, listing)).toMatchObject({ id: 'cert-bodies:iia-cia', title: 'Certified Internal Auditor', type: 'certification', url: cert.url });
        expect(certCandidate(cert, '<a href="/en/certifications/crma/">CRMA</a>')).toEqual({ reason: 'no longer linked from the listing page' });
        expect(certCandidate(cert, '<a href="/en/certifications/cia/">Something else</a>')).toMatchObject({ reason: expect.stringMatching(/link text changed/) });
    });

    it('the committed list: every page on the app\'s provider list, unique, from a listing on the same site', () => {
        const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/course_catalog/cert_pages.json'), 'utf8')) as { pages: typeof cert[] };
        const keys = new Set<string>();
        for (const p of file.pages) {
            expect(keys.has(p.key)).toBe(false);
            keys.add(p.key);
            expect(new URL(p.url).host).toBe(new URL(p.listingUrl).host);
            expect(p.url).toMatch(/^https:\/\//);
        }
    });
});

// ── The check ───────────────────────────────────────────────────────────────

describe('checkCandidate', () => {
    const today = '2026-11-15';
    const ms = parseMsCatalog(MS)[0];
    const msUrl = ms.url;

    it('keeps an entry whose link passes the app\'s check, with the provider name from the provider list', async () => {
        const f = fakeFetch({ [msUrl]: () => html(page('Analyze data with Power BI - Training | Microsoft Learn')) });
        const r = await checkCandidate(ms, { fetcher: new PoliteFetcher({ fetch: f, ...noWait }), today });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.entry).toMatchObject({ id: ms.id, title: 'Analyze data with Power BI', provider: 'Microsoft Learn', url: msUrl, type: 'course', price: 'unknown', lastChecked: today });
        expect(f.calls.filter((u) => u === msUrl)).toHaveLength(1);
    });

    it('drops it when the link fails: not found, wrong title, redirect to a listing, retired, not English', async () => {
        const run = async (res: () => Response, c = ms) => {
            const r = await checkCandidate(c, { fetcher: new PoliteFetcher({ fetch: fakeFetch({ [c.url]: res }), ...noWait }), today });
            return r.ok ? 'ok' : r.reason;
        };
        expect(await run(() => html('', 404))).toBe('status 404');
        expect(await run(() => html(page('Page not found')))).toBe('a "not found" page');
        expect(await run(() => html(page('Something else entirely')))).toMatch(/^title does not match/);
        expect(await run(() => new Response(null, { status: 301, headers: { location: 'https://learn.microsoft.com/en-us/training/' } }))).toMatch(/^redirects to a/);
        expect(await run(() => html(page('Analyze data with Power BI', '<div>Warning This certification has been retired. For currently available options...</div>')))).toBe('page says it is retired');
        expect(await run(() => html(page('Analyze data with Power BI', '', 'es-es')))).toBe('not English (page lang es-es)');
    });

    it('drops a link robots.txt does not allow, without fetching it', async () => {
        const f = fakeFetch({ 'https://learn.microsoft.com/robots.txt': () => new Response('User-agent: *\nDisallow: /en-us/training/\n') });
        const r = await checkCandidate(ms, { fetcher: new PoliteFetcher({ fetch: f, ...noWait }), today });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/robots\.txt disallows/) });
        expect(f.calls).toEqual(['https://learn.microsoft.com/robots.txt']);
    });

    it('takes title, description and type from the page for sitemap sources, and a price only when the page shows one', async () => {
        const [grow] = selectGrowPages(['https://grow.google/certificates/data-analytics/']);
        const body = page('Google Data Analytics Certificate', '<p>Subscription US$49 per month</p>');
        const f = fakeFetch({ [grow.url]: () => html(body) });
        const r = await checkCandidate(grow, { fetcher: new PoliteFetcher({ fetch: f, ...noWait }), today });
        expect(r).toMatchObject({ ok: true, entry: { title: 'Google Data Analytics Certificate', provider: 'Google', type: 'certificate', price: 'paid', description: 'About Google Data Analytics Certificate.' } });
        expect(f.calls.filter((u) => u === grow.url)).toHaveLength(1); // the check reused the page download
        const [course] = selectGrowPages(['https://grow.google/ai-essentials/']);
        const r2 = await checkCandidate(course, { fetcher: new PoliteFetcher({ fetch: fakeFetch({ [course.url]: () => html(page('Google AI Essentials')) }), ...noWait }), today });
        expect(r2).toMatchObject({ ok: true, entry: { type: 'course', price: 'unknown' } });
    });

    it('re-check mode: same check, a new lastChecked, failures reported', async () => {
        const entry: CatalogEntry = { id: ms.id, title: 'Analyze data with Power BI', provider: 'Microsoft Learn', url: msUrl, type: 'course', price: 'unknown', lastChecked: '2026-01-01' };
        const ok = await recheckEntry(entry, { fetcher: new PoliteFetcher({ fetch: fakeFetch({ [msUrl]: () => html(page(entry.title)) }), ...noWait, now: () => Date.parse('2026-12-01T12:00:00Z') }), today: '2026-12-01' });
        expect(ok).toMatchObject({ ok: true, entry: { lastChecked: '2026-12-01' } });
        const gone = await recheckEntry(entry, { fetcher: new PoliteFetcher({ fetch: fakeFetch({ [msUrl]: () => html('', 410) }), ...noWait }), today: '2026-12-01' });
        expect(gone).toEqual({ ok: false, reason: 'status 410' });
    });

    it('page facts: lang, meta description, retired notice, shown price, structured "free"', () => {
        const f = pageFacts('<html lang="en"><head><meta content="Desc here" name="description"><script type="application/ld+json">{"isAccessibleForFree": true}</script></head><body><h1>T</h1>Price: $165 USD</body></html>');
        expect(f).toMatchObject({ lang: 'en', description: 'Desc here', h1: 'T', showsPrice: true, saysFree: true, retired: false });
        expect(pageFacts('<html><body><h1>T</h1><script>var p = "$5"</script></body></html>').showsPrice).toBe(false);
    });
});

// ── Ordering and the committed catalog ──────────────────────────────────────

describe('catalog output', () => {
    const e = (id: string, provider: string, type: CatalogEntry['type'], title: string, url = `https://x.org/${id}`): CatalogEntry => ({ id, title, provider, url, type, price: 'unknown', lastChecked: '2026-11-15' });

    it('sorts by provider, type (certifications first), title; one entry per URL', () => {
        const sorted = sortEntries([e('3', 'B', 'course', 'a'), e('2', 'A', 'course', 'z'), e('1', 'A', 'certification', 'm')]);
        expect(sorted.map((x) => x.id)).toEqual(['1', '2', '3']);
        const { kept, dupes } = dedupeByUrl([e('a', 'A', 'course', 't', 'https://x.org/p/'), e('b', 'A', 'course', 't', 'https://x.org/P')]);
        expect(kept.map((x) => x.id)).toEqual(['a']);
        expect(dupes.map((x) => x.id)).toEqual(['b']);
    });

    it('runs one worker per host, keeping the input order', async () => {
        const seen: string[] = [];
        const out = await perHost(['https://a.org/1', 'https://b.org/1', 'https://a.org/2'], (u) => u, async (u) => { seen.push(u); return u.length; });
        expect(out).toEqual([15, 15, 15]);
        expect(seen.filter((u) => u.includes('a.org'))).toEqual(['https://a.org/1', 'https://a.org/2']);
    });

    const catalogPath = path.join(__dirname, '../../data/course_catalog/catalog.json');
    it.skipIf(!fs.existsSync(catalogPath))('the committed catalog: every entry complete, checked, on the provider list, with a short description', async () => {
        const { providerOfUrl } = await import('../shared/courseLinks');
        const file = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { count: number; entries: CatalogEntry[] };
        expect(file.count).toBe(file.entries.length);
        expect(file.entries.length).toBeGreaterThan(500);
        const ids = new Set<string>();
        const urls = new Set<string>();
        for (const x of file.entries) {
            expect(ids.has(x.id)).toBe(false);
            expect(urls.has(x.url)).toBe(false);
            ids.add(x.id);
            urls.add(x.url);
            expect(x.title.length).toBeGreaterThan(1);
            expect(['course', 'certificate', 'certification']).toContain(x.type);
            expect(['free', 'paid', 'free-to-audit', 'unknown']).toContain(x.price);
            expect(x.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(providerOfUrl(new URL(x.url))?.name).toBe(x.provider);
            if (x.description) expect(x.description.length).toBeLessThanOrEqual(200);
        }
        expect(sortEntries(file.entries)).toEqual(file.entries);
    });

    it('the catalog is not part of the app: nothing in src/ imports it', () => {
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const name of fs.readdirSync(dir)) {
                const p = path.join(dir, name);
                if (fs.statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); }
                else if (/\.(ts|tsx|js|jsx)$/.test(name) && /course_catalog|courseCatalog/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
            }
        };
        walk(path.join(__dirname, '..'));
        expect(hits).toEqual([]);
    });
});
