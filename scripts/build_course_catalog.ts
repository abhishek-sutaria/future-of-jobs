/**
 * Builds the course catalog (Step 1 of 3): real courses and certifications
 * from each provider's own official public list, kept only if their link
 * passes the app's link check (src/shared/courseLinks.ts). The method is in
 * scripts/lib/courseCatalog.ts; sources, counts and what was skipped are in
 * docs/course-catalog.md.
 *
 *   npx tsx scripts/build_course_catalog.ts            collect every list, check every link, write the outputs
 *   npx tsx scripts/build_course_catalog.ts --fresh    the same, ignoring the download cache
 *   npx tsx scripts/build_course_catalog.ts --cache-days 30   reuse downloads up to 30 days old (re-apply the filters, no new downloads)
 *   npx tsx scripts/build_course_catalog.ts --check    re-check every link in catalog.json (monthly refresh);
 *                                                      entries that fail twice are removed and listed in check_report.json
 *
 * Writes data/course_catalog/{catalog,sources,report}.json, data/course_catalog/raw/*,
 * and the counts section of docs/course-catalog.md. The catalog is data only:
 * nothing in src/ imports it, so it is not in the app's bundle.
 *
 * No Claude calls. Every request: honest user agent, robots.txt obeyed, one
 * request per host per second at most. Downloads are cached (gzip) in
 * .cache/course_catalog/ for 7 days; --check never uses the cache.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
    CATALOG_PATHS,
    certCandidate,
    checkCandidate,
    dedupeByUrl,
    GROW_SITEMAP_URL,
    isoDay,
    MS_CATALOG_URL,
    msExtract,
    parseMsCatalog,
    parseSkillsCatalogPage,
    parseSkillsItems,
    perHost,
    PoliteFetcher,
    recheckEntry,
    selectGrowPages,
    sha256,
    sitemapLocs,
    SKILLS_CATALOG_URL,
    sortEntries,
    USER_AGENT,
    type Candidate,
    type CatalogEntry,
    type CertPage,
    type Dropped,
    type FetchedPage,
    type MsCatalog,
    type PageCache,
    type SkillsItem,
    type SourceKey,
} from './lib/courseCatalog';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const abs = (rel: string) => path.join(ROOT, rel);
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** The sites the brief named that this catalog does not collect from, and why (read 2026-11-15). */
export const SKIPPED: { site: string; reason: string; evidence: string }[] = [
    { site: 'Coursera', reason: 'Terms of Use forbid scraping or data extraction by automated means without written consent', evidence: 'https://www.coursera.org/about/terms' },
    { site: 'edX', reason: 'Terms of Service forbid spiders, robots, crawlers and data mining tools other than edX\'s own', evidence: 'https://www.edx.org/edx-terms-service (section 11.6)' },
    { site: 'LinkedIn Learning', reason: 'robots.txt: automated access without LinkedIn\'s express permission is prohibited', evidence: 'https://www.linkedin.com/robots.txt' },
    { site: 'Khan Academy', reason: 'Terms of Service forbid using software to scrape the Services or copy data from them', evidence: 'https://www.khanacademy.org/about/tos (section 9)' },
    { site: 'AWS (Skill Builder, certifications)', reason: 'AWS Site Terms (linked as "Legal" from Skill Builder) exclude data mining, robots and similar data gathering tools', evidence: 'https://aws.amazon.com/terms/' },
    { site: 'Udemy', reason: 'skipped by the brief (blocks link checks)', evidence: '' },
    { site: 'AICPA & CIMA (CPA)', reason: 'Terms forbid robots, spiders or other automatic means to access the website', evidence: 'https://www.aicpa-cima.com/help/terms-and-conditions (3.2.8)' },
    { site: 'CFA Institute', reason: 'Terms forbid robots, scrapers, crawlers and automated scripts', evidence: 'https://www.cfainstitute.org/about/governance/policies/terms-conditions' },
    { site: 'PMI (PMP)', reason: 'blocks us: the home page answers 403 to our honest user agent', evidence: 'https://www.pmi.org/' },
    { site: 'ISACA', reason: 'Terms forbid robots, spiders or other automatic programs to copy or extract information', evidence: 'https://www.isaca.org/terms-of-use' },
    { site: 'SHRM', reason: 'Terms forbid crawlers, bots and spiders and scraping', evidence: 'https://www.shrm.org/legal/terms-of-use' },
    { site: 'NASBA', reason: 'Terms: automated tools are not eligible for access; scraping and data mining strictly prohibited', evidence: 'https://nasba.org/termsofuse' },
    { site: 'HRCI', reason: 'Terms expressly prohibit data scraping', evidence: 'https://www.hrci.org/terms-of-use' },
    { site: 'CompTIA', reason: 'Terms forbid scraping the contents of the Services', evidence: 'https://www.comptia.org/en-us/legal/terms-of-use/' },
    { site: 'IIBA', reason: 'Terms forbid indexing or cataloguing the Services without written consent', evidence: 'https://www.iiba.org/footer/terms-of-use/' },
    { site: 'FINRA', reason: 'Terms forbid data mining, scraping or harvesting tools (including robots)', evidence: 'https://www.finra.org/terms-of-use' },
    { site: 'AHIMA', reason: 'Terms forbid robots or spiders to access, scrape or index the site', evidence: 'https://www.ahima.org/privacy-policy-terms-conditions/terms-conditions/' },
    { site: 'ANCC (American Nurses Association)', reason: 'Terms forbid copying by scraping, robots, spiders or crawlers', evidence: 'https://www.nursingworld.org/legal/' },
    { site: 'ServSafe', reason: 'Terms forbid any robot, spider or other automatic device', evidence: 'https://www.servsafe.com/Terms-of-Use' },
    { site: 'NASM', reason: 'Terms forbid robots, spiders, scrapers or other automated means', evidence: 'https://auth.nasm.org/terms.html' },
    { site: 'NCCER', reason: 'Terms forbid aggregating NCCER content without written permission', evidence: 'https://www.nccer.org/terms-conditions/' },
    { site: 'ASCM / APICS', reason: 'terms page could not be read (empty without JavaScript; browser access not allowed), so not used', evidence: 'https://www.ascm.org/terms-of-use/' },
    { site: '(ISC)²', reason: 'terms page could not be found or read, so not used', evidence: 'https://www.isc2.org/' },
    { site: 'ACFE, IMA', reason: 'terms of use could not be found or read, so not used', evidence: 'https://www.acfe.com/legal-and-site-policies, https://www.imaglobal.org/legal' },
    { site: 'AACN', reason: 'terms allow it, but the certification list is built by JavaScript: no certification links on the official listing page', evidence: 'https://www.aacn.org/certification/get-certified' },
    { site: 'Scrum.org, OSHA, American Red Cross', reason: 'block us: robots.txt and home page answer 403', evidence: '' },
];

