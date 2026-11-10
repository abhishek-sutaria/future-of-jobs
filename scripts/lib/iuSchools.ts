/**
 * IU Bloomington schools -> degree programs -> CIP 2020 codes -> the app's jobs.
 * Pure apart from loadIuSchoolInputs(), which only reads committed files.
 * scripts/build_iu_schools.ts writes the outputs; docs/iu-schools.md (written
 * by the same build) explains the method and lists every gap.
 *
 *   1. Programs: IU's degree finder data for Bloomington (one row per program
 *      and school; rows sharing a URL are one program). Certificates, diplomas
 *      and accelerated combinations are left out (rules.excludedDegreeTypes).
 *   2. CIP: data/iu_schools/program_cip_rules.json gives each program its CIP
 *      code(s). A code counts only if IU Bloomington reports it in IPEDS
 *      Completions 2023-24 at the program's own award level.
 *   3. SOC: the NCES CIP 2020 to SOC 2018 crosswalk, sheet CIP-SOC.
 *   4. Jobs: a SOC code that is one of the app's 830 occupations is that job.
 *      A detailed SOC code the app only has inside a combined BLS code (a broad
 *      code such as 13-1020, or an OEWS aggregate such as 21-1018) rolls up to
 *      it, using the parts listed in src/config/onetSplitCodes.ts. Anything
 *      else is reported as not among the app's jobs.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { ONET_CODES_FOR_SOC, ONET_SPLIT_CODES_WITHOUT_TASKS } from '../../src/config/onetSplitCodes';

export type Level = 'A' | 'B' | 'M' | 'P' | 'D';
export type Basis = 'title' | 'degree' | 'reviewed' | 'none';

export const LEVEL_OF_BADGE: Readonly<Record<string, Level>> = {
    "Associate's": 'A',
    "Bachelor's": 'B',
    "Master's": 'M',
    "Post-master's": 'P',
    Doctoral: 'D',
};

/** IPEDS award levels (AWLEVEL) that count as the same level as a program. */
export const AWLEVELS: Readonly<Record<Level, readonly string[]>> = {
    A: ['3'],
    B: ['5'],
    M: ['7'],
    // IU Bloomington reports no post-master's certificates (8), so a specialist degree may sit with master's awards.
    P: ['6', '7', '8'],
    D: ['17', '18', '19'],
};

export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
    A: "associate's",
    B: "bachelor's",
    M: "master's",
    P: 'specialist',
    D: 'doctoral',
};

const LEVEL_ORDER: readonly Level[] = ['A', 'B', 'M', 'P', 'D'];

export interface SourceFile {
    path: string;
    title: string;
    publisher: string;
    url: string;
    retrieved: string;
    sha256: string;
    seenAt?: string;
    zipSha256?: string;
    member?: string;
    memberSha256?: string;
    /** For an IPEDS extract: whose rows it holds. */
    ipedsUnitid?: string;
    /** For an IPEDS extract of another campus: only codes starting with this. */
    cipPrefix?: string;
}
export interface SourcePage {
    title: string;
    url: string;
    retrieved: string;
    sha256: string;
}
export interface SourcesManifest {
    files: SourceFile[];
    pages: SourcePage[];
}

export interface SchoolDef {
    id: string;
    name: string;
    apiNames: string[];
    onlyWhenAlone?: boolean;
}
export interface SchoolsFile {
    excluded: { name: string; reason: string }[];
    schools: SchoolDef[];
}

export interface DegreeRule {
    degree: string;
    pattern?: string;
    cips: string[];
    basis: Basis;
    note: string;
    /** Check the code against this IU campus's IPEDS rows (sources.json) instead of IU Bloomington's. */
    campusUnitid?: string;
}
export interface SubjectRule {
    subject: string;
    levels?: Level[];
    degrees?: string[];
    cips: string[];
    basis: Basis;
    note: string;
    /** Check the code against this IU campus's IPEDS rows (sources.json) instead of IU Bloomington's. */
    campusUnitid?: string;
}
export interface RulesFile {
    excludedDegreeTypes: string[];
    degreeRules: DegreeRule[];
    subjectRules: SubjectRule[];
}

export interface ApiDegree {
    name: string;
    degree: string;
    typeName: string;
    diploma_badge: string;
    campus: string;
    schools: { name: string }[];
    url: string;
}

export interface IuSchoolInputs {
    sources: SourcesManifest;
    schools: SchoolsFile;
    rules: RulesFile;
    api: { data: ApiDegree[] };
    ipedsCsv: string;
    /** Other IU campuses' pinned IPEDS rows, by UNITID, for rules with campusUnitid. */
    otherIpeds: Record<string, string>;
    crosswalk: Buffer | Uint8Array;
    /** The app's 830 occupations: SOC and BLS title. */
    occupations: { soc: string; title: string }[];
}

export const IU_SCHOOLS_PATHS = {
    sources: 'data/iu_schools/sources.json',
    schools: 'data/iu_schools/schools.json',
    rules: 'data/iu_schools/program_cip_rules.json',
    occupations: 'src/data/occupations/index.json',
    full: 'src/data/iu_schools.json',
    slim: 'src/data/iu_school_jobs.json',
    report: 'docs/iu-schools.md',
} as const;

