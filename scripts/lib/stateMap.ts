/**
 * The state map's data, built from one official file: the BLS OEWS May 2025
 * state workbook (data/oews_state/state_M2025_dl.xlsx, from oesm25st.zip,
 * sha256-pinned in data/oews_state/sources.json). Pure: no network, no Vite,
 * no Claude. scripts/build_state_map.ts writes the outputs; stateMap.test.ts
 * re-reads the workbook on its own and checks them.
 *
 *   src/data/geo_real.json           the Kelley SOCs, in the format the map has always read
 *   src/data/state_map/<field>.json  every one of the 830 SOCs, one lazy chunk per field
 *   src/data/state_map/areas.json    the 54 areas and their display centroids (bundled, small)
 *   docs/state-map.md                coverage report, the check against the earlier Kelley data
 *
 * Method, the same for every job (it is the method geo_real.json always used,
 * now read from the file instead of the BLS API):
 *   - rows: AREA_TYPE 2 (state) or 3 (territory), cross-industry (NAICS
 *     000000, OWN_CODE 1235), O_GROUP "detailed", OCC_CODE = the app's SOC;
 *   - employment = TOT_EMP, location quotient = LOC_QUOTIENT, as published;
 *   - a cell BLS marks "**" ("an employment estimate is not available") or an
 *     area with no row for the SOC is left out: the map shows that state as
 *     having no data. Nothing is estimated, carried over or split;
 *   - rows are ordered by employment, largest first, ties by area name A to Z.
 * Any other cell value (a blank, a "*", a number with no LQ) stops the build.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { ONET_CODES_FOR_SOC } from '../../src/config/onetSplitCodes';
import { KELLEY_SOC_SET } from '../../src/utils/kelleySocs';

export const STATE_MAP_PATHS = {
    dir: 'data/oews_state',
    sources: 'data/oews_state/sources.json',
    geoReal: 'src/data/geo_real.json',
    fieldDir: 'src/data/state_map',
    areas: 'src/data/state_map/areas.json',
    report: 'docs/state-map.md',
    occupationsIndex: 'src/data/occupations/index.json',
} as const;

export const WORKBOOK_FILE = 'state_M2025_dl.xlsx';
export const CENTROIDS_FILE = 'area_centroids.json';
export const EARLIER_FILE = 'earlier_geo_real_bls_api.json';

/** BLS's own words for the one symbol that hides an employment cell (the workbook's Field Descriptions sheet). */
export const HIDDEN = '**';

export const sha256 = (buf: Buffer | Uint8Array | string): string => crypto.createHash('sha256').update(buf).digest('hex');

export interface SourceFile {
    path: string;
    title: string;
    publisher: string;
    url: string;
    seenAt?: string;
    retrieved: string;
    zipSha256?: string;
    member?: string;
    sha256: string;
    sheet?: string;
}

export interface SourcesManifest {
    _about: string;
    files: SourceFile[];
}

export interface Area {
    code: string;
    name: string;
    lat: number;
    lng: number;
}

/** The earlier geo_real.json shape (and the one this build still writes for the Kelley SOCs). */
export interface GeoRow {
    name: string;
    lat: number;
    lng: number;
    employment: number;
    lq: number;
}

export interface StateMapInputs {
    sources: SourcesManifest;
    workbook: Buffer;
    areas: Area[];
    earlier: Record<string, GeoRow[] | Record<string, unknown>>;
    /** The 830 BLS occupations of the app, in SOC order. */
    occupations: { soc: string; title: string }[];
    /** The distinct SOCs of the 50 Kelley titles (src/utils/kelleySocs, as the app reads them). */
    kelleySocs: string[];
}

/** One published cell pair, as it stands in the workbook. */
export interface Cell {
    /** TOT_EMP, or null where BLS shows "**". */
    employment: number | null;
    /** LOC_QUOTIENT, or null where BLS shows "**". */
    lq: number | null;
    /** 1-based worksheet row, for the report and the tests. */
    row: number;
}

export interface ParsedWorkbook {
    /** OEWS AREA code -> AREA_TITLE, as listed in the file. */
    areaTitles: Map<string, string>;
    /** SOC -> AREA -> cell, detailed rows only. */
    cells: Map<string, Map<string, Cell>>;
    /** SOC -> OCC_TITLE. */
    titles: Map<string, string>;
    /** The workbook's own notes on its symbols (Field Descriptions sheet). */
    notes: string[];
    detailedRows: number;
}