const SOURCE_LABEL: Record<SourceKey, string> = {
    'microsoft-learn': 'Microsoft Learn',
    'google-skills': 'Google Skills (Cloud Skills Boost)',
    'grow-google': 'Grow with Google',
    'cert-bodies': 'Certification bodies (IIA, PeopleCert, ACE)',
};
const SOURCE_USED: Record<SourceKey, string> = {
    'microsoft-learn': 'official Catalog API',
    'google-skills': 'official catalog pages (the list they carry as data)',
    'grow-google': 'sitemap listed in robots.txt',
    'cert-bodies': 'hand-reviewed pages from each body\'s official certification listing',
};

// ── Download cache ──────────────────────────────────────────────────────────

function diskCache(maxAgeMs: number): PageCache {
    const dir = abs(path.join(CATALOG_PATHS.cache, 'pages'));
    fs.mkdirSync(dir, { recursive: true });
    const file = (url: string) => path.join(dir, `${sha256(url).slice(0, 32)}.json.gz`);
    return {
        get(url) {
            try {
                const page = JSON.parse(zlib.gunzipSync(fs.readFileSync(file(url))).toString('utf8')) as FetchedPage;
                return page.url === url && Date.now() - page.fetchedAt < maxAgeMs ? page : undefined;
            } catch {
                return undefined;
            }
        },
        set(page) {
            // Keep only pages worth reusing: successes and redirects.
            if (page.status >= 200 && page.status < 400) fs.writeFileSync(file(page.url), zlib.gzipSync(JSON.stringify(page)));
        },
    };
}

