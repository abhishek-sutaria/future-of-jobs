/**
 * The course catalog (Step 1 of 3): real courses and certifications, taken
 * from each provider's OWN official public list, kept only if their link
 * passes the app's own link check (src/shared/courseLinks.ts, checkCourseUrl).
 * scripts/build_course_catalog.ts runs it; docs/course-catalog.md explains the
 * sources, what was skipped and why, and how to re-run.
 *
 * Sources (only sites whose robots.txt and terms allow automated collection):
 *   - Microsoft Learn: the public Catalog API (learn.microsoft.com/api/catalog)
 *   - Google Skills (Google Cloud Skills Boost): its public catalog pages
 *     (www.skills.google/catalog?page=N), which carry the list as data
 *   - Grow with Google: the sitemap listed in grow.google/robots.txt
 *   - certification bodies: a small hand-reviewed list of their official
 *     certification pages, each still linked from the body's own listing page
 *
 * Every field of an entry comes from the site itself: the list (title, level,
 * duration, description, tags) or the course page (lang, meta description,
 * price shown). Nothing is guessed: a field the site does not give is left out,
 * and price is "unknown" unless the site says.
 *
 * No Claude calls. Network goes through PoliteFetcher: an honest user agent,
 * robots.txt obeyed for every request, one request per host at a time with a
 * pause between them, and downloads cached in .cache/course_catalog/.
 */

import crypto from 'node:crypto';
import { checkCourseUrl, pageTitles, providerOfUrl, titleMatch, TITLE_MATCH_MIN, type FetchLike } from '../../src/shared/courseLinks';

export const sha256 = (buf: Buffer | Uint8Array | string): string => crypto.createHash('sha256').update(buf).digest('hex');

export const CATALOG_PATHS = {
    dir: 'data/course_catalog',
    catalog: 'data/course_catalog/catalog.json',
    sources: 'data/course_catalog/sources.json',
    report: 'data/course_catalog/report.json',
    checkReport: 'data/course_catalog/check_report.json',
    raw: 'data/course_catalog/raw',
    certPages: 'data/course_catalog/cert_pages.json',
    doc: 'docs/course-catalog.md',
    cache: '.cache/course_catalog',
} as const;

export const USER_AGENT = 'FutureOfJobsCourseCatalog/1.0 (+https://github.com/abhishek-sutaria/future-of-jobs; course link checker, rate-limited)';
/** The token matched against robots.txt "User-agent:" lines. */
export const ROBOTS_TOKEN = 'futureofjobscoursecatalog';

// ── Entries ─────────────────────────────────────────────────────────────────

export type EntryType = 'course' | 'certificate' | 'certification';
export type Price = 'free' | 'paid' | 'free-to-audit' | 'unknown';

export interface CatalogEntry {
    id: string;
    title: string;
    provider: string;
    url: string;
    type: EntryType;
    level?: string;
    duration?: string;
    price: Price;
    description?: string;
    tags?: string[];
    lastChecked: string;
}

/** A course from a list, before its link is checked. */
export interface Candidate extends Omit<CatalogEntry, 'lastChecked' | 'provider'> {
    /** Which source it came from (a key of SOURCES). */
    source: SourceKey;
    /** For sources that only give a URL: take title, description and type from the page. */
    fromPage?: { typeFromTitle?: boolean };
}

export type SourceKey = 'microsoft-learn' | 'google-skills' | 'grow-google' | 'cert-bodies';

// ── Text helpers ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', reg: '®', trade: '™', copy: '©' };

