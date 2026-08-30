#!/usr/bin/env node
/**
 * Refresh BLS OEWS employment data from the official BLS public API.
 *
 * WHY THE API AND NOT THE WORKBOOK
 * --------------------------------
 * The historical pipeline (scripts/extract_bls_data.py) reads a ~80MB OEWS
 * workbook committed under data/. That still works, but www.bls.gov and
 * download.bls.gov serve HTTP 403 to automated clients (Akamai bot
 * protection), so the workbook cannot be refreshed programmatically.
 *
 * api.bls.gov IS reachable and publishes the full OEWS dataset as timeseries:
 *
 *   OEU + areaType + areaCode(7) + industry(6) + soc(6) + datatype(2)
 *
 *   areaType 'N' = national (areaCode 0000000)
 *   areaType 'S' = state    (areaCode = 2-digit FIPS + '00000')
 *   industry '000000'       = cross-industry (matches the workbook filter)
 *   datatype '01'           = employment          (workbook TOT_EMP)
 *   datatype '17'           = location quotient   (workbook LOC_QUOTIENT)
 *
 * That is exactly the two measures src/data/geo_real.json stores, so this
 * script fully replaces the workbook path for the fields the app uses.
 *
 * HARD RULE: never fabricate. A SOC/area with no published series is reported
 * and omitted. Values are never interpolated, split across titles, or guessed.
 *
 * USAGE
 *   node scripts/refresh_oes_data.mjs [--national-only] [--dry-run] [--year=2025]
 *
 * A registered BLS API key (free: https://data.bls.gov/registrationEngine/)
 * is required for the state pass: the unregistered tier allows 25 series per
 * request and 25 requests/day, while the state pass needs ~5k series. Set it
 * as VITE_BLS_API_KEY (the name the app already uses) or BLS_API_KEY.
 *
 * Raw API responses are cached in data/.oes_api_cache.json (gitignored) so
 * re-runs and interrupted runs do not burn the daily quota.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ONET_PATH = path.join(ROOT, 'src/utils/onet.ts');
const DATA_TS_PATH = path.join(ROOT, 'src/data.ts');
const GEO_PATH = path.join(ROOT, 'src/data/geo_real.json');
const NATIONAL_PATH = path.join(ROOT, 'src/data/national_employment.json');
const CACHE_PATH = path.join(ROOT, 'data/.oes_api_cache.json');

const API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const DT_EMPLOYMENT = '01';
const DT_LOCATION_QUOTIENT = '17';

const args = process.argv.slice(2);
const NATIONAL_ONLY = args.includes('--national-only');
const DRY_RUN = args.includes('--dry-run');
const YEAR = (args.find((a) => a.startsWith('--year=')) || '--year=2025').split('=')[1];

const API_KEY = (process.env.VITE_BLS_API_KEY || process.env.BLS_API_KEY || '').trim();
// BLS v2 limits: 50 series/request + 500 requests/day registered,
// 25 series/request + 25 requests/day unregistered.
const SERIES_PER_REQUEST = API_KEY ? 50 : 25;

/**
 * BLS OEWS state area codes (2-digit FIPS). Includes the three territories
 * that the existing geo_real.json already carries, so coverage does not
 * silently shrink on refresh.
 */
const STATE_FIPS = {
    '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas',
    '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware',
    '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii',
    '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa',
    '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana', '23': 'Maine',
    '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota',
    '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska',
    '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico',
    '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio',
    '40': 'Oklahoma', '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island',
    '45': 'South Carolina', '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas',
    '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington',
    '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming',
    '66': 'Guam', '72': 'Puerto Rico', '78': 'Virgin Islands',
};

// ── Series ID construction ─────────────────────────────────────────

const socDigits = (soc) => soc.replace('-', '');
const nationalSeries = (soc, dt = DT_EMPLOYMENT) =>
    `OEUN0000000000000${socDigits(soc)}${dt}`;
const stateSeries = (fips, soc, dt = DT_EMPLOYMENT) =>
    `OEUS${fips}00000000000${socDigits(soc)}${dt}`;

// ── SOC map (parsed from onet.ts so there is one source of truth) ───

