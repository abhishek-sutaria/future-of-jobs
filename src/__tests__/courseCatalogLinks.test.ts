/**
 * Step 3: the app uses the matched catalog courses (data/course_catalog/
 * matches.json), on the server only (api/_lib/courseMatches.ts).
 *
 *   - a matched job's Defend / Build and Roadmap prompts list its catalog
 *     courses by id; the server turns each id into its catalog page ("Open
 *     course"), rejects an id not on the job's list, keeps at most one other
 *     course and checks that one's link as in #99;
 *   - an unmatched job's prompt is byte for byte the #99 prompt, and its links
 *     are handled exactly as in #99;
 *   - an answer with no course left is rejected;
 *   - retired or removed catalog entries can never be matched;
 *   - the server data is exactly what the data builds and is not in the
 *     browser bundle (nothing in src/ imports it).
 * Claude and Supabase are the in-memory mock: no real call, no network.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClaudeHandler, type ApiRequest } from '../../api/_lib/gateway';
import { matchedCoursesFor, socForRoleKey } from '../../api/_lib/courseMatches';
import { COURSE_MATCHES_DATA } from '../../api/_lib/courseMatchesData';
import { createMockBackend, MOCK_SUPABASE_URL, type MockBackend } from '../../scripts/lib/mockAiBackend';
import { assembleServerCourseData, buildServerCourseData, renderServerCourseData, SERVER_DATA_PATH } from '../../scripts/lib/courseMatchesServer';
import { RETIRED } from '../../scripts/lib/courseCatalog';
import { AI_FEATURES } from '../shared/aiFeatures';
import { buildRoadmapPrompt, buildUpskillPrompt, type CatalogCourse } from '../shared/aiPrompts';
import { linkCatalogCourses, type FetchLike } from '../shared/courseLinks';

const ROOT = path.resolve(__dirname, '../..');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const CIA: CatalogCourse = { id: 'cert-bodies:iia-cia', title: 'Certified Internal Auditor', provider: 'The IIA', url: 'https://www.theiia.org/en/certifications/cia/', type: 'certification', reason: 'Auditing credential.' };
const EXCEL: CatalogCourse = { id: 'microsoft-learn:certification:certification.mos-excel-for-accounting-associate', title: 'Microsoft Office Specialist: Excel for Accounting Associate', provider: 'Microsoft Learn', url: 'https://learn.microsoft.com/en-us/credentials/certifications/mos-excel-for-accounting-associate/', type: 'certification', level: 'Intermediate' };
const CATALOG = [CIA, EXCEL];

/** Link checks: every page is "not found", so a non-catalog course always falls back to a search. */
const notFound: FetchLike = async () => new Response('<title>Not Found</title>', { status: 404, headers: { 'content-type': 'text/html' } });

// ── Prompts ─────────────────────────────────────────────────────────────────