export function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** Plain text: tags out, entities decoded (twice, for double-encoded meta tags), spaces collapsed. */
export function plainText(s: string | undefined | null): string {
    if (!s) return '';
    let t = s;
    for (let i = 0; i < 2; i++) t = decodeEntities(t.replace(/<[^>]*>/g, ' '));
    return t.replace(/<[^>]*>/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

export const DESCRIPTION_MAX = 200;

/** The site's own description, cut at a word boundary to at most 200 characters. */
export function shortDescription(s: string | undefined | null, max = DESCRIPTION_MAX): string | undefined {
    const t = plainText(s);
    if (!t) return undefined;
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

const EN_WORDS = new Set(['the', 'and', 'of', 'to', 'in', 'for', 'with', 'your', 'you', 'how', 'on', 'is', 'are', 'this', 'learn', 'using', 'an', 'skills', 'from', 'will', 'that']);
const OTHER_WORDS = new Set(['de', 'la', 'el', 'los', 'las', 'para', 'con', 'una', 'del', 'y', 'que', 'em', 'da', 'do', 'das', 'dos', 'com', 'uma', 'le', 'les', 'des', 'et', 'pour', 'une', 'und', 'der', 'die', 'mit', 'für', 'di', 'il', 'per', 'yang', 'dan', 'como', 'sobre', 'en', 'au', 'du']);

/** Why this text is not English, or null. Non-Latin script, or more Spanish/Portuguese/French/German/Italian/Indonesian function words than English ones. */
export function notEnglish(text: string): string | null {
    const letters = [...text].filter((c) => /\p{L}/u.test(c));
    if (letters.length === 0) return null;
    const nonLatin = letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length;
    if (nonLatin / letters.length > 0.1) return 'not English (non-Latin script)';
    const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
    const en = words.filter((w) => EN_WORDS.has(w)).length;
    const other = words.filter((w) => OTHER_WORDS.has(w)).length;
    if (other >= 3 && other > en) return 'not English';
    return null;
}

/** Tracking and ranking parameters the sites add to their own links; the course page is the same without them. */
const TRACKING = /^(wt\.mc_id|catalog_rank|utm_[a-z]+|ref|source|trk|search_id|locale)$/i;

export function canonicalUrl(raw: string, base?: string): string {
    const u = new URL(raw, base);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
}

// ── robots.txt ──────────────────────────────────────────────────────────────

interface RobotsRule { allow: boolean; pattern: string }
export interface Robots { rules: RobotsRule[]; crawlDelaySec?: number; sitemaps: string[] }

/** The rules for our user agent: its own group if one names it, else the "*" group. */
export function parseRobots(txt: string, token = ROBOTS_TOKEN): Robots {
    type Group = { agents: string[]; rules: RobotsRule[]; delay?: number };
    const groups: Group[] = [];
    const sitemaps: string[] = [];
    let cur: Group | null = null;
    let lastWasAgent = false;
    for (const rawLine of txt.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'sitemap') { sitemaps.push(val); continue; }
        if (key === 'user-agent') {
            if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
            cur.agents.push(val.toLowerCase());
            lastWasAgent = true;
            continue;
        }
        lastWasAgent = false;
        if (!cur) continue;
        if (key === 'allow' || key === 'disallow') {
            if (val === '' && key === 'disallow') continue; // "Disallow:" with nothing = allow all
            cur.rules.push({ allow: key === 'allow', pattern: val });
        } else if (key === 'crawl-delay') {
            const d = Number(val);
            if (Number.isFinite(d)) cur.delay = d;
        }
    }
    const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
    const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
    return {
        rules: chosen.flatMap((g) => g.rules),
        crawlDelaySec: chosen.map((g) => g.delay).find((d) => d !== undefined),
        sitemaps,
    };
}

function patternRegex(pattern: string): RegExp {
    const anchored = pattern.endsWith('$');
    const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
export function robotsAllows(robots: Robots, url: string): boolean {
    const u = new URL(url);
    const target = `${u.pathname}${u.search}`;
    let best: RobotsRule | null = null;
    for (const r of robots.rules) {
        if (!patternRegex(r.pattern).test(target)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
    }
    return best ? best.allow : true;
}

// ── The polite fetcher ──────────────────────────────────────────────────────

export interface FetchedPage {
    url: string;
    status: number;
    location?: string;
    contentType?: string;
    /** The full text, kept only for the current run (cache stores a summary). */
    body: string;
    fetchedAt: number;
}

export interface PoliteOptions {
    fetch: FetchLike;
    minIntervalMs?: number;
    maxBytes?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    log?: (msg: string) => void;
    /** Pages fetched earlier (the build's disk cache); never used by --check. */
    cache?: PageCache;
}

export interface PageCache {
    get(url: string): FetchedPage | undefined;
    set(page: FetchedPage): void;
}

export class RobotsBlocked extends Error {}

/**
 * Every network request of the build goes through here: robots.txt is read
 * once per host and obeyed; requests to one host are spaced by minIntervalMs
 * (or the site's Crawl-delay, if longer); the user agent says who we are.
 */
export class PoliteFetcher {
    /** Every page this run read (or reused), by URL. */
    readonly pages = new Map<string, FetchedPage>();
    readonly robots = new Map<string, Robots>();
    requests = 0;
    private readonly last = new Map<string, number>();
    private readonly chains = new Map<string, Promise<unknown>>();
    private readonly opts: Required<Omit<PoliteOptions, 'log' | 'cache'>> & Pick<PoliteOptions, 'log' | 'cache'>;

    constructor(opts: PoliteOptions) {
        this.opts = {
            minIntervalMs: 1000,
            maxBytes: 3_000_000,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            now: () => Date.now(),
            ...opts,
        };
    }

    /** One host at a time, in order. */
    private serial<T>(host: string, job: () => Promise<T>): Promise<T> {
        const prev = this.chains.get(host) ?? Promise.resolve();
        const next = prev.catch(() => {}).then(job);
        this.chains.set(host, next);
        return next;
    }

    private async raw(url: string, init: RequestInit | undefined, delaySec?: number): Promise<FetchedPage> {
        const host = new URL(url).host;
        const gap = Math.max(this.opts.minIntervalMs, (delaySec ?? 0) * 1000);
        const prev = this.last.get(host);
        const wait = prev === undefined ? 0 : prev + gap - this.opts.now();
        if (wait > 0) await this.opts.sleep(wait);
        this.last.set(host, this.opts.now());
        this.requests++;
        const headers = new Headers(init?.headers);
        headers.set('user-agent', USER_AGENT);
        if (!headers.has('accept')) headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8');
        if (!headers.has('accept-language')) headers.set('accept-language', 'en-US,en;q=0.9');
        const res = await this.opts.fetch(url, { ...init, headers, redirect: init?.redirect ?? 'manual' });
        let body = '';
        if (res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            try {
                while (body.length < this.opts.maxBytes) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) body += decoder.decode(value, { stream: true });
                }
            } finally {
                reader.cancel().catch(() => {});
            }
        }
        const page: FetchedPage = {
            url,
            status: res.status,
            location: res.headers.get('location') ?? undefined,
            contentType: res.headers.get('content-type') ?? undefined,
            body,
            fetchedAt: this.opts.now(),
        };
        return page;
    }

    async robotsFor(origin: string): Promise<Robots> {
        const cached = this.robots.get(origin);
        if (cached) return cached;
        const host = new URL(origin).host;
        const robots = await this.serial(host, async () => {
            const again = this.robots.get(origin);
            if (again) return again;
            let r: Robots;
            try {
                const page = await this.raw(`${origin}/robots.txt`, { redirect: 'follow' });
                if (page.status >= 200 && page.status < 300) r = parseRobots(page.body);
                else if (page.status >= 400 && page.status < 500) r = { rules: [], sitemaps: [] }; // no robots.txt: all allowed
                else r = { rules: [{ allow: false, pattern: '/' }], sitemaps: [] }; // server error: assume nothing allowed
            } catch {
                r = { rules: [{ allow: false, pattern: '/' }], sitemaps: [] };
            }
            this.robots.set(origin, r);
            return r;
        });
        return robots;
    }

    /** A FetchLike for checkCourseUrl and the list downloads: obeys robots.txt, keeps the page for this run. */
    readonly fetch: FetchLike = async (input, init) => {
        const url = new URL(input);
        const robots = await this.robotsFor(url.origin);
        if (!robotsAllows(robots, url.toString())) throw new RobotsBlocked(`robots.txt disallows ${url.pathname}`);
        const key = url.toString();
        // One download per URL per run; the build may also reuse its disk cache.
        let page = this.pages.get(key) ?? this.opts.cache?.get(key);
        if (!page) {
            page = await this.serial(url.host, () => this.raw(key, init, robots.crawlDelaySec));
            this.opts.cache?.set(page);
        }
        this.pages.set(key, page);
        const headers = new Headers();
        if (page.location) headers.set('location', page.location);
        if (page.contentType) headers.set('content-type', page.contentType);
        const nullBody = page.status === 204 || page.status === 304 || (page.status >= 300 && page.status < 400);
        return new Response(nullBody ? null : page.body, { status: page.status, headers });
    };

    /** A whole download, following redirects, for the lists themselves. */
    async download(url: string): Promise<FetchedPage> {
        let current = url;
        for (let hop = 0; hop <= 5; hop++) {
            const res = await this.fetch(current, { redirect: 'manual' });
            if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                current = new URL(res.headers.get('location')!, current).toString();
                continue;
            }
            const page = this.pages.get(new URL(current).toString())!;
            if (res.status < 200 || res.status >= 300) throw new Error(`${url}: status ${res.status}`);
            return page;
        }
        throw new Error(`${url}: too many redirects`);
    }
}

// ── Page facts ──────────────────────────────────────────────────────────────

export interface PageFacts {
    lang?: string;
    titles: string[];
    h1?: string;
    ogTitle?: string;
    description?: string;
    retired: boolean;
    /** The page shows a price in dollars ("$49"). */
    showsPrice: boolean;
    /** Structured data on the page says the course is free. */
    saysFree: boolean;
}

const RETIRED = /\bthis (certification|course|exam|learning path|credential|module|program|programme) (has been|was|is) retired\b/i;

export function pageFacts(html: string): PageFacts {
    const lang = html.match(/<html[^>]*\blang=["']([^"']+)["']/i)?.[1];
    const meta = (attr: string, name: string) =>
        html.match(new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, 'i'))?.[0]?.match(/content=["']([^"']*)["']/i)?.[1]
        ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${name}["']`, 'i'))?.[1];
    const h1 = plainText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || undefined;
    const ogTitle = plainText(meta('property', 'og:title')) || undefined;
    const description = plainText(meta('name', 'description') ?? meta('property', 'og:description')) || undefined;
    const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
    const text = plainText(visible);
    let saysFree = false;
    for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        if (/"isAccessibleForFree"\s*:\s*(true|"true")/i.test(block[1])) saysFree = true;
    }
    return {
        lang,
        titles: pageTitles(html),
        h1,
        ogTitle,
        description,
        retired: RETIRED.test(text),
        showsPrice: /(^|[\s(])(US)?\$\s?\d/.test(text),
        saysFree,
    };
}

// ── Source 1: Microsoft Learn Catalog API ───────────────────────────────────

export const MS_CATALOG_URL = 'https://learn.microsoft.com/api/catalog/?locale=en-us&type=learningPaths,mergedCertifications,courses,appliedSkills,products,roles,subjects,levels';

interface MsNamed { id: string; name: string; children?: MsNamed[] }
interface MsItem {
    uid: string;
    title: string;
    url: string;
    type?: string;
    summary?: string;
    subtitle?: string;
    levels?: string[];
    roles?: string[];
    products?: string[];
    subjects?: string[];
    skills?: string[];
    locale?: string;
    duration_in_minutes?: number;
    duration_in_hours?: number;
}
export interface MsCatalog {
    learningPaths?: MsItem[];
    certifications?: MsItem[];
    mergedCertifications?: MsItem[];
    courses?: MsItem[];
    appliedSkills?: MsItem[];
    products?: MsNamed[];
    roles?: MsNamed[];
    subjects?: MsNamed[];
    levels?: MsNamed[];
}

/** The parts of the API answer the catalog uses, as the API gave them. */
export function msExtract(d: MsCatalog): MsCatalog {
    return {
        learningPaths: d.learningPaths ?? [],
        certifications: d.mergedCertifications?.length ? d.mergedCertifications : d.certifications ?? [],
        courses: d.courses ?? [],
        appliedSkills: d.appliedSkills ?? [],
        products: d.products ?? [],
        roles: d.roles ?? [],
        subjects: d.subjects ?? [],
        levels: d.levels ?? [],
    };
}

function nameMap(list: MsNamed[] | undefined): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (items: MsNamed[] | undefined) => {
        for (const it of items ?? []) {
            out.set(it.id, it.name);
            walk(it.children);
        }
    };
    walk(list);
    return out;
}

