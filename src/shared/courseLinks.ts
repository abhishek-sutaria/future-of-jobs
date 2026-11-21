/**
 * Turns the course links Claude suggests into links we have checked.
 *
 * Claude names each course with a URL, and some of those pages do not exist.
 * So on the server, before an answer is shown or saved, every link is checked
 * (all at once, each with a short timeout):
 *   1. https, on a provider in shared/courseProviders.ts, and not a home,
 *      search, listing or sign-in page;
 *   2. it loads: redirects are followed one by one, and every hop must stay on
 *      the list; the last answer must be a success status;
 *   3. the page is not a "not found" page, and its title names the course.
 * A link that passes is shown as "Open course". Any other is replaced with a
 * search for the exact course name ("Search on <Provider>"), or a web search
 * when the provider is not on the list. Claude's raw URL is never kept.
 *
 * Pure: no Vite, no DOM, no Node. The fetch is passed in.
 */

import { COURSE_PROVIDERS, webSearchUrl, type CourseProvider } from './courseProviders.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What the browser shows: never a URL that was not checked or built by us. */
export interface CourseLink {
    href: string;
    /** 'course': the page passed every check. 'search': a search for the course name. */
    kind: 'course' | 'search';
    /** "Open course", "Search on Coursera", or "Search the web". */
    label: string;
}

export interface LinkCheckOptions {
    fetch: FetchLike;
    /** Per link, for the whole redirect chain. */
    timeoutMs?: number;
}

export const LINK_TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 5;
/** The title and h1 sit near the top; never read a whole page. */
const MAX_BYTES = 400_000;

const REQUEST_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
};

// ── Providers ───────────────────────────────────────────────────────────────