describe('prompts', () => {
    it('an unmatched job gets the #99 prompt, byte for byte (same sha256 as #99 at 1e1fc6a)', () => {
        expect(sha(buildUpskillPrompt('Electricians', 'Prepare sketches or follow blueprints', 'defend', 63))).toBe('4e3c590b4401b4ccdc467026d8ddc6ca723ea003d41b50469fa820c6d64aba94');
        expect(sha(buildUpskillPrompt('Registered Nurses', 'Monitor patients', 'build', 12))).toBe('968f27f90bd13af4a9eb9a2e5c7ba43fe5ceb54e1cb3de8aeed2bbd525ebf7bf');
        expect(sha(buildRoadmapPrompt('Electricians', 'Prepare sketches', 'Install wiring'))).toBe('ffac40b9de8febf3fb7209cbf49901c63ef3c6b7074fb814090958a10c158b8d');
        // an empty catalog is the same as none
        expect(buildUpskillPrompt('Electricians', 't', 'build', 10, [])).toBe(buildUpskillPrompt('Electricians', 't', 'build', 10));
    });

    it('a matched job\'s prompts list its catalog courses by id, ask for them first, allow one other', () => {
        for (const p of [
            buildUpskillPrompt('Accountants and Auditors', 'Prepare tax returns', 'defend', 70, CATALOG),
            buildUpskillPrompt('Accountants and Auditors', 'Advise clients', 'build', 20, CATALOG),
            buildRoadmapPrompt('Accountants and Auditors', 'Prepare tax returns', 'Advise clients', CATALOG),
        ]) {
            expect(p).toContain(`- id: ${CIA.id} | "Certified Internal Auditor" (The IIA, certification) | matched because: Auditing credential.`);
            expect(p).toContain(`- id: ${EXCEL.id} |`);
            expect(p).toMatch(/First recommend every course from this list that genuinely fits, giving its "catalogId" exactly as written above/);
            expect(p).toMatch(/add at most ONE other real course/);
            expect(p).toMatch(/"catalogId": null/);
            expect(p).toMatch(/Recommend at least one course/);
        }
        // Defend keeps its "move up the value chain" goal
        expect(buildUpskillPrompt('A', 't', 'defend', 70, CATALOG)).toMatch(/moves them UP the value chain/);
    });

    it('prompt versions bumped past #99, so no #99 answer is reused', () => {
        expect(AI_FEATURES.upskill.promptVersion).toBe('upskill-5');
        expect(AI_FEATURES.roadmap.promptVersion).toBe('roadmap-6');
    });
});

// ── Linking ─────────────────────────────────────────────────────────────────

describe('linking a matched job\'s courses', () => {
    it('a catalog id becomes its catalog page and title; Claude\'s own wording and url are not used', async () => {
        const { courses, rejected } = await linkCatalogCourses([
            { catalogId: CIA.id, title: 'CIA cert', provider: 'IIA', url: 'https://example.com/fake', duration: '', level: '' },
        ], CATALOG, { fetch: notFound });
        expect(rejected).toEqual([]);
        expect(courses).toEqual([{ catalogId: CIA.id, title: 'Certified Internal Auditor', provider: 'The IIA', duration: '', level: '', link: { href: CIA.url, kind: 'course', label: 'Open course' } }]);
    });

    it('an id not on this job\'s list is rejected; so is a repeat, and a second non-catalog course', async () => {
        const { courses, rejected } = await linkCatalogCourses([
            { catalogId: 'microsoft-learn:path:not-this-jobs', title: 'Elsewhere', provider: 'Microsoft Learn' },
            { catalogId: EXCEL.id, title: 'x', provider: 'y' },
            { catalogId: EXCEL.id, title: 'x again', provider: 'y' },
            { catalogId: null, title: 'Other One', provider: 'Coursera', url: 'https://www.coursera.org/learn/other-one' },
            { title: 'Other Two', provider: 'edX', url: '' },
        ], CATALOG, { fetch: notFound });
        expect(courses.map((c) => c.title)).toEqual([EXCEL.title, 'Other One']);
        expect(rejected.map((r) => r.why)).toEqual([
            'catalogId microsoft-learn:path:not-this-jobs is not on this job\'s list',
            `catalogId ${EXCEL.id} given twice`,
            'more than one course not from the list',
        ]);
    });

    it('the one other course goes through the #99 link check (here: not found, so a search)', async () => {
        const { courses } = await linkCatalogCourses([
            { title: 'Some Course', provider: 'Coursera', url: 'https://www.coursera.org/learn/some-course' },
        ], CATALOG, { fetch: notFound });
        expect(courses[0].link).toEqual({ href: 'https://www.coursera.org/search?query=Some%20Course', kind: 'search', label: 'Search on Coursera' });
    });

    it('finalize: matched → catalog links; no course left → the answer is rejected; unmatched → exactly #99', async () => {
        const answer = { courses: [{ catalogId: CIA.id, title: 'x', provider: 'y', duration: '', level: '' }], whyTheseCourses: 'w' };
        const done = await AI_FEATURES.upskill.finalize!(answer, { fetch: notFound, catalog: CATALOG }) as { courses: { link: { label: string; href: string } }[] };
        expect(done.courses[0].link).toEqual({ href: CIA.url, kind: 'course', label: 'Open course' });

        const bad = { courses: [{ catalogId: 'not-on-list', title: 'x', provider: 'y', duration: '', level: '' }], whyTheseCourses: 'w' };
        await expect(AI_FEATURES.upskill.finalize!(bad, { fetch: notFound, catalog: CATALOG })).rejects.toThrow(/no course left/);

        // No catalog: the #99 path (every course checked; Claude's url never kept).
        const plain = { courses: [{ title: 'Some Course', provider: 'Coursera', url: 'https://www.coursera.org/learn/some-course', duration: '', level: '' }], whyTheseCourses: 'w' };
        const p = await AI_FEATURES.upskill.finalize!(plain, { fetch: notFound }) as { courses: Record<string, unknown>[] };
        expect(p.courses[0]).toEqual({ title: 'Some Course', provider: 'Coursera', duration: '', level: '', link: { href: 'https://www.coursera.org/search?query=Some%20Course', kind: 'search', label: 'Search on Coursera' } });
    });

    it('an empty course list is rejected by the check, matched or not', () => {
        expect(() => AI_FEATURES.upskill.check({ courses: [], whyTheseCourses: '' }, { roleKey: 'soc:13-2011', title: 'A', taskName: 't', mode: 'defend', riskPercent: 70 })).toThrow();
        expect(() => AI_FEATURES.roadmap.check({ phases: [{ title: 'M1', items: ['a'] }], courses: [], resources: [], successMetrics: ['m'] }, { roleKey: 'soc:13-2011', title: 'A', riskTask: 'r', targetTask: 't' })).toThrow();
    });
});