const REQUIRED_COLUMNS = ['AREA', 'AREA_TITLE', 'AREA_TYPE', 'NAICS', 'I_GROUP', 'OWN_CODE', 'OCC_CODE', 'OCC_TITLE', 'O_GROUP', 'TOT_EMP', 'LOC_QUOTIENT'] as const;

export function loadStateMapInputs(root: string): StateMapInputs {
    const sources = JSON.parse(fs.readFileSync(path.join(root, STATE_MAP_PATHS.sources), 'utf-8')) as SourcesManifest;
    const file = (name: string): Buffer => {
        const entry = sources.files.find((f) => f.path === name);
        if (!entry) throw new Error(`sources.json has no entry for ${name}`);
        const buf = fs.readFileSync(path.join(root, STATE_MAP_PATHS.dir, name));
        const got = sha256(buf);
        if (got !== entry.sha256) throw new Error(`${name}: sha256 ${got} is not the recorded ${entry.sha256}`);
        return buf;
    };
    const centroids = JSON.parse(file(CENTROIDS_FILE).toString('utf-8')) as { areas: Area[] };
    const index = JSON.parse(fs.readFileSync(path.join(root, STATE_MAP_PATHS.occupationsIndex), 'utf-8')) as {
        occupations: { soc: string; title: string }[];
    };
    return {
        sources,
        workbook: file(WORKBOOK_FILE),
        areas: centroids.areas,
        earlier: JSON.parse(file(EARLIER_FILE).toString('utf-8')),
        occupations: index.occupations.map((o) => ({ soc: o.soc, title: o.title })),
        kelleySocs: [...KELLEY_SOC_SET].sort(),
    };
}

const cellText = (v: unknown): string => (v == null ? '' : String(v));

/**
 * Reads the workbook's main sheet. Every row must be a state or territory,
 * cross-industry, all ownerships; employment and LQ must both be numbers or
 * both be "**". Anything else throws.
 */
