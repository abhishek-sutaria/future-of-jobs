/**
 * Career paths data: for each of the app's 830 BLS jobs, the jobs O*NET lists
 * as related to it, and its O*NET Job Zone. Built only from rows of two
 * official O*NET 30.1 files already in the repo (data/db_30_1_text/, every
 * input sha256-pinned in data/career_paths/sources.json). Pure: no network,
 * no Vite, no Claude. scripts/build_career_paths.ts writes the outputs;
 * scripts/verify_career_paths.py re-reads the raw files on its own and checks
 * them; docs/career-paths.md is the report.
 *
 *   src/data/career_paths/index.json   meta, the label, tiers, Job Zone names, coverage (small)
 *   src/data/career_paths/zones.json   every app job's Job Zone (one lazy chunk)
 *   src/data/career_paths/<NN>.json    each app job's links, one lazy chunk per BLS major group
 *   docs/career-paths.md               method, coverage, unmapped and mixed codes
 *
 * NOTHING INVENTED. Every link is one or more rows of Related Occupations.txt;
 * no similarity of our own, no AI, no guess. A job O*NET has nothing for is
 * left out, and the app says "no data".
 *
 * Method
 *   1. O*NET code -> app job, by the rules the app already uses:
 *        - a .00 code and its sub-codes (.01, .02, ...) belong to their
 *          seven-character SOC (scripts/build_occupations.py joins O*NET on
 *          that SOC only);
 *        - a code whose SOC the app holds only inside a combined BLS code
 *          (13-1022 -> 13-1020, ...) belongs to that combined job, through
 *          socRollup in scripts/lib/iuSchools.ts, which reads the one table
 *          src/config/onetSplitCodes.ts (the scoring plan's table too);
 *        - any other code is unmapped and listed in the report.
 *   2. Links: own code first (decided 2026-11-22, as tasks already work), by
 *      part. A job's "parts" are the seven-character SOCs of the codes that
 *      map to it: just itself, or each piece of a combined BLS job (29-2010
 *      = 29-2011 + 29-2012). Each part gives its own .00 code's rows ONLY
 *      when that code has rows in Related Occupations.txt; a part's sub-code
 *      rows are used only when the part has no .00 code. So a job with its
 *      own .00 uses only that code; a combined job uses each part's .00
 *      (29-2010 never uses 29-2011.01/.02/.04 or 29-2012.01); a SOC O*NET
 *      has only as sub-codes (15-1299) uses every sub-code. The same rule
 *      as the Job Zone (step 3).
 *      Each used row (code -> related code) becomes a link between the two
 *      app jobs; on the target side a sub-code still maps to its parent job.
 *      A row whose two codes land on the same app job is a self-link and is
 *      dropped. Rows that land on the same pair merge into one link that
 *      keeps the strongest tier, then the lowest Index, and lists every row
 *      it came from (line numbers). Links are in O*NET's order: tier, then
 *      Index, then file line.
 *   3. Job Zone: the job's own .00 code's zone; otherwise the zones of the
 *      codes that map to it (a part of a combined job counts its .00 when it
 *      has one, the way the .00-first rule works everywhere), if they all
 *      agree; otherwise null, marked "mixed" and listed in the report.
 * Pay and AI Exposure are not stored here: src/utils/careerPaths.ts reads
 * them from the existing BLS and score data at view time.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ONET_CODES_FOR_SOC } from '../../src/config/onetSplitCodes';
import { socRollup } from './iuSchools';

export const CAREER_PATHS_PATHS = {
    sources: 'data/career_paths/sources.json',
    outDir: 'src/data/career_paths',
    index: 'src/data/career_paths/index.json',
    zones: 'src/data/career_paths/zones.json',
    report: 'docs/career-paths.md',
    occupationsIndex: 'src/data/occupations/index.json',
} as const;

export const RELATED_FILE = 'data/db_30_1_text/Related Occupations.txt';
export const ZONES_FILE = 'data/db_30_1_text/Job Zones.txt';
export const ZONE_REFERENCE_FILE = 'data/db_30_1_text/Job Zone Reference.txt';
export const OCCUPATION_DATA_FILE = 'data/db_30_1_text/Occupation Data.txt';
export const README_FILE = 'data/db_30_1_text/Read Me.txt';

/** O*NET's three tiers, strongest first (the order its own Index follows). */
export const TIERS = ['Primary-Short', 'Primary-Long', 'Supplemental'] as const;
export type Tier = (typeof TIERS)[number];
const tierRank = (t: Tier): number => TIERS.indexOf(t);

/** The label the screen must use. Not "where people actually moved". */
export const CAREER_PATHS_LABEL = 'Similar jobs you could move to (O*NET, by similar skills and work)';
export const CAREER_PATHS_NOT = 'where people actually moved';

/** O*NET's own words on how the file is built, quoted in the report (fetched 2026-11-22). */
export const ONET_METHOD_QUOTES = [
    {
        url: 'https://www.onetcenter.org/dictionary/30.1/text/related_occupations.html',
        page: 'Related Occupations - O*NET 30.1 Data Dictionary',
        text: 'The related occupations in this file are developed using an approach which includes three important contributors to occupational similarity: what people in the occupations do, what they know, and what they are called.',
    },
    {
        url: 'https://www.onetcenter.org/reports/Related_2022.html',
        page: 'Developing Related Occupations for the O*NET Program (April 2022)',
        text: 'The final occupational relatedness composite reflects the following components: (a) task- and detailed work activity (DWA)-based similarity, (b) knowledge importance similarity, and (c) alternate title similarity.',
    },
] as const;

export const sha256 = (buf: Buffer | Uint8Array | string): string => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- inputs

export interface SourceFile {
    path: string;
    title: string;
    dictionary?: string;
    columns?: string[];
    sha256: string;
}