const normName = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9()²&.]+/g, ' ').trim()} `;

/** The provider Claude named: the one whose longest alias appears in the name, first on the list on a tie. */
export function providerFor(name: string): CourseProvider | null {
    const hay = normName(name);
    let best: CourseProvider | null = null;
    let bestLen = 0;
    for (const p of COURSE_PROVIDERS) {
        for (const alias of p.aliases) {
            if (alias.length > bestLen && hay.includes(normName(alias))) {
                best = p;
                bestLen = alias.length;
            }
        }
    }
    return best;
}

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The provider whose site this URL is on, if any. */
export function providerOfUrl(url: URL): CourseProvider | null {
    const host = url.hostname.toLowerCase();
    return COURSE_PROVIDERS.find((p) => p.domains.some((d) => onDomain(host, d))) ?? null;
}

// ── Step 1: the URL itself ──────────────────────────────────────────────────

const LISTING_SEGMENTS = new Set([
    'search', 'catalog', 'browse', 'courses', 'course', 'results', 'explore', 'learn', 'learning', 'training',
    'certification', 'certifications', 'certificates', 'programs', 'all-courses', 'home', 'index.html',
    'subjects', 'topics', 'collections', 'paths', 'browse-courses', 'products',
]);
/** A path with one of these anywhere is a listing, article or topic page, never one course. */
const NEVER_A_COURSE = new Set(['search', 'browse', 'topics', 'topic', 'subjects', 'subject', 'collections', 'articles', 'article', 'blog', 'news', 'resources', 'categories', 'category', 'tag', 'tags']);
const SIGN_IN = /(^|[-_/])(login|log-in|signin|sign-in|signup|sign-up|authwall|uas|auth|checkpoint|404|not-found|page-not-found)([-_/.]|$)/i;
const SEARCH_PARAMS = ['q', 'query', 'keywords', 'searchquery', 'search', 'terms', 'term', 'page_search_query', 'searchvalue', 's'];
const LOCALE = /^[a-z]{2}([-_][a-z]{2,4})?$/i;

/** Why this URL can never be a course page, or null if it may be one. */
export function urlProblem(raw: string | URL): string | null {
    let url: URL;
    try {
        url = typeof raw === 'string' ? new URL(raw) : raw;
    } catch {
        return 'not a URL';
    }
    if (url.protocol !== 'https:') return 'not https';
    if (url.username || url.password) return 'carries credentials';
    if (url.port && url.port !== '443') return 'unusual port';
    const provider = providerOfUrl(url);
    if (!provider) return 'not on the provider list';

    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
    if (provider.pathPrefix && !`${path}/`.startsWith(provider.pathPrefix)) return 'not a course page on this site';
    const segments = path.split('/').filter(Boolean);
    const meaningful = segments.filter((s) => !LOCALE.test(s));
    if (meaningful.length === 0) return 'home page';
    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    if (params.some((k) => SEARCH_PARAMS.includes(k)) || segments.some((s) => s.toLowerCase() === 'search')) return 'search page';
    if (LISTING_SEGMENTS.has(meaningful[meaningful.length - 1].toLowerCase())) return 'listing page';
    if (segments.some((s) => NEVER_A_COURSE.has(s.toLowerCase()))) return 'listing or article page';
    if (provider.notCourse?.some((re) => re.test(path))) return 'topic page';
    if (SIGN_IN.test(path)) return 'sign-in or error page';
    return null;
}

// ── Step 3: the page ────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', reg: '', trade: '', copy: '' };

function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const clean = (s: string | undefined) => (s ? decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : '');

/** The page's own names for itself: <title>, og:title and the first <h1>. */
export function pageTitles(html: string): string[] {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)?.[0]?.match(/content=["']([^"']*)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i)?.[1];
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    return [title, og, h1].map(clean).filter(Boolean);
}

const NOT_FOUND = /\b(404|not found|page not found|cannot be found|can['’]t be found|could not be found|no longer (available|offered)|does not exist|doesn['’]t exist|page unavailable|course unavailable|something went wrong)\b/i;

const STOP = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'by', 'at', 'from', 'your', 'you', 'how',
    // generic course words: a page may drop them ("Professional Certificate", "Course")
    'course', 'courses', 'online', 'free', 'training', 'program', 'programme', 'certificate', 'certification',
    'certified', 'specialization', 'professional', 'class', 'learn', 'learning', 'introduction', 'intro', 'part',
]);

function words(s: string): string[] {
    return s
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/**
 * Share of the course name's words found on the page. Generic words count only
 * if the name is nothing but generic words. A credential's own acronym in
 * brackets ("Progressive Care Certified Nurse (PCCN)") is enough on its own
 * when the page names it: certification pages often use only the acronym.
 */
export function titleMatch(courseTitle: string, pageText: string[]): number {
    const have = new Set(pageText.flatMap(words));
    const acronyms = [...courseTitle.matchAll(/\(([A-Z][A-Za-z0-9]{2,7})\)/g)].map((m) => m[1].toLowerCase());
    if (acronyms.some((a) => have.has(a))) return 1;
    const all = words(courseTitle);
    const key = all.filter((w) => !STOP.has(w));
    const want = [...new Set(key.length > 0 ? key : all)];
    if (want.length === 0) return 0;
    return want.filter((w) => have.has(w)).length / want.length;
}

/** At least this share of the name's words must be in the page's title, og:title or h1. */
export const TITLE_MATCH_MIN = 0.7;

// ── Steps 2 and 3 together ──────────────────────────────────────────────────

export type LinkCheck = { ok: true; href: string } | { ok: false; reason: string };

async function readStart(res: Response, maxBytes: number): Promise<string> {
    if (!res.body) return (await res.text()).slice(0, maxBytes);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
        while (text.length < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) text += decoder.decode(value, { stream: true });
            // Everything we read sits in the head and the first heading.
            if (/<\/h1>/i.test(text.slice(-(value?.length ?? 0) - 8))) break;
        }
    } finally {
        reader.cancel().catch(() => {});
    }
    return text;
}

/** Checks one link Claude gave for a course. Never throws. */
export async function checkCourseUrl(raw: string, courseTitle: string, opts: LinkCheckOptions): Promise<LinkCheck> {
    const first = urlProblem(raw);
    if (first) return { ok: false, reason: first };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LINK_TIMEOUT_MS);
    try {
        let url = new URL(raw);
        let res: Response | null = null;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            res = await opts.fetch(url.toString(), { method: 'GET', redirect: 'manual', headers: REQUEST_HEADERS, signal: controller.signal });
            if (res.status < 300 || res.status >= 400) break;
            const location = res.headers.get('location');
            res.body?.cancel().catch(() => {});
            if (!location) return { ok: false, reason: `redirect ${res.status} with no location` };
            if (hop === MAX_REDIRECTS) return { ok: false, reason: 'too many redirects' };
            url = new URL(location, url);
            // Every hop must still be a course page on the list: catches a redirect to a home, search or sign-in page.
            const problem = urlProblem(url);
            if (problem) return { ok: false, reason: `redirects to a ${problem}` };
        }
        if (!res || !res.ok) {
            res?.body?.cancel().catch(() => {});
            return { ok: false, reason: `status ${res?.status ?? 'none'}` };
        }
        const type = res.headers.get('content-type') || '';
        if (type && !/html/i.test(type)) {
            res.body?.cancel().catch(() => {});
            return { ok: false, reason: `not a web page (${type})` };
        }
        const titles = pageTitles(await readStart(res, MAX_BYTES));
        if (titles.length === 0) return { ok: false, reason: 'page has no title' };
        if (titles.some((t) => NOT_FOUND.test(t))) return { ok: false, reason: 'a "not found" page' };
        const match = titleMatch(courseTitle, titles);
        if (match < TITLE_MATCH_MIN) return { ok: false, reason: `title does not match (${Math.round(match * 100)}%: "${titles[0].slice(0, 80)}")` };
        return { ok: true, href: url.toString() };
    } catch (err) {
        return { ok: false, reason: controller.signal.aborted ? 'timed out' : `failed to load (${err instanceof Error ? err.message : 'error'})` };
    } finally {
        clearTimeout(timer);
    }
}

// ── The fallback ────────────────────────────────────────────────────────────

/** A search for the exact course name: on the provider's own search, within its site, or on the web. */
export function searchLinkFor(courseTitle: string, providerName: string): CourseLink {
    const title = courseTitle.trim();
    const provider = providerFor(providerName);
    if (!provider) {
        const query = [`"${title}"`, providerName.trim()].filter(Boolean).join(' ');
        return { href: webSearchUrl(query), kind: 'search', label: 'Search the web' };
    }
    const href = provider.search ? provider.search(title) : webSearchUrl(`site:${provider.domains[0]} "${title}"`);
    return { href, kind: 'search', label: `Search on ${provider.name}` };
}

// ── What the features call ──────────────────────────────────────────────────

export interface RawCourse {
    title: string;
    provider: string;
    url?: string | null;
}

export type LinkedCourse<T extends RawCourse> = Omit<T, 'url'> & { link: CourseLink };

/** Checks one course's link; on any failure, the provider's search for its name. */
export async function linkCourse<T extends RawCourse>(course: T, opts: LinkCheckOptions): Promise<LinkedCourse<T>> {
    const { url, ...rest } = course;
    const raw = typeof url === 'string' ? url.trim() : '';
    const check = raw ? await checkCourseUrl(raw, course.title, opts) : { ok: false as const, reason: 'no link given' };
    const link: CourseLink = check.ok
        ? { href: check.href, kind: 'course', label: 'Open course' }
        : searchLinkFor(course.title, course.provider);
    return { ...rest, link };
}

/** Checks every course's link at once (each with its own timeout), keeping their order. */
export function linkCourses<T extends RawCourse>(courses: T[], opts: LinkCheckOptions): Promise<LinkedCourse<T>[]> {
    return Promise.all(courses.map((c) => linkCourse(c, opts)));
}

// ── Jobs with catalog courses (Step 3) ──────────────────────────────────────

/** A course in an answer for a job with catalog courses: from the list (catalogId) or one other. */
export interface CatalogAnswerCourse extends RawCourse {
    catalogId?: string | null;
}

export interface CatalogLinkResult<T extends CatalogAnswerCourse> {
    courses: LinkedCourse<T>[];
    /** Courses dropped, and why: an id not on this job's list, or a second course not from the list. */
    rejected: { title: string; why: string }[];
}

/**
 * For a job with catalog courses (shared/aiPrompts CatalogCourse):
 *   - a course with a catalogId on this job's list becomes the catalog entry
 *     itself: its own title, provider and checked URL ("Open course");
 *   - a catalogId that is not on this job's list is rejected (dropped);
 *   - at most `maxOther` courses without a catalogId are kept, and each goes
 *     through the same link check as every other course (linkCourse);
 *   - order is kept. The caller rejects the answer if nothing is left.
 */
export async function linkCatalogCourses<T extends CatalogAnswerCourse>(
    courses: T[],
    catalog: { id: string; title: string; provider: string; url: string; level?: string; duration?: string }[],
    opts: LinkCheckOptions & { maxOther?: number },
): Promise<CatalogLinkResult<T>> {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const maxOther = opts.maxOther ?? 1;
    const rejected: { title: string; why: string }[] = [];
    const seen = new Set<string>();
    let others = 0;
    const jobs: Promise<LinkedCourse<T> | null>[] = courses.map(async (course): Promise<LinkedCourse<T> | null> => {
        const id = typeof course.catalogId === 'string' ? course.catalogId.trim() : '';
        if (id) {
            const entry = byId.get(id);
            if (!entry) { rejected.push({ title: course.title, why: `catalogId ${id} is not on this job's list` }); return null; }
            if (seen.has(id)) { rejected.push({ title: course.title, why: `catalogId ${id} given twice` }); return null; }
            seen.add(id);
            const { url: _url, catalogId: _cid, ...rest } = course;
            void _url; void _cid;
            const filled = rest as Record<string, unknown>;
            return {
                ...(rest as Omit<T, 'url'>),
                title: entry.title,
                provider: entry.provider,
                ...('duration' in filled ? { duration: entry.duration || (typeof filled.duration === 'string' ? filled.duration : '') } : {}),
                ...('level' in filled ? { level: entry.level || (typeof filled.level === 'string' ? filled.level : '') } : {}),
                catalogId: id,
                link: { href: entry.url, kind: 'course', label: 'Open course' },
            } as unknown as LinkedCourse<T>;
        }
        if (others >= maxOther) { rejected.push({ title: course.title, why: 'more than one course not from the list' }); return null; }
        others++;
        const { catalogId: _cid, ...rest } = course;
        void _cid;
        return linkCourse(rest as T, opts) as Promise<LinkedCourse<T>>;
    });
    const done = await Promise.all(jobs);
    return { courses: done.filter((c) => c !== null) as LinkedCourse<T>[], rejected };
}