export function parseStateWorkbook(buf: Buffer | Uint8Array): ParsedWorkbook {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets['state_M2025_dl'];
    if (!ws) throw new Error('workbook has no state_M2025_dl sheet');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    const header = rows[0].map(cellText);
    const col: Record<string, number> = {};
    for (const name of REQUIRED_COLUMNS) {
        const i = header.indexOf(name);
        if (i < 0) throw new Error(`workbook has no ${name} column`);
        col[name] = i;
    }
    const areaTitles = new Map<string, string>();
    const cells = new Map<string, Map<string, Cell>>();
    const titles = new Map<string, string>();
    let detailedRows = 0;
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const at = (name: string) => row[col[name]];
        const where = `worksheet row ${r + 1}`;
        const areaType = cellText(at('AREA_TYPE'));
        if (areaType !== '2' && areaType !== '3') throw new Error(`${where}: AREA_TYPE ${areaType} is not a state or territory`);
        if (cellText(at('NAICS')) !== '000000' || cellText(at('I_GROUP')) !== 'cross-industry' || cellText(at('OWN_CODE')) !== '1235') {
            throw new Error(`${where}: not a cross-industry, all-ownership row`);
        }
        const area = cellText(at('AREA'));
        areaTitles.set(area, cellText(at('AREA_TITLE')));
        if (at('O_GROUP') !== 'detailed') continue;
        detailedRows++;
        const soc = cellText(at('OCC_CODE'));
        const emp = at('TOT_EMP');
        const lq = at('LOC_QUOTIENT');
        let cell: Cell;
        if (typeof emp === 'number' && typeof lq === 'number') {
            if (!(emp > 0) || !(lq >= 0)) throw new Error(`${where}: ${soc} ${area} has employment ${emp}, LQ ${lq}`);
            cell = { employment: emp, lq, row: r + 1 };
        } else if (emp === HIDDEN && lq === HIDDEN) {
            cell = { employment: null, lq: null, row: r + 1 };
        } else {
            throw new Error(`${where}: ${soc} ${area} has TOT_EMP ${JSON.stringify(emp)} and LOC_QUOTIENT ${JSON.stringify(lq)}, which this build has no rule for`);
        }
        let bySoc = cells.get(soc);
        if (!bySoc) cells.set(soc, (bySoc = new Map()));
        if (bySoc.has(area)) throw new Error(`${where}: ${soc} ${area} is listed twice`);
        bySoc.set(area, cell);
        titles.set(soc, cellText(at('OCC_TITLE')));
    }
    const notesSheet = wb.Sheets['Field Descriptions'];
    const notes = notesSheet
        ? (XLSX.utils.sheet_to_json<unknown[]>(notesSheet, { header: 1, raw: true, defval: null }) as unknown[][])
            .map((r) => cellText(r[0]).trim())
            .filter((t) => /^(\*|#|~)/.test(t))
        : [];
    return { areaTitles, cells, titles, notes, detailedRows };
}

/** Largest employment first; ties by area name, A to Z (plain code-unit order, all names are ASCII). */
export function compareRows(a: { name: string; employment: number }, b: { name: string; employment: number }): number {
    return b.employment - a.employment || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export type SocStatus = 'full' | 'partial' | 'none';

export interface SocStateData {
    soc: string;
    title: string;
    /** Published areas, ordered by compareRows. */
    rows: (GeoRow & { code: string })[];
    /** Areas BLS lists with "**". */
    hidden: string[];
    /** Areas with no row for this SOC in the file. */
    absent: string[];
    status: SocStatus;
    /** True when the SOC has no detailed row anywhere in the file. */
    notInFile: boolean;
}

/** The map rows of one SOC, by the method in the header. */
export function socStateData(parsed: ParsedWorkbook, areas: readonly Area[], soc: string, title: string): SocStateData {
    const bySoc = parsed.cells.get(soc);
    const rows: SocStateData['rows'] = [];
    const hidden: string[] = [];
    const absent: string[] = [];
    for (const a of areas) {
        const cell = bySoc?.get(a.code);
        if (!cell) absent.push(a.code);
        else if (cell.employment == null || cell.lq == null) hidden.push(a.code);
        else rows.push({ code: a.code, name: a.name, lat: a.lat, lng: a.lng, employment: cell.employment, lq: cell.lq });
    }
    rows.sort(compareRows);
    const status: SocStatus = rows.length === areas.length ? 'full' : rows.length === 0 ? 'none' : 'partial';
    return { soc, title, rows, hidden, absent, status, notInFile: !bySoc };
}

/** One field's lazy chunk: SOC -> [area code, employment, location quotient][], published cells only. */
export interface StateMapField {
    _meta: { field: string; source: string; rows: string };
    socs: Record<string, [string, number, number][]>;
}

export interface AreasFile {
    _meta: { source: string; note: string };
    areas: Area[];
    /** Coverage counts for the app's text (bundled; the rows themselves are lazy). */
    coverage: { jobs: number; full: number; partial: number; none: number; noStateData: string[] };
}

export interface GeoRealFile {
    _meta: Record<string, string | number>;
    [soc: string]: GeoRow[] | Record<string, string | number>;
}

/** A Kelley SOC whose rows differ from the earlier (BLS API) geo_real.json. */
export interface KelleyChange {
    soc: string;
    title: string;
    /** Areas where LQ differs: [area, earlier, now]. */
    lq: [string, number, number][];
    /** Areas where employment differs: [area, earlier, now]. */
    employment: [string, number, number][];
    /** Areas added or dropped. */
    added: string[];
    dropped: string[];
    /** Tied rows (same employment) listed in another order: [employment, earlier names, names now]. */
    reorders: [number, string[], string[]][];
    /** Top-15 marker states that changed: [earlier only, now only]. */
    markers: [string[], string[]] | null;
}

export interface StateMapBuild {
    geoReal: GeoRealFile;
    fields: Map<string, StateMapField>;
    areasFile: AreasFile;
    report: string;
    socs: SocStateData[];
    kelleyChanges: KelleyChange[];
    counts: {
        jobs: number;
        full: number;
        partial: number;
        none: number;
        fullStates: number;
        publishedCells: number;
        hiddenCells: number;
        absentCells: number;
        kelleySocs: number;
        kelleyRows: number;
    };
}

/** The map draws circle labels on its top 15 states (MapView MARKER_CAP). */
export const MARKER_CAP = 15;

const SOURCE_LINE = 'BLS OEWS May 2025, state file (oesm25st.zip, data/oews_state/state_M2025_dl.xlsx)';

export function buildStateMap(inputs: StateMapInputs): StateMapBuild {
    const parsed = parseStateWorkbook(inputs.workbook);
    const src = inputs.sources.files.find((f) => f.path === WORKBOOK_FILE)!;

    // The map covers exactly the areas the earlier data covered: the file's 54, by code and name.
    const fileAreas = [...parsed.areaTitles.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    if (fileAreas.length !== inputs.areas.length || fileAreas.some(([code, name], i) => inputs.areas[i].code !== code || inputs.areas[i].name !== name)) {
        throw new Error('area_centroids.json does not list exactly the areas of the state file');
    }

    // Every app SOC must be the file's own code or absent; the file must hold no detailed code the app lacks.
    const appSocs = new Set(inputs.occupations.map((o) => o.soc));
    const extra = [...parsed.cells.keys()].filter((s) => !appSocs.has(s));
    if (extra.length) throw new Error(`state file has detailed codes the app does not: ${extra.join(', ')}`);

    const socs = inputs.occupations.map((o) => socStateData(parsed, inputs.areas, o.soc, o.title));
    const bySoc = new Map(socs.map((s) => [s.soc, s]));

    // ── per-field chunks ──
    const fields = new Map<string, StateMapField>();
    for (const s of socs) {
        const code = s.soc.slice(0, 2);
        let f = fields.get(code);
        if (!f) {
            f = {
                _meta: {
                    field: code,
                    source: SOURCE_LINE,
                    rows: 'SOC -> [area code, TOT_EMP, LOC_QUOTIENT] for every area BLS publishes, largest employment first, ties by area name A to Z. An area BLS hides ("**") or does not list is left out; an empty list means BLS publishes no state data for the job. Built by scripts/build_state_map.ts.',
                },
                socs: {},
            };
            fields.set(code, f);
        }
        f.socs[s.soc] = s.rows.map((r) => [r.code, r.employment, r.lq]);
    }

    // ── geo_real.json: the Kelley SOCs, same row format as always ──
    const geoReal: GeoRealFile = {
        _meta: {
            source: 'BLS Occupational Employment and Wage Statistics (OEWS), May 2025',
            source_file: `${src.url} (${src.member}, sheet ${src.sheet})`,
            source_sha256: `zip ${src.zipSha256}, workbook ${src.sha256}`,
            bls_release: 'OEWS May 2025',
            retrieved: src.retrieved,
            extracted: src.retrieved,
            soc_count: inputs.kelleySocs.length,
            note_coordinates: 'lat/lng values are US Census Bureau geographic centroids (display-only). They are NOT part of BLS data.',
            note_employment: 'employment = TOT_EMP and lq = LOC_QUOTIENT (cross-industry, detailed occupation, state and territory rows). An area BLS marks "**" (employment estimate not available) or does not list is left out. Rows: largest employment first, ties by state name A to Z.',
            note_soc_codes: 'The Kelley SOCs (src/utils/kelleySocs.ts). Some titles share a SOC (e.g. Marketing Manager and Brand Manager both map to 11-2021). The map aggregation layer de-dupes by SOC. Every other occupation\'s rows are in src/data/state_map/, built the same way.',
            note_refresh: 'Regenerate with: npx tsx scripts/build_state_map.ts',
        },
    };
    let kelleyRows = 0;
    for (const soc of inputs.kelleySocs) {
        const s = bySoc.get(soc);
        if (!s) throw new Error(`Kelley SOC ${soc} is not one of the app's occupations`);
        geoReal[soc] = s.rows.map(({ name, lat, lng, employment, lq }) => ({ name, lat, lng, employment, lq }));
        kelleyRows += s.rows.length;
    }

    const kelleyChanges = compareWithEarlier(inputs, geoReal, bySoc);

    let hiddenCells = 0;
    let absentCells = 0;
    let publishedCells = 0;
    for (const s of socs) {
        hiddenCells += s.hidden.length;
        absentCells += s.absent.length;
        publishedCells += s.rows.length;
    }
    const stateCodes = inputs.areas.filter((a) => Number(a.code) <= 56).map((a) => a.code);
    const counts = {
        jobs: socs.length,
        full: socs.filter((s) => s.status === 'full').length,
        partial: socs.filter((s) => s.status === 'partial').length,
        none: socs.filter((s) => s.status === 'none').length,
        fullStates: socs.filter((s) => stateCodes.every((c) => s.rows.some((r) => r.code === c))).length,
        publishedCells,
        hiddenCells,
        absentCells,
        kelleySocs: inputs.kelleySocs.length,
        kelleyRows,
    };

    const areasFile: AreasFile = {
        _meta: {
            source: 'The 54 areas of the BLS OEWS May 2025 state file (OEWS AREA code and AREA_TITLE), and the coverage counts of docs/state-map.md.',
            note: 'lat/lng are US Census Bureau geographic centroids, display only, NOT BLS data (the values the map has always used).',
        },
        areas: inputs.areas,
        coverage: {
            jobs: counts.jobs,
            full: counts.full,
            partial: counts.partial,
            none: counts.none,
            noStateData: socs.filter((s) => s.status === 'none').map((s) => s.soc),
        },
    };

    const report = renderReport({ inputs, parsed, socs, kelleyChanges, counts, fields });
    return { geoReal, fields, areasFile, report, socs, kelleyChanges, counts };
}

/** Lists every way the Kelley SOCs' rows differ from the earlier BLS-API geo_real.json. */
export function compareWithEarlier(
    inputs: Pick<StateMapInputs, 'earlier' | 'kelleySocs'>,
    geoReal: GeoRealFile,
    bySoc: ReadonlyMap<string, SocStateData>,
): KelleyChange[] {
    const changes: KelleyChange[] = [];
    const earlierKeys = Object.keys(inputs.earlier).filter((k) => k !== '_meta').sort();
    if (earlierKeys.join() !== [...inputs.kelleySocs].sort().join()) {
        throw new Error('the earlier geo_real.json does not hold exactly the Kelley SOCs');
    }
    for (const soc of inputs.kelleySocs) {
        const before = inputs.earlier[soc] as GeoRow[];
        const now = geoReal[soc] as GeoRow[];
        const b = new Map(before.map((r) => [r.name, r]));
        const n = new Map(now.map((r) => [r.name, r]));
        const change: KelleyChange = { soc, title: bySoc.get(soc)!.title, lq: [], employment: [], added: [], dropped: [], reorders: [], markers: null };
        for (const [name, r] of n) {
            const old = b.get(name);
            if (!old) change.added.push(name);
            else {
                if (old.employment !== r.employment) change.employment.push([name, old.employment, r.employment]);
                if (old.lq !== r.lq) change.lq.push([name, old.lq, r.lq]);
                if (old.lat !== r.lat || old.lng !== r.lng) throw new Error(`${soc} ${name}: centroid differs from the earlier file`);
            }
        }
        for (const name of b.keys()) if (!n.has(name)) change.dropped.push(name);
        // Ties: group by employment and compare the order of names within each group.
        const groups = (rows: GeoRow[]) => {
            const g = new Map<number, string[]>();
            for (const r of rows) g.set(r.employment, [...(g.get(r.employment) ?? []), r.name]);
            return g;
        };
        const gb = groups(before);
        for (const [emp, names] of groups(now)) {
            const old = gb.get(emp);
            if (old && names.length > 1 && old.join('|') !== names.join('|') && [...old].sort().join('|') === [...names].sort().join('|')) {
                change.reorders.push([emp, old, names]);
            }
        }
        const topB = before.slice(0, MARKER_CAP).map((r) => r.name);
        const topN = now.slice(0, MARKER_CAP).map((r) => r.name);
        const onlyB = topB.filter((x) => !topN.includes(x));
        const onlyN = topN.filter((x) => !topB.includes(x));
        if (onlyB.length || onlyN.length) change.markers = [onlyB, onlyN];
        if (change.lq.length || change.employment.length || change.added.length || change.dropped.length || change.reorders.length || change.markers) {
            changes.push(change);
        }
    }
    return changes;
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, word: string): string => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

function renderReport(ctx: {
    inputs: StateMapInputs;
    parsed: ParsedWorkbook;
    socs: SocStateData[];
    kelleyChanges: KelleyChange[];
    counts: StateMapBuild['counts'];
    fields: Map<string, StateMapField>;
}): string {
    const { inputs, parsed, socs, kelleyChanges, counts } = ctx;
    const src = inputs.sources.files.find((f) => f.path === WORKBOOK_FILE)!;
    const bySoc = new Map(socs.map((s) => [s.soc, s]));
    const kelley = new Set(inputs.kelleySocs);
    const L: string[] = [];
    const p = (s = '') => L.push(s);

    p('# State map: data and coverage');
    p();
    p('Built by `npx tsx scripts/build_state_map.ts` (method in `scripts/lib/stateMap.ts`). Do not edit by hand: `--check` and `stateMap.test.ts` fail if this file is stale.');
    p();
    p('The state map (the Map view) shows, for every one of the app\'s ' + fmt(counts.jobs) + ' jobs, how many people BLS counts in that job in each state and the job\'s location quotient there. Pay is not on the map.');
    p();
    p('## Source');
    p();
    p(`- **File**: BLS Occupational Employment and Wage Statistics (OEWS), May 2025, state estimates: ${src.url} (seen at ${src.seenAt}).`);
    p(`- **Retrieved**: ${src.retrieved}. Zip sha256 \`${src.zipSha256}\`.`);
    p(`- **Workbook**: \`${src.member}\`, committed unchanged as \`data/oews_state/${src.path}\`, sha256 \`${src.sha256}\`, sheet \`${src.sheet}\`.`);
    p(`- **Rows used**: ${fmt(parsed.detailedRows)} detailed-occupation rows (O_GROUP "detailed"), all cross-industry (NAICS 000000, OWN_CODE 1235), in ${parsed.areaTitles.size} areas: the 50 states, the District of Columbia, Guam, Puerto Rico and the Virgin Islands. These are the same ${inputs.areas.length} areas the map covered before; none added or dropped.`);
    p('- **Columns**: `TOT_EMP` (employment, rounded by BLS to the nearest 10, self-employed not included) and `LOC_QUOTIENT` (the job\'s share of the state\'s jobs divided by its share of all U.S. jobs). No wage column is used.');
    p('- **Map coordinates**: the circle positions are US Census Bureau state centroids (`data/oews_state/area_centroids.json`), display only, not BLS data.');
    p();
    p('## Method (the same for every job)');
    p();
    p('- A job\'s rows are the file\'s rows whose `OCC_CODE` is the job\'s SOC code. Every one of the app\'s jobs uses its own code; nothing is added up, split or estimated.');
    p('- BLS\'s note in the workbook: ' + parsed.notes.filter((n) => n.startsWith('**')).map((n) => `"${n}"`).join('; ') + '. A cell marked `**`, or a state with no row for the job, is left out. The map shows that state grey (apart from the employment colours), and its tooltip says "No data from BLS". The wage symbols (`*`, `#`) do not apply: the map shows no pay.');
    p('- In this file `TOT_EMP` and `LOC_QUOTIENT` are always both published or both `**`. Any other value stops the build.');
    p('- Rows are ordered by employment, largest first; states with the same employment are ordered by name, A to Z. The map labels its top 15 states.');
    p('- The 50 Kelley roles read `src/data/geo_real.json` (their ' + counts.kelleySocs + ' codes, the format the map has always used). Every job, Kelley included, is also in `src/data/state_map/<field>.json`, one chunk per field, loaded when the field (or the Map view) needs it. The test checks the two agree row for row.');
    p();
    p('## Coverage');
    p();
    const hidden = socs.filter((s) => s.status === 'partial');
    const none = socs.filter((s) => s.status === 'none');
    p(`| | Jobs |`);
    p(`|---|---:|`);
    p(`| Full map: BLS publishes the job in all ${inputs.areas.length} areas | ${fmt(counts.full)} |`);
    p(`| Some areas hidden or not listed by BLS | ${fmt(counts.partial)} |`);
    p(`| No state data at all | ${fmt(counts.none)} |`);
    p(`| **All jobs** | **${fmt(counts.jobs)}** |`);
    p();
    p(`- ${fmt(counts.fullStates)} jobs have data in all 50 states and DC (the territories aside).`);
    p(`- Cells: ${fmt(counts.publishedCells)} published, ${fmt(counts.hiddenCells)} marked \`**\` by BLS, ${fmt(counts.absentCells)} with no row in the file (${fmt(counts.jobs)} jobs x ${inputs.areas.length} areas = ${fmt(counts.jobs * inputs.areas.length)}).`);
    const hist = new Map<number, number>();
    for (const s of hidden) hist.set(s.rows.length, (hist.get(s.rows.length) ?? 0) + 1);
    const buckets: [string, (n: number) => boolean][] = [
        ['50 to 53 areas', (n) => n >= 50],
        ['40 to 49', (n) => n >= 40 && n < 50],
        ['20 to 39', (n) => n >= 20 && n < 40],
        ['1 to 19', (n) => n >= 1 && n < 20],
    ];
    p(`- Jobs with some areas hidden, by how many areas BLS publishes: ${buckets.map(([label, f]) => `${label}: ${fmt(hidden.filter((s) => f(s.rows.length)).length)}`).join('; ')}.`);
    p();
    p('### Jobs with no state data');
    p();
    p('The Map view shows "BLS publishes no state data for this job" for these, not an empty map.');
    p();
    for (const s of none) {
        const why = s.notInFile
            ? 'no row in the state file at all (BLS publishes it in the national file only)'
            : s.hidden.length === inputs.areas.length
                ? `marked \`**\` in all ${inputs.areas.length} areas`
                : `marked \`**\` in ${plural(s.hidden.length, 'area')} and not listed in the other ${s.absent.length}`;
        p(`- ${s.soc} ${s.title}: ${why}.`);
    }
    p();
    p('### Combined codes');
    p();
    p(`The ${Object.keys(ONET_CODES_FOR_SOC).length} combined codes in \`src/config/onetSplitCodes.ts\` (BLS codes that O*NET splits into smaller codes) are single codes in OEWS, and the state file publishes each under that exact code. So each uses its own rows: no job counts are added up, and no pay is involved.`);
    p();
    for (const soc of Object.keys(ONET_CODES_FOR_SOC).sort()) {
        const s = bySoc.get(soc)!;
        p(`- ${soc} ${s.title}: the file's own ${soc} rows, published in ${s.rows.length} of ${inputs.areas.length} areas${kelley.has(soc) ? ' (a Kelley code)' : ''}.`);
    }
    p();
    p('## Check against the earlier Kelley data');
    p();
    const earlierMeta = (inputs.earlier._meta ?? {}) as Record<string, unknown>;
    p(`The earlier \`geo_real.json\` (${counts.kelleySocs} Kelley codes) was built on ${String(earlierMeta.extracted)} from the BLS public API (${String(earlierMeta.source_api)}), the same release (${String(earlierMeta.bls_release)}). It is kept unchanged as \`data/oews_state/${EARLIER_FILE}\`. Rebuilt from the state file by this method:`);
    p();
    const empDiffs = kelleyChanges.reduce((n, c) => n + c.employment.length, 0);
    const lqDiffs = kelleyChanges.reduce((n, c) => n + c.lq.length, 0);
    const setDiffs = kelleyChanges.reduce((n, c) => n + c.added.length + c.dropped.length, 0);
    const reordered = kelleyChanges.filter((c) => c.reorders.length);
    p(`- Same states for all ${counts.kelleySocs} codes, ${fmt(counts.kelleyRows)} rows: ${setDiffs === 0 ? 'yes' : `no, ${setDiffs} differ`}.`);
    p(`- Same employment in every row: ${empDiffs === 0 ? 'yes' : `no, ${empDiffs} differ`}.`);
    p(`- Same location quotient: ${fmt(counts.kelleyRows - lqDiffs)} of ${fmt(counts.kelleyRows)} rows${lqDiffs ? `; ${plural(lqDiffs, 'row')} ${lqDiffs === 1 ? 'differs' : 'differ'} (listed below)` : ''}.`);
    p(`- Same order: ${counts.kelleySocs - reordered.length} of ${counts.kelleySocs} codes; ${reordered.length} list states with equal employment in another order.`);
    p();
    p('## Changes from the earlier Kelley data');
    p();
    p('Decided 2026-11-10: every job, Kelley included, now reads the one official BLS state file, so all 830 jobs come from one source by one method. The Kelley roles change only in these ways:');
    p();
    for (const c of kelleyChanges) {
        for (const [name, was, now] of c.lq) p(`- **${c.title} (${c.soc}), ${name}**: location quotient ${was} -> ${now}. The BLS API series gives ${was}; the BLS state file gives ${now}.`);
        for (const [name, was, now] of c.employment) p(`- **${c.title} (${c.soc}), ${name}**: employment ${fmt(was)} -> ${fmt(now)}.`);
    }
    const markerChanges = kelleyChanges.filter((c) => c.markers);
    for (const c of markerChanges) {
        const [was, now] = c.markers!;
        p(`- **${c.title} (${c.soc})**: shown on its own, its 15th circle label is now ${now.join(', ')} instead of ${was.join(', ')} (both ${fmt((inputs.earlier[c.soc] as GeoRow[]).find((r) => r.name === was[0])!.employment)} jobs; ties now go A to Z).`);
    }
    p(`- **Tie order** (${reordered.length} codes): states with equal employment are now listed A to Z. Numbers are unchanged; only the order of these rows moves, and only the circle label above is visible on the map.`);
    p();
    for (const c of reordered) {
        p(`  - ${c.soc} ${c.title}: ${c.reorders.map(([emp, was, now]) => `${fmt(emp)} jobs: ${was.join(', ')} -> ${now.join(', ')}`).join('; ')}`);
    }
    p('- **No-data states** (every job, a look change, not a data change): a state where BLS publishes no number for the selected jobs is now a flat grey, with "No data from BLS" in the legend and the tooltip. Before, it was the same dark colour as a state with very few workers, so "hidden" and "few" looked alike.');
    p();
    p('## Files');
    p();
    p('| File | What |');
    p('|---|---|');
    p('| `data/oews_state/state_M2025_dl.xlsx` | the BLS workbook, unchanged |');
    p('| `data/oews_state/sources.json` | URL, retrieved date and sha256 of every input |');
    p('| `data/oews_state/area_centroids.json` | display coordinates of the 54 areas |');
    p(`| \`data/oews_state/${EARLIER_FILE}\` | the earlier Kelley data, for the check above |`);
    p('| `src/data/geo_real.json` | the Kelley codes (bundled as its own chunk, loaded at start) |');
    p('| `src/data/state_map/areas.json` | the 54 areas (in the main bundle) |');
    p(`| \`src/data/state_map/<field>.json\` | one lazy chunk per field, ${ctx.fields.size} files, all ${fmt(counts.jobs)} jobs |`);
    p();
    return `${L.join('\n')}\n`;
}

/** JSON as committed: two-space indent, one array per line inside the field chunks. */
export function serialize(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

export function serializeField(f: StateMapField): string {
    const socs = Object.entries(f.socs).map(([soc, rows]) => `    ${JSON.stringify(soc)}: ${JSON.stringify(rows)}`);
    return `{\n  "_meta": ${JSON.stringify(f._meta, null, 2).replace(/\n/g, '\n  ')},\n  "socs": {\n${socs.join(',\n')}\n  }\n}\n`;
}

/** Every output file of the build, relative to the repo root, with its exact bytes. */
export function outputFiles(built: StateMapBuild): [string, string][] {
    const out: [string, string][] = [
        [STATE_MAP_PATHS.geoReal, serialize(built.geoReal)],
        [STATE_MAP_PATHS.areas, serialize(built.areasFile)],
        [STATE_MAP_PATHS.report, built.report],
    ];
    for (const [code, f] of [...built.fields].sort(([a], [b]) => (a < b ? -1 : 1))) {
        out.push([`${STATE_MAP_PATHS.fieldDir}/${code}.json`, serializeField(f)]);
    }
    return out;
}

/** Outputs whose committed bytes under `root` differ from the build (missing counts as stale). */
export function staleOutputs(root: string, built: StateMapBuild): string[] {
    return outputFiles(built)
        .filter(([rel, body]) => {
            const abs = path.join(root, rel);
            return !fs.existsSync(abs) || fs.readFileSync(abs, 'utf-8') !== body;
        })
        .map(([rel]) => rel);
}