export interface SourcesManifest {
    _about: string;
    onet: {
        name: string;
        version: string;
        release: string;
        releaseCheck: string;
        publisher: string;
        url: string;
        seenAt: string;
        license: string;
        licenseName: string;
        licenseUrl: string;
        licenseText: string;
        /** O*NET's credit line, copied from attributionSource (see attributionNote). */
        attribution: string;
        attributionSource: string;
        attributionNote: string;
        /** The two links O*NET's own HTML puts in the credit line: on "O*NET 30.1 Database" and on "CC BY 4.0". */
        databaseUrl: string;
        licenseDeedUrl: string;
    };
    files: SourceFile[];
}

/** One data row of an O*NET tab-separated file, with its 1-based line number (the header is line 1). */
export interface TsvRow {
    line: number;
    cells: string[];
}

export interface AppJob {
    soc: string;
    title: string;
    /** O*NET task count in the occupations data (only used to describe the no-data jobs). */
    taskCount: number;
}

export interface CareerPathsInputs {
    sources: SourcesManifest;
    hashes: Record<string, string>;
    related: TsvRow[];
    zones: TsvRow[];
    zoneNames: Record<string, string>;
    onetTitles: Map<string, string>;
    appJobs: AppJob[];
}

/**
 * An O*NET text file: CRLF lines, tab-separated, no quoting. Every line must
 * have exactly the expected columns, or the build stops: nothing is skipped.
 */
export function parseTsv(text: string, expected: readonly string[], name: string): TsvRow[] {
    if (!text.endsWith('\r\n')) throw new Error(`${name}: does not end with CRLF`);
    const lines = text.slice(0, -2).split('\r\n');
    if (lines.some((l) => l.includes('\n') || l.includes('\r'))) throw new Error(`${name}: mixed line endings`);
    const header = lines[0].split('\t');
    if (JSON.stringify(header) !== JSON.stringify(expected)) throw new Error(`${name}: header ${JSON.stringify(header)}, expected ${JSON.stringify(expected)}`);
    return lines.slice(1).map((l, i) => {
        const cells = l.split('\t');
        if (cells.length !== expected.length) throw new Error(`${name} line ${i + 2}: ${cells.length} fields, expected ${expected.length}`);
        return { line: i + 2, cells };
    });
}

const CODE_RE = /^\d\d-\d{4}\.\d\d$/;

export function loadCareerPathsInputs(root: string): CareerPathsInputs {
    const sources = JSON.parse(fs.readFileSync(path.join(root, CAREER_PATHS_PATHS.sources), 'utf-8')) as SourcesManifest;
    const read = (rel: string): string => {
        const f = sources.files.find((s) => s.path === rel);
        if (!f) throw new Error(`${CAREER_PATHS_PATHS.sources} does not pin ${rel}`);
        const buf = fs.readFileSync(path.join(root, rel));
        const got = sha256(buf);
        if (got !== f.sha256) throw new Error(`sha256 mismatch for ${rel}: expected ${f.sha256}, got ${got}`);
        return buf.toString('utf-8');
    };
    const hashes: Record<string, string> = {};
    for (const f of sources.files) hashes[f.path] = f.sha256;

    const readme = read(README_FILE).split(/\r?\n/);
    if (readme[0] !== `${sources.onet.version} Database`) throw new Error(`${README_FILE} line 1 is "${readme[0]}", not "${sources.onet.version} Database"`);
    if (readme[1].trim() !== sources.onet.release) throw new Error(`${README_FILE} line 2 is "${readme[1]}", not "${sources.onet.release}"`);
    if (!readme.some((l) => l.startsWith(sources.onet.licenseText))) throw new Error(`${README_FILE} does not carry the license sentence in sources.json`);

    const spec = (rel: string) => sources.files.find((s) => s.path === rel)!.columns!;
    const related = parseTsv(read(RELATED_FILE), spec(RELATED_FILE), RELATED_FILE);
    const zones = parseTsv(read(ZONES_FILE), spec(ZONES_FILE), ZONES_FILE);
    const zoneNames: Record<string, string> = {};
    for (const r of parseTsv(read(ZONE_REFERENCE_FILE), spec(ZONE_REFERENCE_FILE), ZONE_REFERENCE_FILE)) zoneNames[r.cells[0]] = r.cells[1];
    const onetTitles = new Map<string, string>();
    for (const r of parseTsv(read(OCCUPATION_DATA_FILE), spec(OCCUPATION_DATA_FILE), OCCUPATION_DATA_FILE)) onetTitles.set(r.cells[0], r.cells[1]);

    const occIndex = JSON.parse(fs.readFileSync(path.join(root, CAREER_PATHS_PATHS.occupationsIndex), 'utf-8')) as { occupations: AppJob[] };
    const appJobs = occIndex.occupations.map((o) => ({ soc: o.soc, title: o.title, taskCount: o.taskCount }));
    return { sources, hashes, related, zones, zoneNames, onetTitles, appJobs };
}

// ---------------------------------------------------------------- build

export interface StoredLink {
    /** The related app job's SOC. */
    to: string;
    /** The strongest tier among the rows that make this link. */
    tier: Tier;
    /** O*NET's Index on the row that gave that tier (lowest Index within the tier). */
    index: number;
    /** Every Related Occupations.txt line that makes this link, ascending. */
    rows: number[];
}

export type JobZoneRule = '.00' | 'sub-codes' | 'combined' | 'mixed';

export interface StoredJob {
    jobZone: number | null;
    /** How the zone was found; "mixed" when the codes disagree (jobZone is then null). */
    jobZoneRule: JobZoneRule;
    /** The Job Zones.txt lines the rule read, ascending. */
    jobZoneRows: number[];
    /** The O*NET codes whose Related Occupations.txt rows make this job's links: its own .00 when it has one, else every code that maps to it. */
    onetCodes: string[];
    links: StoredLink[];
}