/** IU Bloomington in IPEDS. */
export const IUB_UNITID = '151351';
/** Names for the other IU campuses a rule may check a code against. */
export const IU_CAMPUS_NAMES: Readonly<Record<string, string>> = { '151111': 'IU Indianapolis' };

export const sha256 = (buf: Buffer | Uint8Array | string): string => crypto.createHash('sha256').update(buf).digest('hex');

/** Read every input from the repo, checking each raw file against its sha256 in sources.json. */
export function loadIuSchoolInputs(root: string): IuSchoolInputs {
    const read = (rel: string) => fs.readFileSync(path.join(root, rel));
    const json = <T>(rel: string): T => JSON.parse(read(rel).toString('utf-8')) as T;
    const sources = json<SourcesManifest>(IU_SCHOOLS_PATHS.sources);
    const raw = new Map<string, Buffer>();
    for (const f of sources.files) {
        const buf = read(path.join('data/iu_schools', f.path));
        const got = sha256(buf);
        if (got !== f.sha256) throw new Error(`data/iu_schools/${f.path}: sha256 ${got} does not match sources.json (${f.sha256})`);
        raw.set(f.path, buf);
    }
    const file = (suffix: string) => {
        const hit = [...raw.entries()].find(([p]) => p.endsWith(suffix));
        if (!hit) throw new Error(`sources.json lists no ${suffix}`);
        return hit[1];
    };
    const index = json<{ occupations: { soc: string; title: string }[] }>(IU_SCHOOLS_PATHS.occupations);
    return {
        sources,
        schools: json<SchoolsFile>(IU_SCHOOLS_PATHS.schools),
        rules: json<RulesFile>(IU_SCHOOLS_PATHS.rules),
        api: JSON.parse(file('iu_degrees_bloomington.json').toString('utf-8')),
        ipedsCsv: file('ipeds_c2024_a_unitid_151351.csv').toString('utf-8'),
        otherIpeds: Object.fromEntries(sources.files
            .filter((f) => f.ipedsUnitid && f.ipedsUnitid !== IUB_UNITID)
            .map((f) => [f.ipedsUnitid!, raw.get(f.path)!.toString('utf-8')])),
        crosswalk: file('CIP2020_SOC2018_Crosswalk.xlsx'),
        occupations: index.occupations.map((o) => ({ soc: o.soc, title: o.title })),
    };
}

// ---------------------------------------------------------------- IPEDS

/** One CSV line, with "quoted" fields (IPEDS quotes codes and flags, never with commas inside, but this copes). */
export function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}

/** CIP -> IPEDS award level -> completions (first and second majors together), for UNITID 151351 only. */
export function parseIpeds(csv: string, unitid = '151351'): Map<string, Map<string, number>> {
    const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
    const head = parseCsvLine(lines[0]);
    const at = (name: string) => {
        const i = head.indexOf(name);
        if (i < 0) throw new Error(`IPEDS file has no ${name} column`);
        return i;
    };
    const [iUnit, iCip, iLevel, iTotal] = [at('UNITID'), at('CIPCODE'), at('AWLEVEL'), at('CTOTALT')];
    const out = new Map<string, Map<string, number>>();
    for (const line of lines.slice(1)) {
        const row = parseCsvLine(line);
        if (row[iUnit] !== unitid) throw new Error(`IPEDS extract holds UNITID ${row[iUnit]}, expected only ${unitid}`);
        const cip = row[iCip];
        if (cip === '99') continue; // the institution's grand total
        const level = row[iLevel];
        const byLevel = out.get(cip) ?? new Map<string, number>();
        byLevel.set(level, (byLevel.get(level) ?? 0) + Number(row[iTotal] || 0));
        out.set(cip, byLevel);
    }
    return out;
}

export function reportedAt(ipeds: Map<string, Map<string, number>>, cip: string, level: Level): boolean {
    const byLevel = ipeds.get(cip);
    return !!byLevel && AWLEVELS[level].some((a) => byLevel.has(a));
}

// ---------------------------------------------------------------- crosswalk

export interface Crosswalk {
    cipTitle: Map<string, string>;
    /** CIP -> detailed SOC 2018 codes, in file order; [] for a CIP the crosswalk matches to no SOC. */
    cipSocs: Map<string, string[]>;
    socTitle: Map<string, string>;
}

export const NO_MATCH_SOC = '99-9999';

export function parseCrosswalk(buf: Buffer | Uint8Array): Crosswalk {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = (sheet: string, header: string[]) => {
        const ws = wb.Sheets[sheet];
        if (!ws) throw new Error(`Crosswalk has no sheet "${sheet}"`);
        const all = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][];
        if (header.some((h, i) => all[0]?.[i] !== h)) throw new Error(`Crosswalk sheet "${sheet}" header changed: ${JSON.stringify(all[0])}`);
        return all.slice(1).filter((r) => r.length > 0 && r[0] != null).map((r) => r.map((c) => String(c ?? '').trim()));
    };
    const cipTitle = new Map<string, string>();
    const cipSocs = new Map<string, string[]>();
    const socTitle = new Map<string, string>();
    for (const [cip, ctitle, soc, stitle] of rows('CIP-SOC', ['CIP2020Code', 'CIP2020Title', 'SOC2018Code', 'SOC2018Title'])) {
        cipTitle.set(cip, ctitle);
        const list = cipSocs.get(cip) ?? [];
        if (soc !== NO_MATCH_SOC && !list.includes(soc)) list.push(soc);
        cipSocs.set(cip, list);
        if (soc !== NO_MATCH_SOC) socTitle.set(soc, stitle);
    }
    for (const [cip, ctitle] of rows('Unmatched CIP Codes', ['CIP2020Code', 'CIP2020Title', 'SOC2018Code', 'SOC2018Title'])) {
        cipTitle.set(cip, ctitle);
        if (!cipSocs.has(cip)) cipSocs.set(cip, []);
    }
    for (const [soc, stitle] of rows('SOC-CIP', ['SOC2018Code', 'SOC2018Title', 'CIP2020Code', 'CIP2020Title'])) socTitle.set(soc, stitle);
    for (const [soc, stitle] of rows('Unmatched SOC Codes', ['SOC2018Code', 'SOC2018Title', 'CIP2020Code', 'CIP2020Title'])) socTitle.set(soc, stitle);
    return { cipTitle, cipSocs, socTitle };
}