// ── Outputs ─────────────────────────────────────────────────────────────────

interface SourceRecord {
    source: SourceKey | 'robots-and-terms';
    title: string;
    publisher: string;
    url: string;
    retrieved: string;
    sha256: string;
    bytes: number;
    path?: string;
    pathSha256?: string;
    note?: string;
    pages?: { url: string; sha256: string; bytes: number }[];
}

function writeJson(rel: string, data: unknown): string {
    const body = `${JSON.stringify(data, null, 2)}\n`;
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), body);
    return body;
}

function record(page: FetchedPage, source: SourceKey, title: string, publisher: string, rawRel?: string, rawBody?: string, note?: string): SourceRecord {
    return {
        source,
        title,
        publisher,
        url: page.url,
        retrieved: isoDay(page.fetchedAt),
        sha256: sha256(page.body),
        bytes: Buffer.byteLength(page.body),
        ...(rawRel ? { path: path.relative(CATALOG_PATHS.dir, rawRel), pathSha256: sha256(rawBody ?? '') } : {}),
        ...(note ? { note } : {}),
    };
}

function catalogFile(entries: CatalogEntry[], generated: string) {
    const byProvider: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byPrice: Record<string, number> = {};
    for (const e of entries) {
        byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1;
        byType[e.type] = (byType[e.type] ?? 0) + 1;
        byPrice[e.price] = (byPrice[e.price] ?? 0) + 1;
    }
    return {
        _about: 'Real courses and certifications from each provider\'s own official public list, every link checked by the app\'s checkCourseUrl (src/shared/courseLinks.ts). Built by scripts/build_course_catalog.ts; see docs/course-catalog.md. Not imported by the app: server-side / offline data for Step 2.',
        generated,
        count: entries.length,
        byProvider,
        byType,
        byPrice,
        entries,
    };
}

const DOC_START = '<!-- counts:start (written by scripts/build_course_catalog.ts) -->';
const DOC_END = '<!-- counts:end -->';

interface SiteRow { source: SourceKey; collected: number; passed: number; dropped: Record<string, number> }

