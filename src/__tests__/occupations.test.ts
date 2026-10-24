/**
 * Guards src/data/occupations/, the all-occupations dataset built by
 * scripts/build_occupations.py from the OEWS May 2025 workbook, the EP
 * 2025–35 Table 1.2 workbook and O*NET 30.1. Phase 1 is data only: the app
 * must not import these files yet.
 *
 * Every value must trace to a cell or line, every null must say why, and the
 * 47 SOCs the site already shows must match the site's own extracts exactly.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import nationalEmployment from '../data/national_employment.json';
import nationalWages from '../data/national_wages.json';
import blsEp from '../data/bls_ep_2025_2035.json';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';

const ROOT = resolve(__dirname, '../..');
const DIR = resolve(ROOT, 'src/data/occupations');
const INDEX_BUDGET_BYTES = 250_000;

type Sources = Record<string, string>;
interface Task { id: number; text: string; type: string; onetCode: string; line: number; alsoIn?: string[] }
interface Ep { title: string; employment2025: number; employment2035: number; numericChange: number; percentChange: number }
interface Entry {
    soc: string; title: string; major: string; minor: string; broad: string | null;
    oewsRows: number[]; oewsOGroups: string[];
    employment: number | null;
    annualMedian: number | null; annualMean: number | null; hourlyMedian: number | null; hourlyMean: number | null;
    annualPct10: number | null; annualPct90: number | null;
    annualOnly: boolean; hourlyOnly: boolean; topcoded: Record<string, boolean>;
    ep: Ep | null;
    onetCode: string | null; onetTaskSource: '.00' | 'sub-codes' | 'none';
    onetSubCodes: { code: string; title: string; taskCount: number }[];
    description: string | null; tasks: Task[]; dedupedTasks: number;
    aiStatus: string; kelleyTracks?: string[]; kelleyTitles?: string[];
    sources: Sources; nullReasons: Record<string, string>;
}
interface Group { soc: string; title: string; employment: number; sources: Sources }
interface Continent extends Group { code: string; file: string; occupationCount: number; minorGroups: (Group & { socs: string[] })[] }
interface IndexRow { soc: string; title: string; minor: string; employment: number | null; annualMedian: number | null; epPercentChange: number | null; taskCount: number; kelleyTracks?: string[] }
interface ContinentFile { _meta: { continent: string }; broadGroups: (Group & { minor: string })[]; occupations: Record<string, Entry> }

const indexText = readFileSync(join(DIR, 'index.json'), 'utf8');
const index = JSON.parse(indexText) as {
    _meta: {
        sources: {
            oews: { file: string; sha256: string; vintage: string };
            ep: { file: string; sha256: string; vintage: string; waybackCapture: string; url: string };
            onet: { dir: string; sha256: Record<string, string>; vintage: string };
        };
        counts: Record<string, number>;
    };
    continents: Continent[];
    occupations: IndexRow[];
};
const files = Object.fromEntries(
    index.continents.map((c) => [c.code, JSON.parse(readFileSync(join(DIR, c.file), 'utf8')) as ContinentFile]),
);
const entries: Entry[] = Object.values(files).flatMap((f) => Object.values(f.occupations));
const bySoc = new Map(entries.map((e) => [e.soc, e]));
const siteSocs = [...new Set(Object.values(MAP_TITLE_TO_SOC))].sort();

const WAGE_FIELDS = ['annualMedian', 'annualMean', 'hourlyMedian', 'hourlyMean', 'annualPct10', 'annualPct90'] as const;
const OEWS_FIELDS = ['employment', ...WAGE_FIELDS, 'annualOnly', 'hourlyOnly', 'title'] as const;
const EP_FIELDS = ['title', 'employment2025', 'employment2035', 'numericChange', 'percentChange'] as const;
const OEWS_REF = /^oews:national_M2025_dl![A-Z]{1,2}\d+$/;
const EP_REF = /^ep:Table 1\.2![A-Z]{1,2}\d+$/;
const ONET_REF = /^onet:Occupation Data\.txt#L\d+:(Description|O\*NET-SOC Code)$/;

const sha256 = (path: string) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');

describe('occupations: structure', () => {
    it('has exactly the 22 BLS SOC major groups, one file each', () => {
        expect(index.continents).toHaveLength(22);
        expect(new Set(index.continents.map((c) => c.code)).size).toBe(22);
        for (const c of index.continents) {
            expect(c.soc).toBe(`${c.code}-0000`);
            expect(c.file).toBe(`${c.code}.json`);
            expect(files[c.code]._meta.continent).toBe(c.soc);
            expect(c.sources.employment).toMatch(OEWS_REF);
        }
        const onDisk = readdirSync(DIR).sort();
        expect(onDisk).toEqual(['index.json', ...index.continents.map((c) => c.file)].sort());
    });

    it('puts every detailed occupation in exactly one continent and one minor group', () => {
        expect(entries).toHaveLength(index.occupations.length);
        expect(bySoc.size).toBe(entries.length);
        const seenMinor = new Map<string, string>();
        for (const c of index.continents) {
            for (const g of c.minorGroups) {
                expect(g.soc.slice(0, 2)).toBe(c.code);
                for (const soc of g.socs) {
                    expect(seenMinor.has(soc), `${soc} listed in two minor groups`).toBe(false);
                    seenMinor.set(soc, g.soc);
                }
            }
            expect(Object.keys(files[c.code].occupations)).toHaveLength(c.occupationCount);
        }
        expect(seenMinor.size).toBe(entries.length);
        for (const e of entries) {
            expect(e.major).toBe(`${e.soc.slice(0, 2)}-0000`);
            expect(files[e.soc.slice(0, 2)].occupations[e.soc]).toBe(e);
            expect(seenMinor.get(e.soc)).toBe(e.minor);
            expect(e.oewsOGroups[0]).toBe('detailed');
        }
    });

    it('keeps the index in step with the continent files', () => {
        for (const row of index.occupations) {
            const e = bySoc.get(row.soc)!;
            expect(row).toEqual({
                soc: e.soc,
                title: e.title,
                minor: e.minor,
                employment: e.employment,
                annualMedian: e.annualMedian,
                epPercentChange: e.ep ? e.ep.percentChange : null,
                taskCount: e.tasks.length,
                ...(e.kelleyTracks ? { kelleyTracks: e.kelleyTracks } : {}),
            });
        }
        const c = index._meta.counts;
        expect(c.occupations).toBe(entries.length);
        expect(c.tasks).toBe(entries.reduce((n, e) => n + e.tasks.length, 0));
    });

    it('stays under the index size budget', () => {
        expect(statSync(join(DIR, 'index.json')).size).toBeLessThan(INDEX_BUDGET_BYTES);
        expect(Buffer.byteLength(indexText)).toBeLessThan(INDEX_BUDGET_BYTES);
    });

    it('has a display label for every continent, kept apart from the BLS title', () => {
        expect(Object.keys(CONTINENT_DISPLAY_NAMES).sort()).toEqual(index.continents.map((c) => c.code).sort());
    });
});

describe('occupations: the 47 SOCs the site already shows', () => {
    it('match national_employment.json exactly', () => {
        expect(siteSocs).toHaveLength(47);
        const emp = nationalEmployment as unknown as Record<string, { employment: number }>;
        for (const soc of siteSocs) expect(bySoc.get(soc)?.employment, soc).toBe(emp[soc].employment);
    });

    it('match national_wages.json exactly, nulls and flags included', () => {
        const wages = nationalWages as unknown as Record<string, Record<string, unknown> & { source: { rows: number[] } }>;
        for (const soc of siteSocs) {
            const e = bySoc.get(soc)!;
            const w = wages[soc];
            for (const m of WAGE_FIELDS) expect(e[m], `${soc} ${m}`).toBe(w[m]);
            expect(e.annualOnly).toBe(w.annualOnly);
            expect(e.hourlyOnly).toBe(w.hourlyOnly);
            expect(e.title).toBe(w.occTitle);
            expect([...e.oewsRows].sort()).toEqual([...w.source.rows].sort());
        }
    });

    it('match bls_ep_2025_2035.json exactly (same Wayback workbook)', () => {
        const ep = (blsEp as unknown as { by_soc: Record<string, Record<string, number | string>> }).by_soc;
        expect(Object.keys(ep).sort()).toEqual(siteSocs);
        for (const soc of siteSocs) {
            const e = bySoc.get(soc)!.ep!;
            expect(e.employment2025, soc).toBe(ep[soc].employment_2025);
            expect(e.employment2035, soc).toBe(ep[soc].employment_2035);
            expect(e.numericChange, soc).toBe(ep[soc].numeric_change);
            expect(e.percentChange, soc).toBe(ep[soc].percent_change);
            expect(e.title, soc).toBe(ep[soc].bls_title);
        }
        expect(index._meta.sources.ep.waybackCapture).toBe(blsEp._meta.wayback_capture);
        expect(index._meta.sources.ep.url).toBe(`https://${blsEp._meta.workbook}`);
    });

    it('tag every Kelley title on its site SOC', () => {
        const tagged = entries.filter((e) => e.kelleyTracks);
        expect(tagged.map((e) => e.soc).sort()).toEqual(siteSocs);
        const titles = tagged.flatMap((e) => e.kelleyTitles!).sort();
        expect(titles).toEqual(Object.keys(MAP_TITLE_TO_SOC).sort());
        for (const e of tagged) {
            expect(e.kelleyTracks!.length).toBeGreaterThan(0);
            for (const t of e.kelleyTitles!) expect(MAP_TITLE_TO_SOC[t]).toBe(e.soc);
        }
    });
});

describe('occupations: provenance', () => {
    it('stores hashes that match the committed source files', () => {
        const s = index._meta.sources;
        expect(sha256(s.oews.file)).toBe(s.oews.sha256);
        expect(sha256(s.ep.file)).toBe(s.ep.sha256);
        for (const [name, hash] of Object.entries(s.onet.sha256)) expect(sha256(join(s.onet.dir, name))).toBe(hash);
        expect(s.oews.vintage).toBe('OEWS May 2025');
        expect(s.ep.vintage).toBe('2025–2035');
        expect(s.onet.vintage).toBe('O*NET 30.1');
    });

    it('gives every null a reason', () => {
        for (const e of entries) {
            for (const f of ['employment', ...WAGE_FIELDS, 'broad', 'description', 'onetCode'] as const) {
                if (e[f] === null) expect(e.nullReasons[f], `${e.soc} ${f}`).toBeTruthy();
            }
            if (e.ep === null) expect(e.nullReasons.ep, `${e.soc} ep`).toBeTruthy();
            if (e.tasks.length === 0) expect(e.nullReasons.tasks, `${e.soc} tasks`).toBeTruthy();
            for (const reason of Object.values(e.nullReasons)) expect(reason.length).toBeGreaterThan(10);
        }
        for (const row of index.occupations) {
            const e = bySoc.get(row.soc)!;
            if (row.employment === null) expect(e.nullReasons.employment).toBeTruthy();
            if (row.annualMedian === null) expect(e.nullReasons.annualMedian).toBeTruthy();
            if (row.epPercentChange === null) expect(e.nullReasons.ep).toBeTruthy();
        }
    });

    it('gives every value a source cell or line', () => {
        for (const e of entries) {
            for (const f of OEWS_FIELDS) {
                expect(e.sources[f], `${e.soc} ${f}`).toMatch(OEWS_REF);
                expect(e.sources[f].endsWith(String(e.oewsRows[0]))).toBe(true);
            }
            if (e.ep) for (const f of EP_FIELDS) expect(e.sources[`ep.${f}`], `${e.soc} ep.${f}`).toMatch(EP_REF);
            if (e.description !== null) expect(e.sources.description).toMatch(ONET_REF);
            if (e.onetCode !== null) expect(e.sources.onetCode).toMatch(ONET_REF);
            for (const t of e.tasks) {
                expect(Number.isInteger(t.line) && t.line > 1, `${e.soc} task ${t.id}`).toBe(true);
                expect(t.onetCode.slice(0, 7)).toBe(e.soc);
                expect(t.text.length).toBeGreaterThan(0);
            }
        }
        for (const c of index.continents) {
            for (const g of [...c.minorGroups, ...files[c.code].broadGroups]) {
                expect(g.sources.employment).toMatch(OEWS_REF);
                expect(g.sources.title).toMatch(OEWS_REF);
            }
        }
    });

    it('follows the O*NET task rule', () => {
        for (const e of entries) {
            const codes = new Set(e.tasks.map((t) => t.onetCode));
            if (e.onetTaskSource === '.00') expect([...codes]).toEqual([`${e.soc}.00`]);
            if (e.onetTaskSource === 'sub-codes') {
                expect(codes.has(`${e.soc}.00`)).toBe(false);
                const texts = e.tasks.map((t) => t.text);
                expect(new Set(texts).size).toBe(texts.length);
            }
            if (e.onetTaskSource === 'none') expect(e.tasks).toEqual([]);
        }
    });

    it('carries no AI scores', () => {
        for (const e of entries) {
            expect(e.aiStatus).toBe('not yet scored');
            expect(Object.keys(e).filter((k) => /score|exposure|automation/i.test(k))).toEqual([]);
        }
    });

    it('is not imported by the app (phase 1 is data only)', () => {
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name);
                if (statSync(p).isDirectory()) {
                    if (name !== '__tests__') walk(p);
                } else if (
                    /\.(ts|tsx|js|jsx)$/.test(name) &&
                    /(from\s*|import\s*\(\s*|import\s+)['"][^'"]*(data\/occupations|config\/continents)/.test(readFileSync(p, 'utf8'))
                ) {
                    offenders.push(p);
                }
            }
        };
        walk(resolve(ROOT, 'src'));
        expect(offenders).toEqual([]);
    });
});