const minutes = (m: number) => (m >= 120 ? `${Math.round(m / 6) / 10} hours` : `${m} minutes`);

export function parseMsCatalog(d: MsCatalog): Candidate[] {
    const x = msExtract(d);
    const products = nameMap(x.products);
    const roles = nameMap(x.roles);
    const subjects = nameMap(x.subjects);
    const levels = nameMap(x.levels);
    const tagsOf = (it: MsItem) => {
        const t = [
            ...(it.products ?? []).map((p) => products.get(p) ?? p),
            ...(it.roles ?? []).map((r) => roles.get(r) ?? r),
            ...(it.subjects ?? []).map((s) => subjects.get(s) ?? s),
            ...(it.skills ?? []),
        ].map((s) => plainText(s)).filter(Boolean);
        return [...new Set(t)];
    };
    const levelOf = (it: MsItem) => {
        const l = (it.levels ?? []).map((v) => levels.get(v) ?? v);
        return l.length ? l.join(', ') : undefined;
    };
    const base = (it: MsItem, type: EntryType, kind: string): Candidate => ({
        id: `microsoft-learn:${kind}:${it.uid}`,
        title: plainText(it.title),
        url: canonicalUrl(it.url),
        type,
        level: levelOf(it),
        price: 'unknown',
        description: shortDescription(it.summary ?? it.subtitle),
        tags: tagsOf(it),
        source: 'microsoft-learn',
    });
    const out: Candidate[] = [];
    for (const it of x.learningPaths ?? []) {
        if (it.locale && !/^en/i.test(it.locale)) continue;
        out.push({ ...base(it, 'course', 'path'), duration: it.duration_in_minutes ? minutes(it.duration_in_minutes) : undefined });
    }
    for (const it of x.courses ?? []) out.push({ ...base(it, 'course', 'course'), duration: it.duration_in_hours ? `${it.duration_in_hours} hours` : undefined });
    for (const it of x.certifications ?? []) out.push(base(it, 'certification', 'certification'));
    for (const it of x.appliedSkills ?? []) {
        if (it.locale && !/^en/i.test(it.locale)) continue;
        out.push(base(it, 'certificate', 'applied-skill'));
    }
    return out;
}

