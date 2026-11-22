/**
 * Direct course links only (2026-11-22, the owner wants only direct links):
 * no code path may build or show a search link of any kind, not on a
 * provider's own search, not a site search, not a web search.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { linkCatalogCourses, linkCourses, type FetchLike } from '../shared/courseLinks';
import { COURSE_PROVIDERS } from '../shared/courseProviders';

const ROOT = path.resolve(__dirname, '../..');

/** What a search link looks like in code: a search page, a search query, a site search, or the old builders and labels. */
const SEARCH_PATTERNS: [string, RegExp][] = [
    // "search?" as in a URL; not optional chaining ("search?.bottom")
    ['a "search?" URL', /search\?(?!\.)/i],
    ['a /search/ path', /\/search\//i],
    ['a site: search', /site:/],
    ['a web search', /google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com/i],
    ['a query string built from a name', /[?&](q|query|keywords|terms|page_search_query)=\$\{/],
    ['a search-link builder', /searchLinkFor|webSearchUrl|IconSearch[^]*CourseLink|provider\.search\b/],
    ['a search label', /Search on |Search the web/],
    ['a search kind', /kind:\s*['"]search['"]/],
];

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { if (name !== '__tests__') out.push(...sourceFiles(p)); }
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

describe('no search link anywhere', () => {
    it('src/shared, src/components, the export and the server hold no search-URL code', () => {
        const files = [
            ...sourceFiles(path.join(ROOT, 'src/shared')),
            ...sourceFiles(path.join(ROOT, 'src/components')),
            path.join(ROOT, 'src/utils/reportExport.ts'),
            path.join(ROOT, 'src/utils/courseLink.ts'),
            ...sourceFiles(path.join(ROOT, 'api')).filter((f) => !f.endsWith('courseMatchesData.ts')),
        ];
        expect(files.length).toBeGreaterThan(50);
        const hits: string[] = [];
        for (const f of files) {
            const text = fs.readFileSync(f, 'utf8');
            for (const [what, re] of SEARCH_PATTERNS) if (re.test(text)) hits.push(`${path.relative(ROOT, f)}: ${what}`);
        }
        expect(hits).toEqual([]);
    });

    it('the course button has no search icon or search variant', () => {
        const button = fs.readFileSync(path.join(ROOT, 'src/components/CourseLinkButton.tsx'), 'utf8');
        expect(button).not.toMatch(/IconSearch|'search'|"search"|Search/);
    });

    it('the provider list builds no search URL', () => {
        for (const p of COURSE_PROVIDERS) expect(Object.keys(p).sort()).toEqual(expect.arrayContaining(['domains', 'name']));
        for (const p of COURSE_PROVIDERS) for (const k of Object.keys(p)) expect(['name', 'domains', 'pathPrefix', 'notCourse']).toContain(k);
    });

    it('every failure, on every provider and off the list, gives a course with no link: never a search URL', async () => {
        const fail: Record<string, FetchLike> = {
            'not found': async () => new Response('<title>Page Not Found</title>', { status: 404, headers: { 'content-type': 'text/html' } }),
            'wrong title': async () => new Response('<title>Something Else Entirely</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
            'network error': async () => { throw new TypeError('fetch failed'); },
            'redirect home': async (url) => new Response(null, { status: 302, headers: { location: new URL('/', url).toString() } }),
        };
        const courses = [
            ...COURSE_PROVIDERS.map((p) => ({ title: 'Made Up Course', provider: p.name, url: `https://www.${p.domains[0]}${p.pathPrefix ?? '/'}made-up-course-xyz` })),
            { title: 'No Link', provider: 'Coursera', url: '' },
            { title: 'Null Link', provider: 'edX', url: null },
            { title: 'Off List', provider: 'Widget Academy', url: 'https://widget.example/course/1' },
            { title: 'Not https', provider: 'Coursera', url: 'http://www.coursera.org/learn/x' },
            { title: 'A search page', provider: 'Coursera', url: 'https://www.coursera.org/search?query=x' },
        ];
        for (const [why, fetch] of Object.entries(fail)) {
            const out = await linkCourses(courses, { fetch, timeoutMs: 200 });
            expect(out, why).toHaveLength(courses.length);
            for (const c of out) expect('link' in c, `${why}: ${c.title}`).toBe(false);
            expect(JSON.stringify(out), why).not.toMatch(/search\?|\/search\/|site:|google\.com|"kind":"search"|Search on|Search the web/);
            // the catalog path too: a failing catalog page and the one other course
            const cat = await linkCatalogCourses(
                [{ catalogId: 'c1', title: 'x', provider: 'y' }, { title: 'Other', provider: 'Coursera', url: 'https://www.coursera.org/learn/other' }],
                [{ id: 'c1', title: 'Real Catalog Course', provider: 'Microsoft Learn', url: 'https://learn.microsoft.com/en-us/training/paths/real-catalog-course/' }],
                { fetch, timeoutMs: 200 },
            );
            expect(cat.courses.map((c) => [c.title, 'link' in c]), why).toEqual([['Real Catalog Course', false], ['Other', false]]);
        }
    });
});