function parseSocMap() {
    const src = fs.readFileSync(ONET_PATH, 'utf8');
    const block = src.match(/MAP_TITLE_TO_SOC[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!block) throw new Error('Could not locate MAP_TITLE_TO_SOC in src/utils/onet.ts');
    const map = {};
    // Only match real entries; comment lines are skipped because the regex
    // requires a quoted key immediately followed by a colon.
    for (const m of block[1].matchAll(/"([^"]+)"\s*:\s*"(\d{2}-\d{4})"/g)) {
        map[m[1]] = m[2];
    }
    if (Object.keys(map).length === 0) throw new Error('Parsed an empty SOC map');
    return map;
}

// ── Cached, batched BLS fetch ──────────────────────────────────────

function loadCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch {
        return { year: YEAR, values: {} };
    }
}

function saveCache(cache) {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a set of series IDs, using the on-disk cache for anything already
 * known. Returns a map of seriesId -> numeric value. A series the API does
 * not publish is recorded as null (a real, cacheable "not published" answer)
 * so we never re-query it and never invent a number for it.
 */
async function fetchSeries(ids, cache, label) {
    const missing = ids.filter((id) => !(id in cache.values));
    if (missing.length === 0) {
        console.log(`  ${label}: all ${ids.length} series already cached`);
        return;
    }

    const batches = [];
    for (let i = 0; i < missing.length; i += SERIES_PER_REQUEST) {
        batches.push(missing.slice(i, i + SERIES_PER_REQUEST));
    }
    console.log(
        `  ${label}: ${missing.length} uncached series -> ${batches.length} request(s)` +
        `${API_KEY ? '' : ' (UNREGISTERED tier — 25/day cap)'}`
    );

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const body = { seriesid: batch, startyear: YEAR, endyear: YEAR };
        if (API_KEY) body.registrationkey = API_KEY;

        let json;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                json = await res.json();
                if (json.status === 'REQUEST_SUCCEEDED') break;
                throw new Error(`BLS status ${json.status}: ${(json.message || []).join('; ')}`);
            } catch (err) {
                if (attempt === 3) {
                    // Persist what we have so an interrupted run resumes cleanly
                    // rather than writing partial data downstream.
                    saveCache(cache);
                    throw new Error(
                        `Batch ${b + 1}/${batches.length} failed after 3 attempts: ${err.message}\n` +
                        `Progress cached in ${path.relative(ROOT, CACHE_PATH)} — re-run to resume.`
                    );
                }
                await sleep(1500 * attempt);
            }
        }

        for (const s of json.Results?.series || []) {
            const point = (s.data || []).find((d) => d.year === YEAR) || (s.data || [])[0];
            const raw = point?.value;
            const num = raw == null || raw === '-' ? null : Number(String(raw).replace(/,/g, ''));
            cache.values[s.seriesID] = Number.isFinite(num) ? num : null;
        }
        // Anything the API did not return at all is genuinely unpublished.
        for (const id of batch) if (!(id in cache.values)) cache.values[id] = null;

        saveCache(cache);
        process.stdout.write(`\r  ${label}: batch ${b + 1}/${batches.length} done`);
        if (b < batches.length - 1) await sleep(250);
    }
    process.stdout.write('\n');
}

// ── data.ts rewriting (minimal, line-anchored) ─────────────────────

/**
 * Rewrite each job's `employment` value in place. Deliberately line-anchored
 * rather than a JSON round-trip: src/data.ts has two different indentation
 * styles (the original 13 jobs vs the 37 appended later) and reserializing
 * would produce a 2,400-line reformat diff that buries the real change.
 */