// ---------------------------------------------------------------- SOC roll-up

/**
 * Detailed SOC 2018 code -> the app occupation that holds it. The app's own
 * code when it has one; otherwise the combined code (13-1020, 21-1018, ...)
 * whose parts, in src/config/onetSplitCodes.ts, include it.
 */
export function socRollup(appSocs: ReadonlySet<string>): { parts: Record<string, string[]>; toApp: (soc: string) => string | null } {
    const parts: Record<string, string[]> = {};
    for (const table of [ONET_CODES_FOR_SOC, ONET_SPLIT_CODES_WITHOUT_TASKS]) {
        for (const [combined, codes] of Object.entries(table)) {
            if (!appSocs.has(combined)) throw new Error(`onetSplitCodes.ts names ${combined}, which is not one of the app's occupations`);
            const list = parts[combined] ?? [];
            for (const c of codes) {
                const soc = c.slice(0, 7);
                if (!list.includes(soc)) list.push(soc);
            }
            parts[combined] = list.sort();
        }
    }
    const owner = new Map<string, string>();
    for (const [combined, list] of Object.entries(parts)) {
        for (const soc of list) {
            if (appSocs.has(soc)) throw new Error(`${soc} is both an app occupation and a part of ${combined}`);
            const prev = owner.get(soc);
            if (prev && prev !== combined) throw new Error(`${soc} is a part of both ${prev} and ${combined}`);
            owner.set(soc, combined);
        }
    }
    const sorted: Record<string, string[]> = {};
    for (const k of Object.keys(parts).sort()) sorted[k] = parts[k];
    return { parts: sorted, toApp: (soc) => (appSocs.has(soc) ? soc : owner.get(soc) ?? null) };
}

// ---------------------------------------------------------------- programs

export interface Program {
    url: string;
    name: string;
    degree: string;
    typeName: string;
    level: Level;
    subject: string;
    schools: string[];
}

/** The program name with every parenthesis removed and a trailing " BFA" dropped. */
export function subjectOf(name: string): string {
    return name.replace(/\([^)]*\)/g, ' ').replace(/\s+BFA\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export function collectPrograms(api: { data: ApiDegree[] }, rules: RulesFile, schools: SchoolsFile): { programs: Program[]; excludedRows: number } {
    const excluded = new Set(rules.excludedDegreeTypes);
    const byApiName = new Map<string, SchoolDef>();
    for (const s of schools.schools) for (const n of s.apiNames) byApiName.set(n, s);
    const merged = new Map<string, { rows: ApiDegree[]; apiSchools: Set<string> }>();
    let excludedRows = 0;
    for (const row of api.data) {
        if (row.campus !== 'IU Bloomington') throw new Error(`Program ${row.url} is not at IU Bloomington (${row.campus})`);
        if (excluded.has(row.typeName)) { excludedRows++; continue; }
        if (!LEVEL_OF_BADGE[row.diploma_badge]) throw new Error(`Unknown award level "${row.diploma_badge}" for ${row.url}`);
        const m = merged.get(row.url) ?? { rows: [], apiSchools: new Set<string>() };
        m.rows.push(row);
        for (const s of row.schools) m.apiSchools.add(s.name);
        merged.set(row.url, m);
    }
    const programs: Program[] = [];
    for (const [url, { rows, apiSchools }] of merged) {
        const first = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.degree.localeCompare(b.degree))[0];
        for (const r of rows) {
            if (r.degree !== first.degree || r.diploma_badge !== first.diploma_badge) throw new Error(`Rows for ${url} disagree on the degree`);
        }
        const defs = [...apiSchools].map((n) => {
            const d = byApiName.get(n);
            if (!d) throw new Error(`School "${n}" (program ${url}) is not in schools.json`);
            return d;
        });
        const home = defs.filter((d) => !d.onlyWhenAlone);
        const ids = [...new Set((home.length > 0 ? home : defs).map((d) => d.id))];
        const order = schools.schools.map((s) => s.id);
        ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        programs.push({
            url,
            name: first.name.replace(/\s+/g, ' ').trim(),
            degree: first.degree,
            typeName: first.typeName,
            level: LEVEL_OF_BADGE[first.diploma_badge],
            subject: subjectOf(first.name),
            schools: ids,
        });
    }
    programs.sort(compareProgram);
    return { programs, excludedRows };
}

