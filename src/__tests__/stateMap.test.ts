/**
 * The state map's data (scripts/build_state_map.ts, docs/state-map.md): every
 * committed output is exactly what the pinned BLS OEWS May 2025 state file
 * builds; spot checks and a full cell-by-cell check read the raw workbook
 * here, on their own, not through the build's parser; hidden cells ("**") and
 * missing rows are left out, never guessed; the Kelley codes match the earlier
 * BLS-API data except for the documented changes; --check fails on stale files.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import {
    buildStateMap,
    compareRows,
    EARLIER_FILE,
    loadStateMapInputs,
    outputFiles,
    sha256,
    staleOutputs,
    STATE_MAP_PATHS,
    WORKBOOK_FILE,
    type GeoRow,
} from '../../scripts/lib/stateMap';
import { ONET_CODES_FOR_SOC } from '../config/onetSplitCodes';
import { KELLEY_SOC_SET } from '../utils/kelleySocs';
import { OCCUPATION_INDEX } from '../utils/occupationIndex';

const ROOT = path.resolve(__dirname, '../..');
const inputs = loadStateMapInputs(ROOT);
const built = buildStateMap(inputs);

// ── The raw workbook, read here with nothing from the build ──
const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    XLSX.read(fs.readFileSync(path.join(ROOT, 'data/oews_state', WORKBOOK_FILE)), { type: 'buffer' }).Sheets['state_M2025_dl'],
    { raw: true, defval: null },
);
const rawCell = new Map<string, Record<string, unknown>>();
for (const r of rawRows) if (r.O_GROUP === 'detailed') rawCell.set(`${r.OCC_CODE}|${r.AREA}`, r);
const raw = (soc: string, area: string) => rawCell.get(`${soc}|${area}`);

type Chunk = { socs: Record<string, [string, number, number][]> };
const chunk = (field: string): Chunk => JSON.parse(fs.readFileSync(path.join(ROOT, STATE_MAP_PATHS.fieldDir, `${field}.json`), 'utf-8'));
const chunkRows = (soc: string) => chunk(soc.slice(0, 2)).socs[soc];
const row = (soc: string, area: string) => chunkRows(soc).find(([a]) => a === area);
const geoReal = JSON.parse(fs.readFileSync(path.join(ROOT, STATE_MAP_PATHS.geoReal), 'utf-8')) as Record<string, GeoRow[]>;
const areas = inputs.areas;

describe('the build', () => {
    it('writes exactly the committed files, and the same bytes every time', () => {
        const again = outputFiles(buildStateMap(loadStateMapInputs(ROOT)));
        expect(again).toEqual(outputFiles(built));
        expect(staleOutputs(ROOT, built)).toEqual([]);
        // 22 field chunks + geo_real.json + areas.json + the report.
        expect(outputFiles(built)).toHaveLength(25);
    }, 30_000);

    it('--check passes on the committed files and fails when one is stale', () => {
        expect(() => execFileSync('npx', ['tsx', 'scripts/build_state_map.ts', '--check'], { cwd: ROOT, stdio: 'pipe' })).not.toThrow();
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-map-'));
        try {
            for (const [rel, body] of outputFiles(built)) {
                fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
                fs.writeFileSync(path.join(tmp, rel), body);
            }
            expect(staleOutputs(tmp, built)).toEqual([]);
            const rn = path.join(tmp, STATE_MAP_PATHS.fieldDir, '29.json');
            fs.writeFileSync(rn, fs.readFileSync(rn, 'utf-8').replace('["06",338940,0.86]', '["06",338950,0.86]'));
            fs.rmSync(path.join(tmp, STATE_MAP_PATHS.report));
            expect(staleOutputs(tmp, built)).toEqual([STATE_MAP_PATHS.report, `${STATE_MAP_PATHS.fieldDir}/29.json`]);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }, 30_000);

    it('checks every input against the sha256 in sources.json, and pins the BLS zip', () => {
        for (const f of inputs.sources.files) {
            expect(sha256(fs.readFileSync(path.join(ROOT, 'data/oews_state', f.path))), f.path).toBe(f.sha256);
            expect(f.url).toMatch(/^https:\/\//);
            expect(f.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        const bls = inputs.sources.files.find((f) => f.path === WORKBOOK_FILE)!;
        expect(bls.url).toBe('https://www.bls.gov/oes/special-requests/oesm25st.zip');
        expect(bls.zipSha256).toBe('74d5be0e1df865517d22dc3bd1fc3a8af5f6f9e3052a2163143021505d8e04c6');
        expect(fs.readFileSync(path.join(ROOT, STATE_MAP_PATHS.report), 'utf-8')).toContain(bls.zipSha256!);
    });
});

describe('spot checks, read straight from the raw BLS workbook', () => {
    it('Registered Nurses in California', () => {
        expect(raw('29-1141', '06')).toMatchObject({ AREA_TITLE: 'California', OCC_TITLE: 'Registered Nurses', TOT_EMP: 338940, LOC_QUOTIENT: 0.86 });
        expect(row('29-1141', '06')).toEqual(['06', 338940, 0.86]);
    });

    it('Software Developers in Washington (a Kelley code: its geo_real.json row too)', () => {
        expect(raw('15-1252', '53')).toMatchObject({ AREA_TITLE: 'Washington', OCC_TITLE: 'Software Developers', TOT_EMP: 107030, LOC_QUOTIENT: 2.78 });
        expect(row('15-1252', '53')).toEqual(['53', 107030, 2.78]);
        expect(geoReal['15-1252'].find((r) => r.name === 'Washington')).toMatchObject({ employment: 107030, lq: 2.78 });
    });

    it('Counselors, All Other (not Kelley, not scored): published, hidden and unlisted states', () => {
        expect(raw('21-1019', '06')).toMatchObject({ OCC_TITLE: 'Counselors, All Other', TOT_EMP: 10770, LOC_QUOTIENT: 3.22 });
        expect(row('21-1019', '06')).toEqual(['06', 10770, 3.22]);
        expect(raw('21-1019', '18')).toMatchObject({ TOT_EMP: 70, LOC_QUOTIENT: 0.12 });
        expect(row('21-1019', '18')).toEqual(['18', 70, 0.12]);
        // Nebraska is "**" in the file, Idaho has no row: both left out.
        expect(raw('21-1019', '31')).toMatchObject({ TOT_EMP: '**', LOC_QUOTIENT: '**' });
        expect(row('21-1019', '31')).toBeUndefined();
        expect(raw('21-1019', '16')).toBeUndefined();
        expect(row('21-1019', '16')).toBeUndefined();
    });

    it('a combined code, 21-1018, uses its own published rows', () => {
        expect(ONET_CODES_FOR_SOC['21-1018']).toBeDefined();
        expect(raw('21-1018', '18')).toMatchObject({ OCC_TITLE: 'Substance Abuse, Behavioral Disorder, and Mental Health Counselors', TOT_EMP: 11890, LOC_QUOTIENT: 1.17 });
        expect(row('21-1018', '18')).toEqual(['18', 11890, 1.17]);
    });

    it('every one of the 12 combined codes is published in the state file under its own code', () => {
        for (const soc of Object.keys(ONET_CODES_FOR_SOC)) {
            const published = areas.filter((a) => typeof raw(soc, a.code)?.TOT_EMP === 'number').length;
            expect(published, soc).toBeGreaterThan(0);
            expect(chunkRows(soc), soc).toHaveLength(published);
        }
    });
});

describe('every cell, against the raw workbook', () => {
    it('has a row exactly where BLS publishes a number, with its TOT_EMP and LOC_QUOTIENT', () => {
        let published = 0;
        let hidden = 0;
        let absent = 0;
        for (const occ of OCCUPATION_INDEX.occupations) {
            const rows = chunkRows(occ.soc);
            expect(rows, occ.soc).toBeDefined();
            for (const a of areas) {
                const r = raw(occ.soc, a.code);
                const got = rows.find(([code]) => code === a.code);
                if (!r) {
                    absent++;
                    expect(got, `${occ.soc} ${a.name}`).toBeUndefined();
                } else if (r.TOT_EMP === '**') {
                    hidden++;
                    expect(r.LOC_QUOTIENT).toBe('**');
                    expect(got, `${occ.soc} ${a.name}`).toBeUndefined();
                } else {
                    published++;
                    expect(got, `${occ.soc} ${a.name}`).toEqual([a.code, r.TOT_EMP, r.LOC_QUOTIENT]);
                }
            }
        }
        expect([published, hidden, absent]).toEqual([34850, 1318, 8652]);
        expect(published + hidden + absent).toBe(830 * 54);
    });

    it('orders rows by employment, ties by state name A to Z', () => {
        const name = new Map(areas.map((a) => [a.code, a.name]));
        for (const occ of OCCUPATION_INDEX.occupations) {
            const rows = chunkRows(occ.soc).map(([code, employment]) => ({ name: name.get(code)!, employment }));
            expect(rows, occ.soc).toEqual([...rows].sort(compareRows));
        }
    });

    it('covers the same 54 areas as before: the 50 states, DC, Guam, Puerto Rico and the Virgin Islands', () => {
        const earlier = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/oews_state', EARLIER_FILE), 'utf-8')) as Record<string, GeoRow[]>;
        const earlierNames = new Set(Object.entries(earlier).filter(([k]) => k !== '_meta').flatMap(([, rows]) => rows.map((r) => r.name)));
        expect(new Set(areas.map((a) => a.name))).toEqual(earlierNames);
        expect(areas).toHaveLength(54);
    });
});

describe('coverage', () => {
    it('98 jobs have a full map, 727 have some areas hidden, 5 have no state data', () => {
        expect(built.counts).toMatchObject({ jobs: 830, full: 98, partial: 727, none: 5 });
        const none = built.socs.filter((s) => s.status === 'none').map((s) => s.soc);
        expect(none).toEqual(['13-1074', '29-1024', '51-2061', '51-7031', '51-7032']);
        for (const soc of none) expect(chunkRows(soc), soc).toEqual([]);
        // Prosthodontists has no row at all; the others are "**" wherever they are listed.
        expect(areas.some((a) => raw('29-1024', a.code))).toBe(false);
        expect(areas.filter((a) => raw('13-1074', a.code)).every((a) => raw('13-1074', a.code)!.TOT_EMP === '**')).toBe(true);
    });

    it('the report states the counts and lists the jobs with no state data', () => {
        const report = fs.readFileSync(path.join(ROOT, STATE_MAP_PATHS.report), 'utf-8');
        expect(report).toContain('| Full map: BLS publishes the job in all 54 areas | 98 |');
        expect(report).toContain('| No state data at all | 5 |');
        expect(report).toContain('29-1024 Prosthodontists');
    });
});

describe('the Kelley codes', () => {
    const earlier = inputs.earlier as Record<string, GeoRow[]>;

    it('geo_real.json holds exactly the Kelley codes, row for row the same as their field chunk', () => {
        expect(Object.keys(geoReal).filter((k) => k !== '_meta').sort()).toEqual([...KELLEY_SOC_SET].sort());
        const byCode = new Map(areas.map((a) => [a.code, a]));
        for (const soc of KELLEY_SOC_SET) {
            const fromChunk = chunkRows(soc).map(([code, employment, lq]) => {
                const a = byCode.get(code)!;
                return { name: a.name, lat: a.lat, lng: a.lng, employment, lq };
            });
            expect(geoReal[soc], soc).toEqual(fromChunk);
        }
    });

    it('proof step: same states and employment as the earlier BLS-API data; only the documented changes', () => {
        let rows = 0;
        const lq: string[] = [];
        for (const soc of KELLEY_SOC_SET) {
            const was = earlier[soc];
            const now = geoReal[soc];
            rows += now.length;
            // Same rows once ties are put in one order: only LQ may differ.
            const key = (r: GeoRow) => `${r.name}|${r.employment}|${r.lat}|${r.lng}`;
            expect(now.map(key).sort(), soc).toEqual(was.map(key).sort());
            // The order differs only inside groups of equal employment.
            expect(now.map((r) => r.employment), soc).toEqual(was.map((r) => r.employment));
            for (const r of now) {
                const old = was.find((w) => w.name === r.name)!;
                if (old.lq !== r.lq) lq.push(`${soc} ${r.name} ${old.lq} -> ${r.lq}`);
            }
        }
        expect(rows).toBe(2411);
        expect(lq).toEqual(['13-2053 Nebraska 2.03 -> 2.04']);
        expect(raw('13-2053', '31')).toMatchObject({ TOT_EMP: 1410, LOC_QUOTIENT: 2.04 });
    });

    it('lists every change in the report: the LQ, the one visible label, and 22 tie re-orders', () => {
        const c = built.kelleyChanges;
        expect(c).toHaveLength(22);
        expect(c.every((x) => x.reorders.length > 0 && x.employment.length === 0 && x.added.length === 0 && x.dropped.length === 0)).toBe(true);
        expect(c.filter((x) => x.markers).map((x) => [x.soc, x.markers])).toEqual([['15-2031', [['Ohio'], ['Arizona']]]]);
        const report = fs.readFileSync(path.join(ROOT, STATE_MAP_PATHS.report), 'utf-8');
        expect(report).toContain('## Changes from the earlier Kelley data');
        expect(report).toContain('**Insurance Underwriters (13-2053), Nebraska**: location quotient 2.03 -> 2.04');
        expect(report).toContain('its 15th circle label is now Arizona instead of Ohio');
        expect(report).toContain('**Tie order** (22 codes)');
    });
});