function rewriteDataTs(socMap, nationalEmp, oldSourceLiteral, newSourceLiteral) {
    const lines = fs.readFileSync(DATA_TS_PATH, 'utf8').split('\n');
    const changes = [];
    let currentTitle = null;

    for (let i = 0; i < lines.length; i++) {
        const titleMatch = lines[i].match(/^\s*"title":\s*"(.+)",\s*$/);
        if (titleMatch) {
            currentTitle = titleMatch[1];
            continue;
        }
        const empMatch = lines[i].match(/^(\s*)"employment":\s*(\d+),\s*$/);
        if (empMatch && currentTitle) {
            const soc = socMap[currentTitle];
            const next = soc ? nationalEmp[soc] : undefined;
            if (soc && typeof next === 'number' && next > 0) {
                const prev = Number(empMatch[2]);
                if (prev !== next) {
                    lines[i] = `${empMatch[1]}"employment": ${next},`;
                    changes.push({ title: currentTitle, soc, from: prev, to: next });
                } else {
                    changes.push({ title: currentTitle, soc, from: prev, to: next, unchanged: true });
                }
            } else {
                changes.push({ title: currentTitle, soc: soc || '(unmapped)', from: Number(empMatch[2]), to: null });
            }
        }
    }

    let text = lines.join('\n');
    const sourceHits = text.split(`"${oldSourceLiteral}"`).length - 1;
    text = text.split(`"${oldSourceLiteral}"`).join(`"${newSourceLiteral}"`);

    if (!DRY_RUN) fs.writeFileSync(DATA_TS_PATH, text);
    return { changes, sourceHits };
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
    console.log(`\nBLS OEWS refresh — target vintage: May ${YEAR} (period A01)\n`);

    const socMap = parseSocMap();
    const socs = [...new Set(Object.values(socMap))].sort();
    console.log(`SOC map: ${Object.keys(socMap).length} titles -> ${socs.length} unique SOC codes`);
    if (!API_KEY && !NATIONAL_ONLY) {
        console.log(
            '\nNO BLS API KEY FOUND (VITE_BLS_API_KEY / BLS_API_KEY).\n' +
            'The state pass needs ~5,000 series; the unregistered tier allows 25/day.\n' +
            'Get a free key at https://data.bls.gov/registrationEngine/ or run with --national-only.\n'
        );
    }

    const cache = loadCache();
    if (cache.year !== YEAR) {
        console.log(`Cache is for ${cache.year}, target is ${YEAR} — starting a fresh cache.`);
        cache.year = YEAR;
        cache.values = {};
    }

    // ── National pass ──
    console.log('\nNational employment:');
    await fetchSeries(socs.map((s) => nationalSeries(s)), cache, 'national');

    const nationalEmp = {};
    const unpublished = [];
    for (const soc of socs) {
        const v = cache.values[nationalSeries(soc)];
        if (typeof v === 'number' && v > 0) nationalEmp[soc] = v;
        else unpublished.push(soc);
    }
    console.log(`  published: ${Object.keys(nationalEmp).length}/${socs.length}`);
    if (unpublished.length) {
        console.log(`  NOT PUBLISHED (left untouched, never guessed): ${unpublished.join(', ')}`);
    }

    // ── State pass ──
    let geoBySoc = null;
    if (!NATIONAL_ONLY) {
        const fipsList = Object.keys(STATE_FIPS);
        const stateIds = [];
        for (const soc of Object.keys(nationalEmp)) {
            for (const fips of fipsList) {
                stateIds.push(stateSeries(fips, soc, DT_EMPLOYMENT));
                stateIds.push(stateSeries(fips, soc, DT_LOCATION_QUOTIENT));
            }
        }
        console.log('\nState employment + location quotients:');
        await fetchSeries(stateIds, cache, 'state');

        // Reuse the existing Census centroids so display coordinates do not
        // drift and audit T60's note_coordinates contract still holds.
        const prevGeo = JSON.parse(fs.readFileSync(GEO_PATH, 'utf8'));
        const centroid = {};
        for (const [k, rows] of Object.entries(prevGeo)) {
            if (k === '_meta') continue;
            for (const r of rows) if (!centroid[r.name]) centroid[r.name] = { lat: r.lat, lng: r.lng };
        }

        geoBySoc = {};
        let rowCount = 0;
        const noCentroid = new Set();
        for (const soc of Object.keys(nationalEmp)) {
            const rows = [];
            for (const [fips, name] of Object.entries(STATE_FIPS)) {
                const emp = cache.values[stateSeries(fips, soc, DT_EMPLOYMENT)];
                const lq = cache.values[stateSeries(fips, soc, DT_LOCATION_QUOTIENT)];
                if (typeof emp !== 'number' || emp <= 0) continue; // suppressed -> omit
                const coords = centroid[name];
                if (!coords) { noCentroid.add(name); continue; }
                rows.push({
                    name,
                    lat: coords.lat,
                    lng: coords.lng,
                    employment: emp,
                    lq: typeof lq === 'number' && lq >= 0 ? lq : 0,
                });
            }
            rows.sort((a, b) => b.employment - a.employment);
            geoBySoc[soc] = rows;
            rowCount += rows.length;
        }
        console.log(`  ${Object.keys(geoBySoc).length} SOC codes, ${rowCount} state rows`);
        if (noCentroid.size) {
            console.log(`  WARNING no centroid for: ${[...noCentroid].join(', ')} (rows omitted)`);
        }
    }

    if (DRY_RUN) console.log('\n--dry-run: computing the report below, but no files will be written.');

    // ── Write geo_real.json ──
    if (geoBySoc && !DRY_RUN) {
        const out = {
            _meta: {
                source: `BLS Occupational Employment and Wage Statistics (OEWS), May ${YEAR}`,
                source_api: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
                bls_release: `OEWS May ${YEAR}`,
                api_vintage: `${YEAR} A01`,
                extracted: new Date().toISOString().slice(0, 10),
                soc_count: Object.keys(geoBySoc).length,
                note_coordinates:
                    'lat/lng values are US Census Bureau geographic centroids (display-only). ' +
                    'They are NOT part of BLS data.',
                note_employment:
                    'employment values are BLS OEWS employment (datatype 01, cross-industry). ' +
                    'lq values are BLS OEWS location quotient (datatype 17).',
                note_soc_codes:
                    'SOC codes match MAP_TITLE_TO_SOC in src/utils/onet.ts exactly. Some titles ' +
                    'share a SOC (e.g. Marketing Manager and Brand Manager both map to 11-2021). ' +
                    'The map aggregation layer de-dupes by SOC.',
                note_refresh: 'Regenerate with: node scripts/refresh_oes_data.mjs',
            },
            ...geoBySoc,
        };
        fs.writeFileSync(GEO_PATH, JSON.stringify(out, null, 2) + '\n');
        console.log(`\nwrote ${path.relative(ROOT, GEO_PATH)}`);
    }

    // ── Write national_employment.json ──
    const nationalOut = {
        _meta: {
            source: `BLS Occupational Employment and Wage Statistics (OEWS), May ${YEAR}`,
            bls_release: `OEWS May ${YEAR}`,
            api_vintage: `${YEAR} A01`,
            extracted: new Date().toISOString().slice(0, 10),
            note: 'employment is BLS OEWS datatype 01 (national, cross-industry).',
        },
    };
    for (const [soc, employment] of Object.entries(nationalEmp)) nationalOut[soc] = { employment };
    if (!DRY_RUN) {
        fs.writeFileSync(NATIONAL_PATH, JSON.stringify(nationalOut, null, 2) + '\n');
        console.log(`wrote ${path.relative(ROOT, NATIONAL_PATH)}`);
    }

    // ── Rewrite src/data.ts ── (rewriteDataTs itself honours DRY_RUN internally)
    const { changes, sourceHits } = rewriteDataTs(
        socMap, nationalEmp, 'BLS-OES-2023', `BLS-OES-${YEAR}`
    );
    console.log(`${DRY_RUN ? 'would write' : 'wrote'} ${path.relative(ROOT, DATA_TS_PATH)} (${sourceHits} dataSources literals ${DRY_RUN ? 'to update' : 'updated'})`);

    // ── Report ──
    const moved = changes.filter((c) => !c.unchanged && c.to !== null);
    const skipped = changes.filter((c) => c.to === null);
    console.log(`\nEmployment: ${moved.length} changed, ${changes.length - moved.length - skipped.length} unchanged, ${skipped.length} skipped\n`);
    if (moved.length) {
        const w = Math.max(...moved.map((c) => c.title.length));
        console.log(`  ${'ROLE'.padEnd(w)}  ${'SOC'.padEnd(8)} ${'FROM'.padStart(10)} ${'TO'.padStart(10)}  DELTA`);
        for (const c of moved.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))) {
            const pct = c.from ? (((c.to - c.from) / c.from) * 100).toFixed(0) : '—';
            console.log(
                `  ${c.title.padEnd(w)}  ${c.soc.padEnd(8)} ${c.from.toLocaleString().padStart(10)} ` +
                `${c.to.toLocaleString().padStart(10)}  ${pct > 0 ? '+' : ''}${pct}%`
            );
        }
    }
    if (skipped.length) {
        console.log('\n  SKIPPED (no published series — value left as-is, never guessed):');
        for (const c of skipped) console.log(`    ${c.title} (${c.soc})`);
    }
    console.log('');
}

main().catch((err) => {
    console.error(`\nrefresh_oes_data failed: ${err.message}\n`);
    process.exit(1);
});