function countsMarkdown(rows: SiteRow[], total: number, sizeBytes: number, generated: string, runSeconds: number | null, dupes: number, fromCache = false): string {
    const when = fromCache ? `Last run: ${generated}, re-applying the filters to the saved downloads (no new downloads)` : `Last full run: ${generated}${runSeconds !== null ? `, ${Math.round(runSeconds / 60)} min` : ''}`;
    const lines = [DOC_START, '', `${when}. Catalog: **${total.toLocaleString('en-US')} entries**, ${(sizeBytes / 1024).toFixed(0)} KB.`, ''];
    for (const r of rows) {
        const reasons = Object.entries(r.dropped).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`);
        lines.push(`- **${SOURCE_LABEL[r.source]}** (${SOURCE_USED[r.source]}): collected ${r.collected}, passed the check ${r.passed}, dropped ${r.collected - r.passed}${reasons.length ? `: ${reasons.join('; ')}` : ''}.`);
    }
    if (dupes) lines.push(`- ${dupes} entries were the same page as an earlier one (same URL) and kept once.`);
    lines.push('', DOC_END);
    return lines.join('\n');
}

function updateDoc(counts: string): void {
    const file = abs(CATALOG_PATHS.doc);
    if (!fs.existsSync(file)) return;
    const doc = fs.readFileSync(file, 'utf8');
    const a = doc.indexOf(DOC_START);
    const b = doc.indexOf(DOC_END);
    if (a < 0 || b < 0) return;
    fs.writeFileSync(file, doc.slice(0, a) + counts + doc.slice(b + DOC_END.length));
}

// ── Collect ─────────────────────────────────────────────────────────────────

const log = (msg: string) => console.log(`[catalog] ${msg}`);

async function collect(fetcher: PoliteFetcher): Promise<{ candidates: Candidate[]; dropped: Dropped[]; sources: SourceRecord[] }> {
    const candidates: Candidate[] = [];
    const dropped: Dropped[] = [];
    const sources: SourceRecord[] = [];

    // Microsoft Learn: the Catalog API. The answer is committed as downloaded.
    {
        const page = await fetcher.download(MS_CATALOG_URL);
        const data = JSON.parse(page.body) as MsCatalog;
        const rawRel = `${CATALOG_PATHS.raw}/microsoft_learn_catalog.json`;
        fs.mkdirSync(abs(CATALOG_PATHS.raw), { recursive: true });
        fs.writeFileSync(abs(rawRel), page.body);
        sources.push(record(page, 'microsoft-learn', 'Microsoft Learn Catalog API, en-us: learning paths, certifications, instructor-led courses, Applied Skills, and the product/role/subject/level names', 'Microsoft', rawRel, page.body, 'bytes unchanged'));
        const found = parseMsCatalog(msExtract(data));
        log(`Microsoft Learn: ${found.length} from the API`);
        candidates.push(...found);
    }

    // Google Skills: every catalog page; the list is the pagedSearchResults data on each.
    {
        const first = await fetcher.download(SKILLS_CATALOG_URL(1));
        const p1 = parseSkillsCatalogPage(first.body);
        const pagesN = Math.ceil(p1.resultsCount / p1.itemsPerPage);
        const items: SkillsItem[] = [...p1.items];
        const pageRecords = [{ url: first.url, sha256: sha256(first.body), bytes: Buffer.byteLength(first.body) }];
        for (let n = 2; n <= pagesN; n++) {
            const page = await fetcher.download(SKILLS_CATALOG_URL(n));
            items.push(...parseSkillsCatalogPage(page.body).items);
            pageRecords.push({ url: page.url, sha256: sha256(page.body), bytes: Buffer.byteLength(page.body) });
            if (n % 25 === 0) log(`Google Skills: catalog page ${n}/${pagesN}`);
        }
        const rawRel = `${CATALOG_PATHS.raw}/google_skills_catalog_items.json`;
        const rawBody = writeJson(rawRel, { _about: `Every item of the ${pagesN} catalog pages, as each page's pagedSearchResults gave it, in page order. Page hashes are in sources.json.`, resultsCount: p1.resultsCount, items });
        sources.push({
            ...record(first, 'google-skills', `Google Skills catalog, all ${pagesN} pages (${p1.itemsPerPage} items each, ${p1.resultsCount} items)`, 'Google (Qwiklabs, Inc.)', rawRel, rawBody, 'sha256/bytes = page 1; every page is listed in pages'),
            url: 'https://www.skills.google/catalog?page=N',
            pages: pageRecords,
        });
        const parsed = parseSkillsItems(items);
        log(`Google Skills: ${items.length} items, ${parsed.candidates.length} courses`);
        candidates.push(...parsed.candidates);
        dropped.push(...parsed.dropped);
    }

    // Grow with Google: the sitemap named in robots.txt.
    {
        const page = await fetcher.download(GROW_SITEMAP_URL);
        const locs = sitemapLocs(page.body);
        const rawRel = `${CATALOG_PATHS.raw}/grow_google_sitemap_locs.json`;
        const rawBody = writeJson(rawRel, { _about: 'Every <loc> of the sitemap, in order.', locs });
        sources.push(record(page, 'grow-google', 'Grow with Google sitemap (named in grow.google/robots.txt)', 'Google', rawRel, rawBody, 'the full sitemap is not committed (2 MB); its <loc> list is'));
        const found = selectGrowPages(locs);
        log(`Grow with Google: ${locs.length} sitemap URLs, ${found.length} certificate and course pages`);
        candidates.push(...found);
    }

    // Certification bodies: the hand-reviewed list, each still linked from its listing page.
    {
        const list = (JSON.parse(fs.readFileSync(abs(CATALOG_PATHS.certPages), 'utf8')) as { pages: CertPage[] }).pages;
        const listings = new Map<string, FetchedPage | Error>();
        for (const url of new Set(list.map((p) => p.listingUrl))) {
            try {
                const page = await fetcher.download(url);
                listings.set(url, page);
                const links = list.filter((p) => p.listingUrl === url).map((p) => p.url);
                sources.push(record(page, 'cert-bodies', `Official certification listing page: ${new URL(url).hostname}`, new URL(url).hostname, undefined, undefined, `used for: ${links.join(', ')}`));
            } catch (err) {
                listings.set(url, err instanceof Error ? err : new Error(String(err)));
            }
        }
        for (const p of list) {
            const listing = listings.get(p.listingUrl);
            const id = `cert-bodies:${p.key}`;
            if (!listing || listing instanceof Error) {
                dropped.push({ id, title: p.linkText, url: p.url, source: 'cert-bodies', reason: `listing page did not load (${listing instanceof Error ? listing.message : 'error'})` });
                continue;
            }
            const c = certCandidate(p, listing.body);
            if ('reason' in c) dropped.push({ id, title: p.linkText, url: p.url, source: 'cert-bodies', reason: c.reason });
            else candidates.push(c);
        }
    }
    return { candidates, dropped, sources };
}