export function compareProgram(a: Pick<Program, 'level' | 'name' | 'degree' | 'url'>, b: Pick<Program, 'level' | 'name' | 'degree' | 'url'>): number {
    return LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)
        || a.name.localeCompare(b.name)
        || a.degree.localeCompare(b.degree)
        || a.url.localeCompare(b.url);
}

export interface ProgramMatch {
    cips: string[];
    basis: Basis | 'double-major';
    /** Which rule decided it, for the report. */
    rule: string;
    /** Set when the program ends with no CIP, or lost one of its rule's codes to the level check. */
    reason?: string;
    /** Set when its code was checked against another IU campus's IPEDS rows. */
    campusUnitid?: string;
}

function subjectRuleFor(rules: RulesFile, subject: string, p: Program): SubjectRule | undefined {
    return rules.subjectRules.find((r) =>
        r.subject === subject
        && (!r.levels || r.levels.includes(p.level))
        && (!r.degrees || r.degrees.includes(p.degree)));
}

/** The rule's codes, kept only where IU Bloomington reports them at the program's level. */
function checkLevels(cips: string[], p: Program, ipeds: Map<string, Map<string, number>>): { kept: string[]; dropped: string[] } {
    const kept = cips.filter((c) => reportedAt(ipeds, c, p.level));
    return { kept, dropped: cips.filter((c) => !kept.includes(c)) };
}

const campusName = (unitid: string) => (unitid === IUB_UNITID ? 'IU Bloomington' : IU_CAMPUS_NAMES[unitid] ?? `UNITID ${unitid}`);

const notAtLevel = (dropped: string[], level: Level, unitid = IUB_UNITID) =>
    `${dropped.join(', ')} ${dropped.length > 1 ? 'are' : 'is'} not reported by ${campusName(unitid)} at ${LEVEL_NAMES[level]} level in IPEDS 2023-24`;

export function matchProgram(
    p: Program,
    rules: RulesFile,
    ipeds: Map<string, Map<string, number>>,
    otherCampuses: ReadonlyMap<string, Map<string, Map<string, number>>> = new Map(),
): ProgramMatch {
    const finish = (cips: string[], basis: Basis | 'double-major', rule: string, note: string, unitid?: string): ProgramMatch => {
        if (basis === 'none' || cips.length === 0) return { cips: [], basis: 'none', rule, reason: note };
        const data = unitid ? otherCampuses.get(unitid) : ipeds;
        if (!data) throw new Error(`Rule "${rule}" checks UNITID ${unitid}, which has no IPEDS extract in sources.json`);
        const { kept, dropped } = checkLevels(cips, p, data);
        const campus = unitid ? { campusUnitid: unitid } : {};
        if (kept.length === 0) return { cips: [], basis: 'none', rule, reason: notAtLevel(dropped, p.level, unitid) };
        return dropped.length > 0 ? { cips: kept, basis, rule, reason: notAtLevel(dropped, p.level, unitid), ...campus } : { cips: kept, basis, rule, ...campus };
    };
    const degreeRule = rules.degreeRules.find((r) => r.degree === p.degree && (!r.pattern || new RegExp(r.pattern).test(p.subject)));
    if (degreeRule) return finish(degreeRule.cips, degreeRule.basis, `degree: ${degreeRule.degree}${degreeRule.pattern ? ` /${degreeRule.pattern}/` : ''}`, degreeRule.note, degreeRule.campusUnitid);
    const exact = subjectRuleFor(rules, p.subject, p);
    if (exact) return finish(exact.cips, exact.basis, `subject: ${exact.subject}`, exact.note, exact.campusUnitid);
    const parts = p.subject.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
        const hits = parts.map((part) => subjectRuleFor(rules, part, p));
        const missing = parts.filter((_, i) => !hits[i]);
        if (missing.length > 0) throw new Error(`No rule for part "${missing.join('", "')}" of ${p.name} (${p.degree}, ${p.url})`);
        if (hits.some((h) => h!.campusUnitid)) throw new Error(`${p.name}: a double major cannot take a code from another campus; give it its own rule`);
        const cips = [...new Set(hits.flatMap((h) => h!.cips))];
        const none = parts.filter((_, i) => hits[i]!.cips.length === 0);
        const m = finish(cips, 'double-major', `double major: ${parts.join(' + ')}`, `No part of it has a code: ${hits.map((h) => h!.note).join(' ')}`);
        if (none.length === 0 || m.cips.length === 0) return m;
        const extra = `${none.join(', ')} has no code (${hits.filter((h) => h!.cips.length === 0).map((h) => h!.note).join(' ')})`;
        return { ...m, reason: m.reason ? `${m.reason}; ${extra}` : extra };
    }
    throw new Error(`No rule for "${p.subject}" (${p.name}, ${p.degree}, ${LEVEL_NAMES[p.level]}, ${p.url}). Add one to program_cip_rules.json.`);
}

// ---------------------------------------------------------------- build