export interface FieldChunk {
    _meta: { about: string; major: string; generator: string };
    socs: Record<string, StoredJob>;
}

export type CodeRule = '.00' | 'sub-code' | 'combined' | 'unmapped';

export interface CareerPathsCounts {
    jobs: number;
    withOnetCodes: number;
    withLinks: number;
    withFivePlus: number;
    noData: number;
    links: number;
    maxLinks: number;
    medianLinks: number;
    multiCodeJobs: number;
    withJobZone: number;
    mixedZones: number;
    zoneBy: Record<'.00' | 'sub-codes' | 'combined', number>;
    rows: number;
    rowsUsed: number;
    rowsSelf: number;
    rowsUnmapped: number;
    /** Rows from a sub-code whose part (the job, or a piece of a combined job) has its own .00 code: not used (own code first). */
    rowsNotOwnCode: number;
    rowsMerged: number;
    /** Jobs with a sub-code whose part has its own .00 code in the file (the ones the own-code rule changes). */
    ownCodeJobsWithSubCodes: number;
    onetCodes: number;
    codesBy: Record<CodeRule, number>;
    tiers: Record<Tier, number>;
    directions: { up: number; same: number; down: number; unknown: number };
}

export interface CareerPathsBuild {
    index: unknown;
    zones: { _meta: { about: string; generator: string }; zones: Record<string, number> };
    fields: Map<string, FieldChunk>;
    jobs: Map<string, StoredJob>;
    counts: CareerPathsCounts;
    unmapped: { code: string; title: string; rows: number; asRelated: number }[];
    mixed: { soc: string; title: string; codes: { code: string; zone: number; line: number }[] }[];
    zoneOverrides: { soc: string; title: string; own: number; others: { code: string; zone: number }[] }[];
    selfLinks: { soc: string; title: string; rows: number }[];
    /** Jobs the own-code rule changes: links if every code were merged (the first rule) vs links now. combined = a combined BLS job (its parts' .00 codes). */
    ownCodeChanges: { soc: string; title: string; combined: boolean; usedCodes: string[]; subCodes: string[]; rowsNotUsed: number; before: number; after: number }[];
    noData: AppJob[];
    report: string;
}

export const GENERATOR = 'npx tsx scripts/build_career_paths.ts';