/** Short, countable reason: "title does not match (40%: ...)" → "title does not match". */
const reasonKey = (r: string) => r.replace(/\s*\(.*$/, '').replace(/^status \d+$/, (s) => s).trim();

async function build(fresh: boolean, cacheDays: number): Promise<void> {
    const started = Date.now();
    const today = isoDay(started);
    const fetcher = new PoliteFetcher({ fetch: globalThis.fetch.bind(globalThis), minIntervalMs: 1000, cache: fresh ? undefined : diskCache(cacheDays * 24 * 3600 * 1000), log });
    log(`user agent: ${USER_AGENT}`);
    const { candidates, dropped: listDropped, sources } = await collect(fetcher);

    log(`checking ${candidates.length} links (one request per host per second)...`);
    let lastLog = 0;
    const results = await perHost(candidates, (c) => c.url, (c) => checkCandidate(c, { fetcher, today }), (done, total) => {
        if (done - lastLog >= 100 || done === total) { lastLog = done; log(`checked ${done}/${total} (${fetcher.requests} requests)`); }
    });

    // Failures that may be passing trouble (a timeout, a dropped connection) get one more try.
    const retry = results.map((r, i) => (!r.ok && /timed out|failed to load|status 5\d\d|status 429/.test(r.reason) ? i : -1)).filter((i) => i >= 0);
    for (const i of retry) {
        const url = candidates[i].url;
        for (const k of [...fetcher.pages.keys()]) if (k.startsWith(url.split('?')[0])) fetcher.pages.delete(k);
    }
    if (retry.length) {
        log(`retrying ${retry.length} that timed out or failed to load...`);
        const again = await perHost(retry, (i) => candidates[i].url, (i) => checkCandidate(candidates[i], { fetcher, today, timeoutMs: 60_000 }));
        retry.forEach((i, k) => { results[i] = again[k]; });
    }

    const passed: CatalogEntry[] = [];
    const dropped: Dropped[] = [...listDropped];
    results.forEach((r, i) => {
        const c = candidates[i];
        if (r.ok) passed.push(r.entry);
        else dropped.push({ id: c.id, title: c.title, url: c.url, source: c.source, reason: r.reason });
    });
    const { kept, dupes } = dedupeByUrl(passed);
    const entries = sortEntries(kept);

    // Per-site counts. "Collected" = every item in the site's list (Google Skills labs included).
    const order: SourceKey[] = ['microsoft-learn', 'google-skills', 'grow-google', 'cert-bodies'];
    const rows: SiteRow[] = order.map((source) => {
        const mine = dropped.filter((d) => d.source === source);
        const reasons: Record<string, number> = {};
        for (const d of mine) reasons[reasonKey(d.reason)] = (reasons[reasonKey(d.reason)] ?? 0) + 1;
        const passedN = kept.filter((e) => e.id.startsWith(`${source}:`)).length;
        const dupesN = dupes.filter((e) => e.id.startsWith(`${source}:`)).length;
        if (dupesN) reasons['same page as another entry'] = dupesN;
        return { source, collected: passedN + mine.length + dupesN, passed: passedN, dropped: reasons };
    });

    const catalogBody = writeJson(CATALOG_PATHS.catalog, catalogFile(entries, today));
    writeJson(CATALOG_PATHS.sources, {
        _about: 'Every list the catalog was built from: URL, date, sha256 and size of exactly what was downloaded (and of the committed copy or extract in raw/, if any). Robots.txt and terms were read for every site before collecting; see docs/course-catalog.md.',
        userAgent: USER_AGENT,
        files: sources,
    });
    writeJson(CATALOG_PATHS.report, {
        _about: 'Counts per site and every dropped item with its reason. Written by scripts/build_course_catalog.ts.',
        generated: today,
        requests: fetcher.requests,
        sites: rows,
        skipped: SKIPPED,
        dropped: dropped.sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id)),
        duplicates: dupes.map((e) => ({ id: e.id, url: e.url })),
    });
    const seconds = (Date.now() - started) / 1000;
    updateDoc(countsMarkdown(rows, entries.length, Buffer.byteLength(catalogBody), today, seconds, dupes.length, fetcher.requests < candidates.length / 10));
    for (const r of rows) log(`${SOURCE_LABEL[r.source]}: collected ${r.collected}, passed ${r.passed}, dropped ${r.collected - r.passed} ${JSON.stringify(r.dropped)}`);
    log(`catalog: ${entries.length} entries, ${(Buffer.byteLength(catalogBody) / 1024).toFixed(0)} KB, ${fetcher.requests} requests, ${Math.round(seconds)} s`);
}