export interface CipEntry {
    title: string;
    /** Detailed SOC 2018 codes from the crosswalk. */
    socs: string[];
    /** The app jobs those reach, after the roll-up. */
    jobs: string[];
    /** IU Bloomington completions in 2023-24 by IPEDS award level. */
    iubAwards: Record<string, number>;
    /** The same for another IU campus a rule checked this code against, by UNITID. */
    campusAwards?: Record<string, Record<string, number>>;
}
export interface MajorOut {
    name: string;
    degree: string;
    level: Level;
    url: string;
    cips: string[];
    basis: ProgramMatch['basis'];
    jobs: string[];
    reason?: string;
    /** Its code was confirmed in this IU campus's IPEDS rows, not IU Bloomington's. */
    campusUnitid?: string;
}
export interface SchoolOut {
    id: string;
    name: string;
    inDropdown: boolean;
    majorCount: number;
    matchedMajorCount: number;
    cips: string[];
    jobs: string[];
    majors: MajorOut[];
}
export interface IuSchoolsFull {
    _meta: {
        about: string[];
        sources: SourcesManifest;
        excludedSchools: SchoolsFile['excluded'];
        socRollup: Record<string, string[]>;
        counts: {
            schools: number;
            schoolsInDropdown: number;
            programs: number;
            matchedPrograms: number;
            excludedRows: number;
            cips: number;
            jobs: number;
            appJobs: number;
        };
    };
    cips: Record<string, CipEntry>;
    schools: SchoolOut[];
}
export interface IuSchoolsSlim {
    _about: string;
    schools: { id: string; name: string; jobs: string[] }[];
}

const byCode = (a: string, b: string) => a.localeCompare(b);

export function buildIuSchools(inputs: IuSchoolInputs): { full: IuSchoolsFull; slim: IuSchoolsSlim; report: string } {
    const ipeds = parseIpeds(inputs.ipedsCsv);
    const otherCampuses = new Map<string, Map<string, Map<string, number>>>();
    for (const f of inputs.sources.files) {
        if (!f.ipedsUnitid || f.ipedsUnitid === IUB_UNITID) continue;
        const data = parseIpeds(inputs.otherIpeds[f.ipedsUnitid], f.ipedsUnitid);
        for (const cip of data.keys()) {
            if (f.cipPrefix && !cip.startsWith(f.cipPrefix)) throw new Error(`${f.path} holds ${cip}, outside ${f.cipPrefix}`);
        }
        otherCampuses.set(f.ipedsUnitid, data);
    }
    const xw = parseCrosswalk(inputs.crosswalk);
    const appSocs = new Set(inputs.occupations.map((o) => o.soc));
    const appTitle = new Map(inputs.occupations.map((o) => [o.soc, o.title]));
    const rollup = socRollup(appSocs);
    const { programs, excludedRows } = collectPrograms(inputs.api, inputs.rules, inputs.schools);

    const cipEntries = new Map<string, CipEntry>();
    const cipEntry = (cip: string): CipEntry => {
        let e = cipEntries.get(cip);
        if (e) return e;
        const title = xw.cipTitle.get(cip);
        const socs = xw.cipSocs.get(cip);
        if (title === undefined || socs === undefined) throw new Error(`CIP ${cip} is not in the CIP 2020 to SOC 2018 crosswalk`);
        const jobs = [...new Set(socs.map(rollup.toApp).filter((s): s is string => s !== null))].sort(byCode);
        const byLevel = (data: Map<string, Map<string, number>>) => {
            const awards: Record<string, number> = {};
            for (const [lvl, n] of [...(data.get(cip) ?? new Map<string, number>())].sort((a, b) => Number(a[0]) - Number(b[0]))) awards[lvl] = n;
            return awards;
        };
        e = { title, socs: [...socs].sort(byCode), jobs, iubAwards: byLevel(ipeds) };
        const campus: Record<string, Record<string, number>> = {};
        for (const [unitid, data] of [...otherCampuses].sort((a, b) => byCode(a[0], b[0]))) if (data.has(cip)) campus[unitid] = byLevel(data);
        if (Object.keys(campus).length > 0) e.campusAwards = campus;
        cipEntries.set(cip, e);
        return e;
    };

    const majorsBySchool = new Map<string, MajorOut[]>(inputs.schools.schools.map((s) => [s.id, []]));
    const unruled: string[] = [];
    const matches = new Map<string, ProgramMatch>();
    for (const p of programs) {
        try {
            matches.set(p.url, matchProgram(p, inputs.rules, ipeds, otherCampuses));
        } catch (err) {
            unruled.push((err as Error).message);
        }
    }
    if (unruled.length > 0) throw new Error(`${unruled.length} programs have no rule:\n${unruled.join('\n')}`);
    for (const p of programs) {
        const m = matches.get(p.url)!;
        const cips = [...m.cips].sort(byCode);
        const jobs = [...new Set(cips.flatMap((c) => cipEntry(c).jobs))].sort(byCode);
        const out: MajorOut = { name: p.name, degree: p.degree, level: p.level, url: p.url, cips, basis: m.basis, jobs };
        if (m.reason) out.reason = m.reason;
        if (m.campusUnitid) out.campusUnitid = m.campusUnitid;
        for (const id of p.schools) majorsBySchool.get(id)!.push(out);
    }

    const schools: SchoolOut[] = inputs.schools.schools.map((s) => {
        const majors = majorsBySchool.get(s.id)!;
        const cips = [...new Set(majors.flatMap((m) => m.cips))].sort(byCode);
        const jobs = [...new Set(majors.flatMap((m) => m.jobs))].sort(byCode);
        return {
            id: s.id,
            name: s.name,
            inDropdown: jobs.length > 0,
            majorCount: majors.length,
            matchedMajorCount: majors.filter((m) => m.cips.length > 0).length,
            cips,
            jobs,
            majors,
        };
    });

    const cips: Record<string, CipEntry> = {};
    for (const k of [...cipEntries.keys()].sort(byCode)) cips[k] = cipEntries.get(k)!;
    const allJobs = new Set(schools.flatMap((s) => s.jobs));
    const full: IuSchoolsFull = {
        _meta: {
            about: [
                'Generated by scripts/build_iu_schools.ts from data/iu_schools/ (do not edit). docs/iu-schools.md is the coverage report.',
                'schools[].majors: IU Bloomington degree programs (certificates, diplomas and accelerated combinations left out). cips: the program\'s CIP 2020 code(s); basis: how the code was matched (program_cip_rules.json); jobs: the app occupations (SOC codes, src/data/occupations/index.json) the codes lead to through the NCES crosswalk.',
                'socRollup: detailed SOC 2018 codes that the app holds only inside a combined BLS code; a crosswalk SOC listed here counts as that combined job.',
            ],
            sources: inputs.sources,
            excludedSchools: inputs.schools.excluded,
            socRollup: rollup.parts,
            counts: {
                schools: schools.length,
                schoolsInDropdown: schools.filter((s) => s.inDropdown).length,
                programs: programs.length,
                matchedPrograms: programs.filter((p) => schools.some((s) => s.majors.some((m) => m.url === p.url && m.cips.length > 0))).length,
                excludedRows,
                cips: cipEntries.size,
                jobs: allJobs.size,
                appJobs: appSocs.size,
            },
        },
        cips,
        schools,
    };
    const slim: IuSchoolsSlim = {
        _about: 'Generated by scripts/build_iu_schools.ts (do not edit): each IU Bloomington school with at least one job, and the SOC codes of the jobs its programs lead to. Full data: src/data/iu_schools.json; method and gaps: docs/iu-schools.md.',
        schools: schools.filter((s) => s.inDropdown).map((s) => ({ id: s.id, name: s.name, jobs: s.jobs })),
    };
    const report = renderReport(full, { ipeds, xw, appTitle, programs });
    return { full, slim, report };
}