// ── Source 2: Google Skills catalog pages ───────────────────────────────────

export const SKILLS_CATALOG_URL = (page: number) => `https://www.skills.google/catalog${page > 1 ? `?page=${page}` : ''}`;

export interface SkillsItem {
    type: string;
    title: string;
    description?: string;
    path: string;
    duration?: string | null;
    level?: string | null;
    credentialType?: string | null;
    paid?: boolean | null;
}
export interface SkillsPage { items: SkillsItem[]; resultsCount: number; itemsPerPage: number }

/** The list the catalog page carries in its pagedSearchResults attribute. */
export function parseSkillsCatalogPage(html: string): SkillsPage {
    const m = html.match(/pagedSearchResults='([^']*)'/) ?? html.match(/pagedSearchResults="([^"]*)"/);
    if (!m) throw new Error('Google Skills catalog page: no pagedSearchResults');
    const data = JSON.parse(decodeEntities(m[1])) as { searchResults: SkillsItem[]; resultsCount: number; itemsPerPage: number };
    return { items: data.searchResults ?? [], resultsCount: data.resultsCount, itemsPerPage: data.itemsPerPage };
}

export interface Dropped { id: string; title: string; url: string; source: SourceKey; reason: string }

/** Courses and learning paths (kept as courses, like Microsoft's); labs (single hands-on exercises) are not courses. */
export function parseSkillsItems(items: SkillsItem[]): { candidates: Candidate[]; dropped: Dropped[] } {
    const candidates: Candidate[] = [];
    const dropped: Dropped[] = [];
    const seen = new Set<string>();
    for (const it of items) {
        const url = canonicalUrl(it.path, 'https://www.skills.google');
        const key = new URL(url).pathname;
        const id = `google-skills:${key.replace(/^\//, '')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const title = plainText(it.title);
        const isCourse = (it.type === 'course' && /^\/course_templates\/\d+$/.test(key)) || (it.type === 'learning_path' && /^\/paths\/\d+$/.test(key));
        if (!isCourse) {
            dropped.push({ id, title, url, source: 'google-skills', reason: `a ${it.type || 'non-course item'}, not a course` });
            continue;
        }
        candidates.push({
            id,
            title,
            url,
            type: 'course',
            level: it.level ? it.level[0].toUpperCase() + it.level.slice(1) : undefined,
            duration: it.duration ?? undefined,
            price: it.paid === true ? 'paid' : 'unknown',
            description: shortDescription(it.description),
            tags: it.credentialType === 'skill_badge' ? ['skill badge'] : undefined,
            source: 'google-skills',
        });
    }
    return { candidates, dropped };
}

// ── Source 3: Grow with Google sitemap ──────────────────────────────────────

export const GROW_SITEMAP_URL = 'https://grow.google/sitemap.xml/';

export function sitemapLocs(xml: string): string[] {
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}

/**
 * The sitemap's US-English certificate and course pages: /certificates/<name>/
 * and its course pages, /ai-professional/ and its course pages, and the
 * "-essentials" courses. Regional copies (/intl/, /en_ca/) and articles,
 * landing and partner pages are left out.
 */
export function selectGrowPages(locs: string[]): Candidate[] {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (const loc of locs) {
        let u: URL;
        try { u = new URL(loc); } catch { continue; }
        if (u.hostname !== 'grow.google') continue;
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.some((s) => s === 'intl' || /^en_[a-z]{2}$/i.test(s))) continue;
        let type: EntryType | null = null;
        let typeFromTitle = false;
        if (segs[0] === 'certificates' && segs.length === 2) { type = 'certificate'; typeFromTitle = true; }
        else if (segs[0] === 'certificates' && segs.length === 3 && /^c\d+[-a-z]/.test(segs[2])) type = 'course';
        else if (segs[0] === 'ai-professional' && segs.length === 1) { type = 'certificate'; typeFromTitle = true; }
        else if (segs[0] === 'ai-professional' && segs.length === 2 && /^c\d+[-a-z]/.test(segs[1])) type = 'course';
        else if (segs.length === 1 && /-essentials$/.test(segs[0])) { type = 'course'; typeFromTitle = true; }
        if (!type) continue;
        const url = canonicalUrl(`https://grow.google/${segs.join('/')}/`);
        const id = `grow-google:${segs.join('/')}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, title: '', url, type, price: 'unknown', source: 'grow-google', fromPage: { typeFromTitle } });
    }
    return out;
}

// ── Source 4: certification bodies (hand-reviewed) ──────────────────────────

export interface CertPage {
    /** Short key for the id. */
    key: string;
    /** The body's official page that lists its certifications. */
    listingUrl: string;
    /** A certification page linked from it. */
    url: string;
    /** The link text on the listing page (from the site), used as the expected title. */
    linkText: string;
}

/** The links on a listing page, with their text. */
export function pageLinks(html: string, base: string): { url: string; text: string }[] {
    const out: { url: string; text: string }[] = [];
    for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        try {
            out.push({ url: new URL(decodeEntities(m[1]), base).toString(), text: plainText(m[2]) });
        } catch { /* not a URL */ }
    }
    return out;
}

/** A certification page from the hand-reviewed list, if its listing page still links to it under that text. */
export function certCandidate(page: CertPage, listingHtml: string): Candidate | { reason: string } {
    const want = canonicalUrl(page.url);
    const link = pageLinks(listingHtml, page.listingUrl).find((l) => canonicalUrl(l.url) === want);
    if (!link) return { reason: 'no longer linked from the listing page' };
    if (!link.text.toLowerCase().startsWith(page.linkText.toLowerCase())) return { reason: `link text changed ("${link.text.slice(0, 60)}")` };
    return { id: `cert-bodies:${page.key}`, title: page.linkText, url: want, type: 'certification', price: 'unknown', source: 'cert-bodies' };
}

// ── The check ───────────────────────────────────────────────────────────────

/** The local calendar day, YYYY-MM-DD. */
export const isoDay = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface CheckOptions {
    fetcher: PoliteFetcher;
    today: string;
    timeoutMs?: number;
}

export type CheckResult = { ok: true; entry: CatalogEntry } | { ok: false; reason: string };

const SITE_SUFFIX = /\s*[|–—-]\s*(Google Skills|Grow with Google|Google|Microsoft Learn|The IIA|ACE|Peoplecert|PeopleCert)\s*\.?$/i;

/**
 * Checks one course with the app's own checkCourseUrl, then reads the page it
 * landed on: dropped if the page is not English, or says the course is retired.
 * For sources that give only a URL, the title and description come from the page.
 */
export async function checkCandidate(c: Candidate, opts: CheckOptions): Promise<CheckResult> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    let title = c.title;
    let description = c.description;
    let type = c.type;
    if (c.fromPage) {
        // Read the page first (the check below reuses this download) to learn its own name.
        let page: FetchedPage;
        try {
            page = await opts.fetcher.download(c.url);
        } catch (err) {
            return { ok: false, reason: err instanceof Error ? err.message.replace(`${c.url}: `, '') : 'page did not load' };
        }
        const facts = pageFacts(page.body);
        title = plainText(facts.h1 ?? facts.ogTitle ?? facts.titles[0]).replace(SITE_SUFFIX, '');
        if (!title) return { ok: false, reason: 'page has no title' };
        description = shortDescription(facts.description);
        if (c.fromPage.typeFromTitle) type = /\bcertificat(e|ion)\b/i.test(`${title} ${facts.titles.join(' ')}`) ? 'certificate' : 'course';
    }
    const check = await checkCourseUrl(c.url, title, { fetch: opts.fetcher.fetch, timeoutMs });
    if (!check.ok) return { ok: false, reason: check.reason };
    const page = opts.fetcher.pages.get(check.href);
    const facts = page ? pageFacts(page.body) : null;
    if (facts?.lang && !/^en\b/i.test(facts.lang)) return { ok: false, reason: `not English (page lang ${facts.lang})` };
    const lang = notEnglish(`${title} ${description ?? ''}`);
    if (lang) return { ok: false, reason: lang };
    if (facts?.retired) return { ok: false, reason: 'page says it is retired' };
    const provider = providerOfUrl(new URL(check.href));
    if (!provider) return { ok: false, reason: 'not on the provider list' };
    let price = c.price;
    if (price === 'unknown' && facts?.saysFree) price = 'free';
    else if (price === 'unknown' && facts?.showsPrice && c.source !== 'microsoft-learn') price = 'paid';
    if (!description && facts?.description) description = shortDescription(facts.description);
    if (c.source === 'cert-bodies' && facts) {
        // The listing's link text is often short ("Personal Trainer"): use the page's own fuller name when it agrees.
        const named = [facts.ogTitle, facts.titles[0], facts.h1].map((t) => plainText(t).split(/\s+\|\s+/)[0].replace(SITE_SUFFIX, '').trim()).find((t) => t && titleMatch(c.title, [t]) >= TITLE_MATCH_MIN);
        if (named && named.length > title.length) title = named;
    }
    const entry: CatalogEntry = {
        id: c.id,
        title,
        provider: provider.name,
        url: canonicalUrl(check.href),
        type,
        ...(c.level ? { level: c.level } : {}),
        ...(c.duration ? { duration: c.duration } : {}),
        price,
        ...(description ? { description } : {}),
        ...(c.tags?.length ? { tags: c.tags } : {}),
        lastChecked: page ? isoDay(page.fetchedAt) : opts.today,
    };
    return { ok: true, entry };
}

/** Re-checks a catalog entry (the --check mode): same check, same title. */
export async function recheckEntry(e: CatalogEntry, opts: CheckOptions): Promise<CheckResult> {
    const check = await checkCourseUrl(e.url, e.title, { fetch: opts.fetcher.fetch, timeoutMs: opts.timeoutMs ?? 30_000 });
    if (!check.ok) return { ok: false, reason: check.reason };
    const page = opts.fetcher.pages.get(check.href);
    if (page && pageFacts(page.body).retired) return { ok: false, reason: 'page says it is retired' };
    return { ok: true, entry: { ...e, url: canonicalUrl(check.href), lastChecked: page ? isoDay(page.fetchedAt) : opts.today } };
}

/** Runs fn over items, one worker per host (the fetcher spaces the requests), keeping order. */
export async function perHost<T, R>(items: T[], urlOf: (t: T) => string, fn: (t: T) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
    const byHost = new Map<string, number[]>();
    items.forEach((it, i) => {
        const host = new URL(urlOf(it)).host;
        byHost.set(host, [...(byHost.get(host) ?? []), i]);
    });
    const out: R[] = new Array(items.length);
    let done = 0;
    await Promise.all([...byHost.values()].map(async (idx) => {
        for (const i of idx) {
            out[i] = await fn(items[i]);
            done++;
            onProgress?.(done, items.length);
        }
    }));
    return out;
}

/** Same input, same bytes: entries sorted by provider, then type, then title, then id. */
export function sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
    const typeOrder: Record<EntryType, number> = { certification: 0, certificate: 1, course: 2 };
    return [...entries].sort((a, b) =>
        a.provider.localeCompare(b.provider) || typeOrder[a.type] - typeOrder[b.type] || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** The same course listed twice (two ids, one URL) is kept once: the first. */
export function dedupeByUrl(entries: CatalogEntry[]): { kept: CatalogEntry[]; dupes: CatalogEntry[] } {
    const seen = new Set<string>();
    const kept: CatalogEntry[] = [];
    const dupes: CatalogEntry[] = [];
    for (const e of entries) {
        const k = e.url.replace(/\/$/, '').toLowerCase();
        if (seen.has(k)) dupes.push(e);
        else { seen.add(k); kept.push(e); }
    }
    return { kept, dupes };
}