async function check(): Promise<void> {
    const started = Date.now();
    const today = isoDay(started);
    const file = JSON.parse(fs.readFileSync(abs(CATALOG_PATHS.catalog), 'utf8')) as { entries: CatalogEntry[] };
    const fetcher = new PoliteFetcher({ fetch: globalThis.fetch.bind(globalThis), minIntervalMs: 1000, log });
    log(`re-checking ${file.entries.length} links...`);
    let lastLog = 0;
    const results = await perHost(file.entries, (e) => e.url, (e) => recheckEntry(e, { fetcher, today }), (done, total) => {
        if (done - lastLog >= 100 || done === total) { lastLog = done; log(`checked ${done}/${total}`); }
    });
    const failed = results.map((r, i) => (r.ok ? -1 : i)).filter((i) => i >= 0);
    for (const i of failed) fetcher.pages.delete(new URL(file.entries[i].url).toString());
    if (failed.length) {
        log(`second try for ${failed.length} that failed...`);
        const again = await perHost(failed, (i) => file.entries[i].url, (i) => recheckEntry(file.entries[i], { fetcher, today, timeoutMs: 60_000 }));
        failed.forEach((i, k) => { results[i] = again[k]; });
    }
    const kept: CatalogEntry[] = [];
    const removed: { id: string; title: string; url: string; reason: string }[] = [];
    results.forEach((r, i) => {
        const e = file.entries[i];
        if (r.ok) kept.push(r.entry);
        else removed.push({ id: e.id, title: e.title, url: e.url, reason: r.reason });
    });
    const entries = sortEntries(kept);
    writeJson(CATALOG_PATHS.catalog, catalogFile(entries, today));
    writeJson(CATALOG_PATHS.checkReport, { _about: 'The last --check run: entries whose link failed twice and were removed from catalog.json.', checked: today, before: file.entries.length, after: entries.length, removed });
    log(`checked ${file.entries.length}: ${entries.length} still pass, ${removed.length} removed (see ${CATALOG_PATHS.checkReport}), ${Math.round((Date.now() - started) / 1000)} s`);
}

const args = process.argv.slice(2);
const cacheDaysArg = args.indexOf('--cache-days');
const cacheDays = cacheDaysArg >= 0 ? Number(args[cacheDaysArg + 1]) : CACHE_MAX_AGE_MS / (24 * 3600 * 1000);
(args.includes('--check') ? check() : build(args.includes('--fresh'), cacheDays)).catch((err) => {
    console.error(err);
    process.exit(1);
});