// ---------------------------------------------------------------- report

const fmt = (n: number) => n.toLocaleString('en-US');
const mdCell = (s: string) => s.replace(/\|/g, '\\|');

function renderReport(
    full: IuSchoolsFull,
    ctx: { ipeds: Map<string, Map<string, number>>; xw: Crosswalk; appTitle: Map<string, string>; programs: Program[] },
): string {
    const { counts } = full._meta;
    const L: string[] = [];
    L.push('# IU Bloomington schools: majors, CIP codes and jobs');
    L.push('');
    L.push('Generated by `npx tsx scripts/build_iu_schools.ts` (do not edit by hand; edit `data/iu_schools/` and rebuild). It feeds the hidden IU school filter on the 3D map: Cmd+S on a Mac, Ctrl+S elsewhere, or a long press on the field picker on a touch screen.');
    L.push('');
    L.push(`- ${counts.schools} degree-granting schools, ${counts.schoolsInDropdown} with at least one job (the dropdown shows only those).`);
    L.push(`- ${fmt(counts.programs)} degree programs (bachelor's, master's, specialist, doctoral, one associate's). ${fmt(counts.excludedRows)} rows of IU's list are certificates, diplomas or accelerated combinations and are left out.`);
    L.push(`- ${fmt(counts.matchedPrograms)} programs matched to at least one CIP code; ${fmt(counts.programs - counts.matchedPrograms)} not matched (listed below, each with the reason).`);
    L.push(`- ${counts.cips} CIP codes used, leading to ${counts.jobs} of the app's ${counts.appJobs} jobs.`);
    L.push('');
    L.push('## Schools');
    L.push('');
    L.push('| School | Degree programs | Matched to a CIP | CIP codes | Jobs | In dropdown |');
    L.push('|---|---:|---:|---:|---:|---|');
    for (const s of full.schools) {
        L.push(`| ${mdCell(s.name)} | ${s.majorCount} | ${s.matchedMajorCount} | ${s.cips.length} | ${s.jobs.length} | ${s.inDropdown ? 'yes' : '**no, 0 jobs**'} |`);
    }
    L.push('');
    const out = full.schools.filter((s) => !s.inDropdown);
    if (out.length > 0) {
        L.push(`Kept out of the dropdown (0 jobs): ${out.map((s) => s.name).join('; ')}. ${out.map((s) => `${s.name}: ${s.majorCount === 0 ? 'no degree programs in IU\'s list' : `none of its ${s.majorCount} programs could be matched to a CIP code (reasons under "Majors with no CIP match")`}`).join('. ')}.`);
        L.push('');
    }
    for (const e of full._meta.excludedSchools) L.push(`Not a school here: ${e.name}. ${e.reason}`);
    L.push('');
    L.push('Programs IU lists under more than one school count for each of them. The College\'s own schools (Eskenazi, Hamilton Lugar, The Media School) are part of the College of Arts and Sciences, and IU lists most of their programs under both, so those programs count for the College too. A program listed under the Graduate School and an academic school counts for the academic school only.');
    L.push('');
    L.push('## Method');
    L.push('');
    L.push('1. **Schools**: the 16 degree-granting schools on IU Bloomington\'s schools page, named as it names them (`data/iu_schools/schools.json`).');
    L.push('2. **Programs**: IU\'s degree finder data for Bloomington, the list behind "Browse All Programs". Each row names the program, its degree and its school(s). Rows that share a URL are one program.');
    L.push('3. **CIP codes**: IU publishes no program-to-CIP list without an IU login (its Academic Program Inventory is behind IU single sign-on, and the state\'s is behind a CHE login). So each program gets its code from a reviewed rule in `data/iu_schools/program_cip_rules.json`, and the build accepts a code only if IU Bloomington (UNITID 151351) reports it in IPEDS Completions 2023-24 at the program\'s own award level. Rule kinds:');
    L.push('   - `title`: the CIP title names the same subject (History -> 54.0101 History, General).');
    L.push('   - `degree`: IU reports the whole degree under one code, so every major in it takes that code. For example, every Kelley BSB major is 52.0101 Business/Commerce, General: IPEDS shows 2,407 business bachelor\'s awards under 52.0101 and no major-specific business code at bachelor\'s level.');
    L.push('   - `reviewed`: matched by subject where the title differs; the rule\'s note gives the reason (usually "the only code in this subject IU Bloomington reports at this level").');
    L.push('   - `double-major`: a program named "A/B" takes the codes of A and B.');
    L.push('   - `none`: left unmatched on purpose, with the reason. Nothing is guessed; a new program with no rule stops the build.');
    L.push('   - A rule with `campusUnitid` is the one exception to "IU Bloomington reports it": for a school whose degrees IU reports under another campus, the code is checked against that campus\'s IPEDS rows instead. Every such program is listed under "Codes confirmed at another IU campus".');
    L.push('4. **Jobs**: the NCES CIP 2020 to SOC 2018 crosswalk (sheet CIP-SOC) gives each code its SOC occupations, then each SOC is matched to the app\'s 830 jobs.');
    L.push('');
    L.push('### SOC roll-up');
    L.push('');
    const direct = [...ctx.appTitle.keys()].filter((soc) => ctx.xw.socTitle.has(soc)).length;
    const combinedCount = Object.keys(full._meta.socRollup).length;
    L.push(`The app uses BLS OEWS codes. ${direct} of its ${counts.appJobs} are SOC 2018 detailed codes and match directly. The other ${counts.appJobs - direct} are combined codes (${combinedCount} with listed parts), BLS broad groups (for example 13-1020 Buyers and Purchasing Agents) or OEWS aggregates (for example 21-1018). The crosswalk only uses detailed codes, so a detailed code the app holds inside one of these counts as that job. The parts come from \`src/config/onetSplitCodes.ts\`, the same table the scoring plan uses:`);
    L.push('');
    for (const [combined, parts] of Object.entries(full._meta.socRollup)) {
        L.push(`- ${combined} ${ctx.appTitle.get(combined) ?? ''}: ${parts.join(', ')}`);
    }
    L.push('');
    L.push('A crosswalk SOC that is neither an app job nor one of these parts is listed under "SOC codes not among the app\'s jobs".');
    L.push('');
    L.push('## Spot checks (from the real crosswalk)');
    L.push('');
    const cipLine = (cip: string, socs: string[]) => {
        const e = full.cips[cip];
        return `- ${cip} ${e?.title ?? '(not used)'} -> ${socs.map((s) => `${s} ${ctx.xw.socTitle.get(s)} ${e?.jobs.includes(s) ? '(yes)' : '(NO)'}`).join('; ')}`;
    };
    L.push(cipLine('52.0301', ['13-2011']));
    L.push(cipLine('52.0101', ['13-2011']));
    L.push(cipLine('11.0701', ['15-1252']));
    L.push('');
    const via = (schoolId: string, soc: string) => {
        const s = full.schools.find((x) => x.id === schoolId);
        if (!s) return [];
        return s.majors.filter((m) => m.jobs.includes(soc)).map((m) => `${m.name} (${m.degree}, ${m.cips.join(' + ')})`);
    };
    const kelleyBsb = full.schools.find((s) => s.id === 'kelley')?.majors.find((m) => m.name === 'Accounting' && m.level === 'B');
    if (kelleyBsb) {
        L.push(`Kelley's Accounting major (${kelleyBsb.degree}) is ${kelleyBsb.cips.join(', ')}, ${kelleyBsb.jobs.includes('13-2011') ? 'which the crosswalk links' : 'which the crosswalk does not link'} to 13-2011 Accountants and Auditors.`);
    }
    const kelleyAcct = [...new Set(via('kelley', '13-2011'))];
    L.push(kelleyAcct.length > 0
        ? `The Kelley School still reaches Accountants and Auditors through: ${kelleyAcct.join('; ')}.`
        : 'The Kelley School does not reach Accountants and Auditors.');
    const luddySw = [...new Set(via('luddy', '15-1252'))];
    L.push(luddySw.length > 0
        ? `Luddy reaches 15-1252 Software Developers through: ${luddySw.join('; ')}.`
        : 'Luddy does not reach Software Developers.');
    L.push('');

    L.push('## Gaps');
    L.push('');
    L.push('### Majors with no CIP match');
    L.push('');
    const seen = new Set<string>();
    for (const s of full.schools) {
        const miss = s.majors.filter((m) => m.cips.length === 0);
        if (miss.length === 0) continue;
        L.push(`**${s.name}** (${miss.length} of ${s.majorCount})`);
        L.push('');
        for (const m of miss) {
            const shared = seen.has(m.url) ? ' (also listed above)' : '';
            seen.add(m.url);
            L.push(`- ${m.name}, ${m.degree} (${LEVEL_NAMES[m.level]})${shared}: ${m.reason}`);
        }
        L.push('');
    }
    const partial = full.schools.flatMap((s) => s.majors).filter((m, i, all) => m.cips.length > 0 && m.reason && all.findIndex((x) => x.url === m.url) === i);
    if (partial.length > 0) {
        L.push('Matched, but one of the rule\'s codes was dropped by the level check:');
        L.push('');
        for (const m of partial) L.push(`- ${m.name}, ${m.degree}: kept ${m.cips.join(', ')}; ${m.reason}`);
        L.push('');
    }

    L.push('### Codes confirmed at another IU campus');
    L.push('');
    const elsewhere = full.schools.flatMap((s) => s.majors.filter((m) => m.campusUnitid).map((m) => ({ s, m })));
    if (elsewhere.length === 0) L.push('None.');
    for (const { s, m } of elsewhere) {
        const awards = Object.entries(full.cips[m.cips[0]]?.iubAwards ?? {}).length === 0 ? 'IU Bloomington reports none' : 'IU Bloomington reports some';
        L.push(`- ${m.name}, ${m.degree} (${s.name}): ${m.cips.join(', ')}, as ${campusName(m.campusUnitid!)} (UNITID ${m.campusUnitid}) reports it at ${LEVEL_NAMES[m.level]} level; ${awards}.`);
    }
    L.push('');

    L.push('### CIP codes with no SOC match');
    L.push('');
    const noSoc = Object.entries(full.cips).filter(([, e]) => e.socs.length === 0);
    if (noSoc.length === 0) L.push('None.');
    for (const [cip, e] of noSoc) {
        const users = full.schools.flatMap((s) => s.majors.filter((m) => m.cips.includes(cip)).map((m) => `${m.name} (${s.name})`));
        L.push(`- ${cip} ${e.title} The crosswalk lists it under "Unmatched CIP Codes". Used by: ${[...new Set(users)].join('; ')}.`);
    }
    L.push('');

    L.push('### SOC codes not among the app\'s jobs');
    L.push('');
    const missingSoc = new Map<string, Set<string>>();
    for (const [cip, e] of Object.entries(full.cips)) {
        for (const soc of e.socs) {
            if (e.jobs.includes(soc) || Object.entries(full._meta.socRollup).some(([c, parts]) => parts.includes(soc) && e.jobs.includes(c))) continue;
            const set = missingSoc.get(soc) ?? new Set<string>();
            set.add(cip);
            missingSoc.set(soc, set);
        }
    }
    if (missingSoc.size === 0) L.push('None.');
    else {
        L.push('These come from the crosswalk but the app has no occupation for them (OEWS publishes no estimate for them, as with military and some self-employed occupations), so they cannot be shown:');
        L.push('');
        for (const soc of [...missingSoc.keys()].sort(byCode)) L.push(`- ${soc} ${ctx.xw.socTitle.get(soc) ?? ''} (from ${[...missingSoc.get(soc)!].sort(byCode).join(', ')})`);
    }
    L.push('');

    L.push('### IU Bloomington codes no program was matched to');
    L.push('');
    L.push('Degree-level codes IU Bloomington reports in IPEDS 2023-24 that no program above uses. Their graduates are real, but IU does not publish which program they come from, so they add no jobs to any school:');
    L.push('');
    const degreeLevels = new Set(['3', '5', '7', '17', '18', '19']);
    const unused = [...ctx.ipeds.entries()]
        .filter(([cip, byLevel]) => !full.cips[cip] && [...byLevel.keys()].some((l) => degreeLevels.has(l)))
        .sort((a, b) => byCode(a[0], b[0]));
    for (const [cip, byLevel] of unused) {
        const levels = [...byLevel.entries()].filter(([l]) => degreeLevels.has(l)).sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([l, n]) => `${awlevelName(l)} ${fmt(n)}`).join(', ');
        L.push(`- ${cip} ${ctx.xw.cipTitle.get(cip) ?? ''} (${levels})`);
    }
    L.push('');

    L.push('## Sources');
    L.push('');
    for (const f of full._meta.sources.files) {
        L.push(`- ${f.title}. ${f.publisher}. ${f.url} (retrieved ${f.retrieved}). Committed as \`data/iu_schools/${f.path}\`, sha256 \`${f.sha256}\`.${f.zipSha256 ? ` Cut from ${f.member} in the zip (zip sha256 \`${f.zipSha256}\`, ${f.member} sha256 \`${f.memberSha256}\`); \`npx tsx scripts/build_iu_schools.ts --ipeds-zip <C2024_A.zip>\` re-cuts it.` : ''}${f.seenAt ? ` Seen at ${f.seenAt}.` : ''}`);
    }
    for (const p of full._meta.sources.pages) L.push(`- ${p.title}. ${p.url} (retrieved ${p.retrieved}, sha256 \`${p.sha256}\` at that time).`);
    L.push('');
    return `${L.join('\n')}`;
}

function awlevelName(l: string): string {
    return ({ '3': "associate's", '5': "bachelor's", '7': "master's", '17': 'doctoral (research)', '18': 'doctoral (professional)', '19': 'doctoral (other)' } as Record<string, string>)[l] ?? `level ${l}`;
}

export function serialize(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}