export function buildCareerPaths(inputs: CareerPathsInputs): CareerPathsBuild {
    const appSocs = new Set(inputs.appJobs.map((j) => j.soc));
    const titleOf = new Map(inputs.appJobs.map((j) => [j.soc, j.title]));
    const { toApp } = socRollup(appSocs);

    // 1. Every O*NET code in either file -> app job.
    const codeRule = new Map<string, CodeRule>();
    const appOf = new Map<string, string | null>();
    const mapCode = (code: string, where: string): string | null => {
        if (!CODE_RE.test(code)) throw new Error(`${where}: "${code}" is not an O*NET-SOC code`);
        if (!appOf.has(code)) {
            const soc = code.slice(0, 7);
            const app = toApp(soc);
            appOf.set(code, app);
            codeRule.set(code, app === null ? 'unmapped' : app !== soc ? 'combined' : code.endsWith('.00') ? '.00' : 'sub-code');
        }
        return appOf.get(code)!;
    };

    // Job Zones.txt: one row per code.
    const zoneOf = new Map<string, { zone: number; line: number }>();
    for (const r of inputs.zones) {
        const [code, z] = r.cells;
        if (!/^[1-5]$/.test(z)) throw new Error(`${ZONES_FILE} line ${r.line}: Job Zone "${z}"`);
        if (zoneOf.has(code)) throw new Error(`${ZONES_FILE} line ${r.line}: ${code} listed twice`);
        mapCode(code, `${ZONES_FILE} line ${r.line}`);
        zoneOf.set(code, { zone: Number(z), line: r.line });
    }
    if (!inputs.zoneNames['1'] || Object.keys(inputs.zoneNames).length !== 5) throw new Error(`${ZONE_REFERENCE_FILE}: expected Job Zones 1 to 5`);

    // 2. Related Occupations.txt rows -> links. A part (a code's seven-character
    // SOC: the job itself, or one piece of a combined job) "has its own .00
    // code" when that code has rows here; then only that code's rows are used.
    for (const r of inputs.related) mapCode(r.cells[0], `${RELATED_FILE} line ${r.line}`);
    const partHasOwnCode = new Set(inputs.related.map((r) => r.cells[0]).filter((c) => c.endsWith('.00') && appOf.get(c) != null).map((c) => c.slice(0, 7)));
    const hasOwnCode = new Set([...partHasOwnCode].filter((p) => appOf.get(`${p}.00`) === p));
    /** The codes a job's links come from, by the part rule: each part's .00 if it has rows, else all of the part's codes. */
    const ownCodesRule = (codes: Iterable<string>): string[] => [...codes].filter((c) => c.endsWith('.00') || !partHasOwnCode.has(c.slice(0, 7))).sort();
    const codesOf = new Map<string, Set<string>>();
    const usedCodesOf = new Map<string, Set<string>>();
    const allPairs = new Map<string, Set<string>>(); // every code merged (the first rule), for the report's before/after
    const notOwnBySoc = new Map<string, number>();
    let rowsNotOwnCode = 0;
    const pairRows = new Map<string, { from: string; to: string; tier: Tier; index: number; line: number }[]>();
    const selfBySoc = new Map<string, number>();
    const unmappedRows = new Map<string, { rows: number; asRelated: number }>();
    const seenPair = new Set<string>();
    let rowsSelf = 0;
    let rowsUnmapped = 0;
    for (const r of inputs.related) {
        const [code, rel, tier, idx] = r.cells;
        const where = `${RELATED_FILE} line ${r.line}`;
        if (!(TIERS as readonly string[]).includes(tier)) throw new Error(`${where}: tier "${tier}"`);
        if (!/^[1-9]\d*$/.test(idx)) throw new Error(`${where}: Index "${idx}"`);
        if (seenPair.has(`${code}|${rel}`)) throw new Error(`${where}: ${code} -> ${rel} listed twice`);
        seenPair.add(`${code}|${rel}`);
        const from = mapCode(code, where);
        const to = mapCode(rel, where);
        for (const [c, isFrom] of [[code, true], [rel, false]] as const) {
            if (appOf.get(c) !== null) continue;
            const u = unmappedRows.get(c) ?? { rows: 0, asRelated: 0 };
            if (isFrom) u.rows++;
            else u.asRelated++;
            unmappedRows.set(c, u);
        }
        if (from !== null) {
            const codes = codesOf.get(from) ?? new Set<string>();
            codes.add(code);
            codesOf.set(from, codes);
            if (to !== null && to !== from) allPairs.set(from, (allPairs.get(from) ?? new Set<string>()).add(to));
        }
        if (from === null) {
            rowsUnmapped++;
            continue;
        }
        if (partHasOwnCode.has(code.slice(0, 7)) && !code.endsWith('.00')) {
            rowsNotOwnCode++;
            notOwnBySoc.set(from, (notOwnBySoc.get(from) ?? 0) + 1);
            continue;
        }
        usedCodesOf.set(from, (usedCodesOf.get(from) ?? new Set<string>()).add(code));
        if (to === null) {
            rowsUnmapped++;
            continue;
        }
        if (from === to) {
            rowsSelf++;
            selfBySoc.set(from, (selfBySoc.get(from) ?? 0) + 1);
            continue;
        }
        const key = `${from}|${to}`;
        const list = pairRows.get(key) ?? [];
        list.push({ from, to, tier: tier as Tier, index: Number(idx), line: r.line });
        pairRows.set(key, list);
    }

    const better = (a: { tier: Tier; index: number; line: number }, b: { tier: Tier; index: number; line: number }) =>
        tierRank(a.tier) - tierRank(b.tier) || a.index - b.index || a.line - b.line;

    const linksOf = new Map<string, (StoredLink & { line: number })[]>();
    for (const list of pairRows.values()) {
        const best = [...list].sort(better)[0];
        const link = { to: best.to, tier: best.tier, index: best.index, rows: list.map((x) => x.line).sort((a, b) => a - b), line: best.line };
        const arr = linksOf.get(best.from) ?? [];
        arr.push(link);
        linksOf.set(best.from, arr);
    }

    // 3. Job Zone per app job.
    const jobs = new Map<string, StoredJob>();
    const mixed: CareerPathsBuild['mixed'] = [];
    const zoneOverrides: CareerPathsBuild['zoneOverrides'] = [];
    const allCodesOf = new Map<string, string[]>();
    for (const code of zoneOf.keys()) {
        const app = appOf.get(code);
        if (!app) continue;
        const l = allCodesOf.get(app) ?? [];
        l.push(code);
        allCodesOf.set(app, l);
    }
    for (const { soc } of inputs.appJobs) {
        const codes = [...(codesOf.get(soc) ?? [])].sort();
        const zoneCodes = (allCodesOf.get(soc) ?? []).sort();
        if (codes.length === 0 && zoneCodes.length === 0) continue; // O*NET has nothing: store nothing.
        if (JSON.stringify(codes) !== JSON.stringify(zoneCodes)) {
            throw new Error(`${soc}: codes in ${RELATED_FILE} (${codes.join(', ')}) differ from ${ZONES_FILE} (${zoneCodes.join(', ')})`);
        }
        let jobZone: number | null;
        let rule: JobZoneRule;
        let used: string[];
        const own = zoneOf.get(`${soc}.00`);
        if (own) {
            jobZone = own.zone;
            rule = '.00';
            used = [`${soc}.00`];
            const others = zoneCodes.filter((c) => c !== `${soc}.00` && zoneOf.get(c)!.zone !== own.zone);
            if (others.length) zoneOverrides.push({ soc, title: titleOf.get(soc)!, own: own.zone, others: others.map((c) => ({ code: c, zone: zoneOf.get(c)!.zone })) });
        } else {
            // A part of a combined job counts its own .00 when it has one (.00 first, as everywhere).
            const byPart = new Map<string, string[]>();
            for (const c of zoneCodes) byPart.set(c.slice(0, 7), [...(byPart.get(c.slice(0, 7)) ?? []), c]);
            used = [...byPart.values()].flatMap((cs) => (cs.includes(`${cs[0].slice(0, 7)}.00`) ? [`${cs[0].slice(0, 7)}.00`] : cs)).sort();
            const distinct = [...new Set(used.map((c) => zoneOf.get(c)!.zone))];
            const isCombined = used.some((c) => codeRule.get(c) === 'combined');
            if (distinct.length === 1) {
                jobZone = distinct[0];
                rule = isCombined ? 'combined' : 'sub-codes';
            } else {
                jobZone = null;
                rule = 'mixed';
                mixed.push({ soc, title: titleOf.get(soc)!, codes: used.map((c) => ({ code: c, zone: zoneOf.get(c)!.zone, line: zoneOf.get(c)!.line })) });
            }
        }
        const links = (linksOf.get(soc) ?? []).sort(better).map(({ to, tier, index, rows }) => ({ to, tier, index, rows }));
        const onetCodes = [...(usedCodesOf.get(soc) ?? [])].sort();
        if (hasOwnCode.has(soc) && JSON.stringify(onetCodes) !== JSON.stringify([`${soc}.00`])) throw new Error(`${soc}: own .00 code, but rows used from ${onetCodes.join(', ')}`);
        if (JSON.stringify(onetCodes) !== JSON.stringify(ownCodesRule(codes))) throw new Error(`${soc}: rows used from ${onetCodes.join(', ')}, the part rule gives ${ownCodesRule(codes).join(', ')}`);
        jobs.set(soc, { jobZone, jobZoneRule: rule, jobZoneRows: used.map((c) => zoneOf.get(c)!.line).sort((a, b) => a - b), onetCodes, links });
    }

    // Outputs.
    const fields = new Map<string, FieldChunk>();
    for (const { soc } of inputs.appJobs) {
        const major = soc.slice(0, 2);
        if (!fields.has(major)) {
            fields.set(major, {
                _meta: {
                    about: `O*NET 30.1 Related Occupations and Job Zones for the app's jobs in BLS SOC major group ${major}-0000 (lazy chunk; only src/utils/careerPaths.ts loads it). Do not edit: built by ${GENERATOR}.`,
                    major,
                    generator: GENERATOR,
                },
                socs: {},
            });
        }
        const job = jobs.get(soc);
        if (job) fields.get(major)!.socs[soc] = job;
    }
    const zones: Record<string, number> = {};
    for (const [soc, j] of jobs) if (j.jobZone !== null) zones[soc] = j.jobZone;

    const linkCounts = [...jobs.values()].map((j) => j.links.length).sort((a, b) => a - b);
    const allLinks = [...jobs.entries()].flatMap(([soc, j]) => j.links.map((l) => ({ soc, ...l })));
    const directions = { up: 0, same: 0, down: 0, unknown: 0 };
    for (const l of allLinks) {
        const a = jobs.get(l.soc)!.jobZone;
        const b = jobs.get(l.to)?.jobZone ?? null;
        if (a === null || b === null) directions.unknown++;
        else if (b > a) directions.up++;
        else if (b < a) directions.down++;
        else directions.same++;
    }
    const codesBy: Record<CodeRule, number> = { '.00': 0, 'sub-code': 0, combined: 0, unmapped: 0 };
    for (const r of codeRule.values()) codesBy[r]++;
    const tiers = { 'Primary-Short': 0, 'Primary-Long': 0, Supplemental: 0 } as Record<Tier, number>;
    for (const l of allLinks) tiers[l.tier]++;
    const zoneBy = { '.00': 0, 'sub-codes': 0, combined: 0 };
    for (const j of jobs.values()) if (j.jobZoneRule !== 'mixed') zoneBy[j.jobZoneRule]++;
    const rowsUsed = allLinks.reduce((s, l) => s + l.rows.length, 0);

    const noData = inputs.appJobs.filter((j) => !jobs.has(j.soc));
    const counts: CareerPathsCounts = {
        jobs: inputs.appJobs.length,
        withOnetCodes: jobs.size,
        withLinks: linkCounts.filter((n) => n >= 1).length,
        withFivePlus: linkCounts.filter((n) => n >= 5).length,
        noData: noData.length,
        links: allLinks.length,
        maxLinks: linkCounts[linkCounts.length - 1] ?? 0,
        medianLinks: linkCounts[Math.floor(linkCounts.length / 2)] ?? 0,
        multiCodeJobs: [...jobs.values()].filter((j) => j.onetCodes.length > 1).length,
        withJobZone: Object.keys(zones).length,
        mixedZones: mixed.length,
        zoneBy,
        rows: inputs.related.length,
        rowsUsed,
        rowsSelf,
        rowsUnmapped,
        rowsNotOwnCode,
        rowsMerged: rowsUsed - allLinks.length,
        ownCodeJobsWithSubCodes: 0,
        onetCodes: codeRule.size,
        codesBy,
        tiers,
        directions,
    };
    if (counts.rowsUsed + counts.rowsSelf + counts.rowsUnmapped + counts.rowsNotOwnCode !== counts.rows) throw new Error('rows do not add up');
    const ownCodeChanges = [...notOwnBySoc.keys()].sort().map((soc) => ({
        soc,
        title: titleOf.get(soc)!,
        combined: !hasOwnCode.has(soc),
        usedCodes: jobs.get(soc)!.onetCodes,
        subCodes: [...codesOf.get(soc)!].filter((c) => !jobs.get(soc)!.onetCodes.includes(c)).sort(),
        rowsNotUsed: notOwnBySoc.get(soc)!,
        before: allPairs.get(soc)?.size ?? 0,
        after: jobs.get(soc)!.links.length,
    }));
    counts.ownCodeJobsWithSubCodes = ownCodeChanges.length;

    const unmapped = [...codeRule].filter(([, r]) => r === 'unmapped').map(([code]) => ({
        code,
        title: inputs.onetTitles.get(code) ?? '',
        ...(unmappedRows.get(code) ?? { rows: 0, asRelated: 0 }),
    })).sort((a, b) => (a.code < b.code ? -1 : 1));
    const selfLinks = [...selfBySoc].sort(([a], [b]) => (a < b ? -1 : 1)).map(([soc, rows]) => ({ soc, title: titleOf.get(soc)!, rows }));

    const o = inputs.sources.onet;
    const index = {
        _meta: {
            about: 'Career paths: the jobs O*NET lists as related to each of the app\'s jobs, and each job\'s O*NET Job Zone. Links and zones are in the lazy chunks next to this file; only src/utils/careerPaths.ts reads them. Pay and AI Exposure are not stored here.',
            generator: GENERATOR,
            label: CAREER_PATHS_LABEL,
            notMeaning: `Not ${CAREER_PATHS_NOT}: O*NET relates jobs by similar tasks, knowledge and titles, not by real moves.`,
            report: CAREER_PATHS_PATHS.report,
            source: {
                name: o.name,
                version: o.version,
                release: o.release,
                url: o.url,
                license: o.license,
                licenseUrl: o.licenseUrl,
                attribution: o.attribution,
                attributionSource: o.attributionSource,
                databaseUrl: o.databaseUrl,
                licenseDeedUrl: o.licenseDeedUrl,
                files: inputs.sources.files.filter((f) => f.path === RELATED_FILE || f.path === ZONES_FILE).map((f) => ({ path: f.path, sha256: f.sha256 })),
            },
            tiers: [...TIERS],
            jobZoneNames: inputs.zoneNames,
        },
        coverage: {
            jobs: counts.jobs,
            withLinks: counts.withLinks,
            withFivePlus: counts.withFivePlus,
            noData: counts.noData,
            withJobZone: counts.withJobZone,
            mixedZones: mixed.map((m) => m.soc),
            /** Jobs with no stored link (O*NET has nothing for them), so search can say so without loading a chunk. */
            noLinks: inputs.appJobs.filter((j) => (jobs.get(j.soc)?.links.length ?? 0) === 0).map((j) => j.soc),
        },
    };
    const zonesFile = {
        _meta: {
            about: 'O*NET 30.1 Job Zone of every app job that has one (lazy chunk; only src/utils/careerPaths.ts loads it). A job with no zone, or with mixed zones, is absent. Built by scripts/build_career_paths.ts.',
            generator: GENERATOR,
        },
        zones,
    };

    const built: CareerPathsBuild = { index, zones: zonesFile, fields, jobs, counts, unmapped, mixed, zoneOverrides, selfLinks, ownCodeChanges, noData, report: '' };
    built.report = renderReport(inputs, built);
    return built;
}