// ── The server data ─────────────────────────────────────────────────────────

describe('server course data', () => {
    it('is exactly what catalog.json and matches.json build (re-run scripts/build_course_matches_server.ts)', () => {
        expect(fs.readFileSync(path.join(ROOT, SERVER_DATA_PATH), 'utf8')).toBe(renderServerCourseData(buildServerCourseData(ROOT)));
    });

    it('finds a job\'s courses by SOC role key and by Kelley role id; [] for an unmatched job', () => {
        expect(socForRoleKey('soc:13-2011')).toBe('13-2011');
        const kelley = Object.entries(COURSE_MATCHES_DATA.kelley)[0];
        expect(socForRoleKey(kelley[0])).toBe(kelley[1]);
        expect(matchedCoursesFor(kelley[0])).toEqual(matchedCoursesFor(`soc:${kelley[1]}`));
        const acct = matchedCoursesFor('soc:13-2011');
        expect(acct.map((c) => c.id)).toContain('cert-bodies:iia-cia');
        expect(acct.every((c) => c.url.startsWith('https://') && c.title && c.provider)).toBe(true);
        expect(matchedCoursesFor('soc:29-1141')).toEqual([]); // Registered Nurses: no match
        expect(matchedCoursesFor('soc:47-2111')).toEqual([]); // Electricians: no match
        expect(matchedCoursesFor('job-999')).toEqual([]);
    });

    it('a retired or removed catalog entry can never be matched: the server data build fails', () => {
        const entry = { id: 'x:retired', title: 'Old Cert', provider: 'Microsoft Learn', url: 'https://learn.microsoft.com/en-us/credentials/certifications/old/', type: 'certification' as const, price: 'unknown' as const, lastChecked: '2026-11-15' };
        const matches = { _meta: { promptVersion: 'v' }, matches: { '13-2011': [{ id: 'x:retired', reason: 'r' }] } };
        expect(() => assembleServerCourseData({ generated: 'g', entries: [] }, matches, [])).toThrow(/not in catalog.json/);
        expect(() => assembleServerCourseData({ generated: 'g', entries: [{ ...entry, description: 'Warning This certification and the renewal assessment are retired.' }] }, matches, [])).toThrow(/may not be offered/);
        expect(() => assembleServerCourseData({ generated: 'g', entries: [entry] }, matches, [])).not.toThrow();
        // and the committed data holds no retired course
        for (const c of Object.values(COURSE_MATCHES_DATA.courses)) expect(RETIRED.test(c.title)).toBe(false);
    });

    it('is server only: nothing in src/ (outside tests) imports it or the matches', () => {
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const name of fs.readdirSync(dir)) {
                const p = path.join(dir, name);
                if (fs.statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); }
                else if (/\.(ts|tsx)$/.test(name) && /(from|import)\s*\(?\s*['"][^'"]*(courseMatches|course_catalog|matches\.json)/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(ROOT, p));
            }
        };
        walk(path.join(ROOT, 'src'));
        expect(hits).toEqual([]);
    });
});