// ---------------------------------------------------------------- report

const fmt = (n: number): string => n.toLocaleString('en-US');

function renderReport(inputs: CareerPathsInputs, b: CareerPathsBuild): string {
    const c = b.counts;
    const o = inputs.sources.onet;
    const L: string[] = [];
    const p = (s = '') => L.push(s);
    const title = (soc: string) => inputs.appJobs.find((j) => j.soc === soc)?.title ?? '';

    p('# Career paths data (O*NET Related Occupations)');
    p();
    p(`Built by \`${GENERATOR}\` (method in \`scripts/lib/careerPaths.ts\`), checked by \`python3 scripts/verify_career_paths.py\`. Do not edit by hand: \`--check\` fails if this file is stale.`);
    p();
    p('## What it is, and what it is not');
    p();
    p(`The screen must call these links: **"${CAREER_PATHS_LABEL}"**.`);
    p();
    p(`It is **not** "${CAREER_PATHS_NOT}". O*NET picks related jobs from what the jobs involve, not from data on people changing jobs. Every link is a row of the official O*NET file: no AI, no guessing, no similarity score of our own. A job O*NET has nothing for is stored as nothing, and the screen says "no data".`);
    p();
    p('## Sources');
    p();
    p(`${o.version} (${o.release}), ${o.publisher}. Zip: ${o.url}. License: ${o.license} (${o.licenseName}, ${o.licenseUrl}). The Read Me says: "${o.licenseText}"`);
    p();
    p(`Attribution to show with the data (the Career Paths screen shows it, with O*NET's two links: "${o.version} Database" to ${o.databaseUrl}, "${o.license}" to ${o.licenseDeedUrl}): "${o.attribution}"`);
    p();
    p(`Copied from ${o.attributionSource}. ${o.attributionNote}`);
    p();
    p('Every file is pinned by sha256 in `data/career_paths/sources.json`; the build and the verifier both stop on a mismatch.');
    p();
    for (const f of inputs.sources.files) p(`- \`${f.path}\`: ${f.title}. sha256 \`${f.sha256}\``);
    p();
    p('## How O*NET builds Related Occupations (its own words)');
    p();
    for (const q of ONET_METHOD_QUOTES) {
        p(`> ${q.text}`);
        p('>');
        p(`> ${q.page}, ${q.url}`);
        p();
    }
    p('The same data dictionary page defines the columns:');
    p();
    p('- Index: "Order of related code mappings based on expert review"');
    p('- Primary-Short: "Five most strongly related occupations after expert review."');
    p('- Primary-Long: "6th to 10th most strongly related occupations after expert review."');
    p('- Supplemental: "11th to 20th most strongly related occupations after expert review."');
    p();
    p('All of the above was fetched and copied word for word on 2026-11-22. The full 2022 method report (https://www.onetcenter.org/dl_files/Related_2022.pdf) was not read for this build.');
    p();
    p('## Method');
    p();
    p('**1. O*NET code to app job.** The same rules the app already uses:');
    p();
    p(`- A \`.00\` code belongs to its own SOC (${fmt(c.codesBy['.00'])} codes).`);
    p(`- A sub-code (\`.01\`, \`.02\`, ...) belongs to its parent SOC (${fmt(c.codesBy['sub-code'])} codes). \`scripts/build_occupations.py\` joins O*NET on the seven-character SOC the same way.`);
    p(`- A code whose SOC the app only has inside a combined BLS code belongs to that combined job (${fmt(c.codesBy.combined)} codes): for example 13-1021, 13-1022 and 13-1023 all belong to 13-1020 Buyers and Purchasing Agents. The table is \`src/config/onetSplitCodes.ts\` (the scoring plan's table), read through \`socRollup\` in \`scripts/lib/iuSchools.ts\`, so all three builds use one rule.`);
    p(`- Any other code is unmapped: listed below, never forced onto a job (${fmt(c.codesBy.unmapped)} codes).`);
    p();
    p('**2. Links: own code first** (decided 2026-11-22, the same rule tasks already use).');
    p();
    p('- A job with its **own `.00` code** takes its links **only** from that code\'s rows. Rows from its sub-codes (`.01`, `.02`, ...) are not used. Example: Registered Nurses (29-1141) uses only the 29-1141.00 rows, so it does not get Psychiatrists from 29-1141.02.');
    p('- A **combined** BLS job (no code of its own, such as 13-1020 or 29-2010) takes, for **each part**, that part\'s `.00` rows only; a part\'s sub-code rows are used only when that part has no `.00` code. Example: Clinical Laboratory Technologists and Technicians (29-2010) uses 29-2011.00 and 29-2012.00, never 29-2011.01, .02, .04 or 29-2012.01. This is the same rule as its Job Zone (step 3).');
    p('- A SOC O*NET has **only as sub-codes** (such as 15-1299) takes the rows of every sub-code.');
    p('- On the target side, a related sub-code still maps to its parent job (a row to 29-1141.02 is a link to Registered Nurses).');
    p();
    p(`Each used row (a code and one related code) becomes a link between their two app jobs. ${fmt(c.rows)} rows in all:`);
    p();
    p(`- ${fmt(c.rowsUsed)} rows make links.`);
    p(`- ${fmt(c.rowsNotOwnCode)} rows come from sub-codes whose own .00 code (the job's, or a part's) has rows, and are not used (${fmt(c.ownCodeJobsWithSubCodes)} jobs, listed below).`);
    p(`- ${fmt(c.rowsSelf)} rows are self-links (both codes land on the same app job, for example two sub-codes of one SOC) and are dropped.`);
    p(`- ${fmt(c.rowsUnmapped)} rows touch an unmapped code and are dropped.`);
    p(`- Rows that land on the same pair of jobs merge into one link: ${fmt(c.rowsMerged)} rows merged away (from a job's several codes when it has no .00 code, or from several codes of one target job). The link keeps the strongest tier, then the lowest Index, and stores every row it came from (\`rows\`, line numbers in the file, header = line 1).`);
    p('- A job\'s links are in O*NET\'s order: tier (Primary-Short, Primary-Long, Supplemental), then Index, then file line.');
    p();
    p(`**3. Job Zone.** O*NET's preparation level, 1 to 5 (names from \`Job Zone Reference.txt\`: ${Object.entries(inputs.zoneNames).map(([z, n]) => `${z} "${n}"`).join(', ')}).`);
    p();
    p(`- The job's own \`.00\` code's zone (${fmt(c.zoneBy['.00'])} jobs).`);
    p(`- Otherwise the sub-codes' zone, if they all agree (${fmt(c.zoneBy['sub-codes'])} jobs).`);
    p(`- A combined job uses its parts' zones, each part's \`.00\` when it has one, if they all agree (${fmt(c.zoneBy.combined)} jobs).`);
    p(`- Otherwise null, marked "mixed" (${fmt(c.mixedZones)} jobs, listed below).`);
    p(`- Where a job has its own \`.00\` zone, it wins over its sub-codes. ${fmt(b.zoneOverrides.length)} jobs have a sub-code with a different zone (listed below).`);
    p();
    p('**4. Direction.** The screen shows "step up", "same level" or "step down" from the Job Zone difference (target minus current). With either zone missing, the direction is unknown and not shown.');
    p();
    p('## Coverage');
    p();
    p(`- Jobs in the app: **${fmt(c.jobs)}**`);
    p(`- Jobs with at least 1 link: **${fmt(c.withLinks)} of ${fmt(c.jobs)}**`);
    p(`- Jobs with 5 or more links: **${fmt(c.withFivePlus)} of ${fmt(c.jobs)}**`);
    p(`- Jobs with no O*NET data (no links, no zone): **${fmt(c.noData)}**`);
    p(`- Jobs with a Job Zone: **${fmt(c.withJobZone)}**; mixed: **${fmt(c.mixedZones)}**`);
    p(`- Links stored: **${fmt(c.links)}** (Primary-Short ${fmt(c.tiers['Primary-Short'])}, Primary-Long ${fmt(c.tiers['Primary-Long'])}, Supplemental ${fmt(c.tiers.Supplemental)}); median ${c.medianLinks} per job, most ${c.maxLinks}`);
    p(`- Jobs whose links come from more than one O*NET code: **${fmt(c.multiCodeJobs)}**`);
    p(`- Direction of the stored links: up ${fmt(c.directions.up)}, same ${fmt(c.directions.same)}, down ${fmt(c.directions.down)}, unknown ${fmt(c.directions.unknown)}`);
    p();
    p('## Jobs with no data');
    p();
    const allOther = b.noData.filter((j) => j.title.includes('All Other')).length;
    // No tasks anywhere = no task list of its own and not a combined job (whose split codes have tasks): the scoring plan's "no tasks" rule.
    const noTasks = new Set(inputs.appJobs.filter((j) => j.taskCount === 0 && !(j.soc in ONET_CODES_FOR_SOC)).map((j) => j.soc));
    const sameAsNoTasks = noTasks.size === b.noData.length && b.noData.every((j) => noTasks.has(j.soc));
    p(`O*NET 30.1 has no Related Occupations or Job Zone row for any code of these ${fmt(b.noData.length)} jobs, so nothing is stored for them. ${allOther === b.noData.length ? 'All are' : `${fmt(allOther)} are`} BLS "All Other" groups. ${sameAsNoTasks ? `They are exactly the ${fmt(noTasks.size)} jobs with no O*NET tasks anywhere, the ones left not scored (docs/scoring-decisions.md, rule "No tasks").` : `They are not the same set as the ${fmt(noTasks.size)} jobs with no O*NET tasks anywhere.`}`);
    p();
    p(b.noData.map((j) => `${j.soc} ${j.title}`).join('; ') + '.');
    p();
    p('## Unmapped O*NET codes');
    p();
    p('Codes in the O*NET files that are not one of the app\'s jobs. Their rows are dropped, both ways.');
    p();
    for (const u of b.unmapped) p(`- ${u.code} ${u.title}: ${u.rows} rows from it, ${u.asRelated} rows to it.`);
    p();
    p('## Jobs the own-code rule changes');
    p();
    const own = b.ownCodeChanges.filter((x) => !x.combined);
    const comb = b.ownCodeChanges.filter((x) => x.combined);
    p(`These ${fmt(b.ownCodeChanges.length)} jobs have sub-codes in Related Occupations.txt next to a \`.00\` code: ${fmt(own.length)} have their own \`.00\` code, ${fmt(comb.length)} are combined jobs whose parts have one. Their links now come from the \`.00\` rows only. "Before" is the number of links when every code was merged (the first rule in PR #106); "after" is the number stored now.`);
    p();
    for (const x of own) p(`- ${x.soc} ${x.title}: ${x.before} -> ${x.after} links; ${x.rowsNotUsed} rows not used from ${x.subCodes.join(', ')}`);
    for (const x of comb) p(`- ${x.soc} ${x.title} (combined; uses ${x.usedCodes.join(', ')}): ${x.before} -> ${x.after} links; ${x.rowsNotUsed} rows not used from ${x.subCodes.join(', ')}`);
    p();
    p('## Mixed Job Zones');
    p();
    p('Only jobs with no `.00` code can be mixed: a job with its own `.00` zone always uses it. The screen shows "level not available" for these; the level is never guessed.');
    p();
    if (b.mixed.length === 0) p('None.');
    for (const m of b.mixed) p(`- ${m.soc} ${m.title}: ${m.codes.map((x) => `${x.code} zone ${x.zone}`).join(', ')}. Stored as null; direction unknown.`);
    p();
    p('## A sub-code with a different zone from the job\'s own .00');
    p();
    p('The `.00` zone is used. Listed so the choice is visible.');
    p();
    if (b.zoneOverrides.length === 0) p('None.');
    for (const z of b.zoneOverrides) p(`- ${z.soc} ${z.title}: .00 zone ${z.own}; ${z.others.map((x) => `${x.code} zone ${x.zone}`).join(', ')}`);
    p();
    p('## Self-links dropped');
    p();
    p(`${fmt(c.rowsSelf)} rows, by job: ` + b.selfLinks.map((s) => `${s.soc} ${s.title} (${s.rows})`).join('; ') + '.');
    p();
    p('## How pay and AI Exposure are shown');
    p();
    p('Neither is stored here. `src/utils/careerPaths.ts` reads them at view time from the data the app already shows:');
    p();
    p('- **Pay change**: the target\'s BLS OEWS May 2025 median annual wage minus the current job\'s, from the same figures as the role panel\'s pay line (`src/data/national_wages.json` for the Kelley codes, the occupations data for the rest). If either wage is missing (BLS did not publish it, or publishes only hourly pay), there is no pay change. If either wage is top-coded ("#" in the BLS file: at or above BLS\'s cap), the helper returns a top-coded flag with the cap, never an exact difference. In OEWS May 2025 none of the 830 annual medians is top-coded; a test fails if that changes.');
    p('- **AI Exposure**: the target\'s published Automation Risk (`ai_scores_bls.json`, already in the main bundle) put into the map\'s own colour band (`bandFor`, thirds of all scored occupations). A job with no score is "not scored".');
    p();
    p('## Files');
    p();
    p('| File | What |');
    p('|---|---|');
    p('| `data/career_paths/sources.json` | version, release, license and sha256 of every input |');
    p('| `src/data/career_paths/index.json` | meta, the label, tiers, Job Zone names, coverage (small) |');
    p('| `src/data/career_paths/zones.json` | every job\'s Job Zone (one lazy chunk) |');
    p(`| \`src/data/career_paths/<NN>.json\` | each job's links, one lazy chunk per BLS major group (${b.fields.size} files) |`);
    p('| `src/utils/careerPaths.ts` | the only reader of the chunks |');
    p();
    p(`Examples: ${title('13-2011')} (13-2011), ${title('13-2031')} (13-2031) and ${title('47-2111')} (47-2111) are checked link by link against the raw file in \`src/__tests__/careerPaths.test.ts\`.`);
    p();
    return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------- files

export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** One job per block, one link per line, so a diff shows which link changed. */
export function serializeField(f: FieldChunk): string {
    const socs = Object.entries(f.socs).map(([soc, j]) => {
        const head = `    ${JSON.stringify(soc)}: {\n      "jobZone": ${JSON.stringify(j.jobZone)},\n      "jobZoneRule": ${JSON.stringify(j.jobZoneRule)},\n      "jobZoneRows": ${JSON.stringify(j.jobZoneRows)},\n      "onetCodes": ${JSON.stringify(j.onetCodes)},\n`;
        const links = j.links.length === 0 ? '      "links": []' : `      "links": [\n${j.links.map((l) => `        ${JSON.stringify(l)}`).join(',\n')}\n      ]`;
        return `${head}${links}\n    }`;
    });
    return `{\n  "_meta": ${JSON.stringify(f._meta, null, 2).replace(/\n/g, '\n  ')},\n  "socs": {\n${socs.join(',\n')}\n  }\n}\n`;
}

export function outputFiles(b: CareerPathsBuild): [string, string][] {
    const out: [string, string][] = [
        [CAREER_PATHS_PATHS.index, serialize(b.index)],
        [CAREER_PATHS_PATHS.zones, `{\n  "_meta": ${JSON.stringify(b.zones._meta, null, 2).replace(/\n/g, '\n  ')},\n  "zones": ${JSON.stringify(b.zones.zones)}\n}\n`],
        [CAREER_PATHS_PATHS.report, b.report],
    ];
    for (const [code, f] of [...b.fields].sort(([a], [z]) => (a < z ? -1 : 1))) out.push([`${CAREER_PATHS_PATHS.outDir}/${code}.json`, serializeField(f)]);
    return out;
}

/** Outputs whose committed bytes under `root` differ from the build (missing counts as stale). */
export function staleOutputs(root: string, b: CareerPathsBuild): string[] {
    return outputFiles(b)
        .filter(([rel, body]) => {
            const abs = path.join(root, rel);
            return !fs.existsSync(abs) || fs.readFileSync(abs, 'utf-8') !== body;
        })
        .map(([rel]) => rel);
}