// ── Through the gateway (mock Claude) ───────────────────────────────────────

describe('the gateway', () => {
    let mock: MockBackend;
    beforeEach(() => { mock = createMockBackend(); });

    const handler = (catalogFor?: (k: string) => CatalogCourse[]) => createClaudeHandler({
        fetch: mock.fetch,
        linkFetch: notFound,
        env: () => ({ ANTHROPIC_API_KEY: 'sk-test', SUPABASE_URL: MOCK_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'sb' }),
        ...(catalogFor ? { catalogFor } : {}),
    });

    async function ask(h: ReturnType<typeof createClaudeHandler>, body: unknown) {
        let status = 200;
        let out = '';
        const res = { status(c: number) { status = c; return res; }, setHeader() {}, json(b: unknown) { out = JSON.stringify(b); }, send(b: string) { out = b; }, write() {}, end() {} };
        const req: ApiRequest = { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body };
        await h(req, res);
        return { status, json: JSON.parse(out) };
    }

    it('a matched job (real server data): catalog ids become "Open course" links to the catalog pages', async () => {
        const r = await ask(handler(), { feature: 'upskill', input: { roleKey: 'soc:13-2011', title: 'Accountants and Auditors', taskName: 'Prepare tax returns', mode: 'defend', riskPercent: 70 } });
        expect(r.status).toBe(200);
        const listed = matchedCoursesFor('soc:13-2011');
        const courses = r.json.result.courses as { catalogId?: string; title: string; link: { kind: string; href: string; label: string } }[];
        const fromCatalog = courses.filter((c) => c.catalogId);
        expect(fromCatalog).toHaveLength(2);
        for (const c of fromCatalog) {
            const entry = listed.find((x) => x.id === c.catalogId)!;
            expect(c.title).toBe(entry.title);
            expect(c.link).toEqual({ href: entry.url, kind: 'course', label: 'Open course' });
        }
    });

    it('an unmatched job: no catalog in the prompt, links exactly as #99', async () => {
        const r = await ask(handler(), { feature: 'upskill', input: { roleKey: 'soc:47-2111', title: 'Electricians', taskName: 'Prepare sketches or follow blueprints', mode: 'defend', riskPercent: 63 } });
        expect(r.status).toBe(200);
        const courses = r.json.result.courses as { catalogId?: string; link: { kind: string } }[];
        expect(courses.some((c) => c.catalogId)).toBe(false);
        expect(courses.every((c) => c.link.kind === 'search')).toBe(true); // every link "not found" here
    });

    it('a catalog the server did not give cannot be used: the browser cannot send one', async () => {
        const r = await ask(handler(() => []), { feature: 'upskill', input: { roleKey: 'soc:13-2011', title: 'A', taskName: 't', mode: 'build', riskPercent: 10, catalog: [CIA] } });
        expect(r.status).toBe(400); // the input schema is strict
    });
});
