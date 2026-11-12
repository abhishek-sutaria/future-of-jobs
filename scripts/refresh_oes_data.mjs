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
 * STATE DATA IS NOT REFRESHED HERE ANY MORE (2026-11-10). The state map
 * (src/data/geo_real.json and src/data/state_map/) is built for all 830 jobs
 * from the BLS OEWS state file by `npx tsx scripts/build_state_map.ts`
 * (docs/state-map.md). This script refreshes the national figures only.
 *
 * HARD RULE: never fabricate. A SOC/area with no published series is reported
 * and omitted. Values are never interpolated, split across titles, or guessed.
 *
 * USAGE
 *   node scripts/refresh_oes_data.mjs [--dry-run] [--year=2025]
 *
 * The national pass is one series per Kelley SOC (47), well inside the
 * unregistered tier; a BLS key (VITE_BLS_API_KEY or BLS_API_KEY) is optional.
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
const NATIONAL_PATH = path.join(ROOT, 'src/data/national_employment.json');
const CACHE_PATH = path.join(ROOT, 'data/.oes_api_cache.json');

const API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const DT_EMPLOYMENT = '01';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const YEAR = (args.find((a) => a.startsWith('--year=')) || '--year=2025').split('=')[1];

const API_KEY = (process.env.VITE_BLS_API_KEY || process.env.BLS_API_KEY || '').trim();
// BLS v2 limits: 50 series/request + 500 requests/day registered,
// 25 series/request + 25 requests/day unregistered.
const SERIES_PER_REQUEST = API_KEY ? 50 : 25;

// ── Series ID construction ─────────────────────────────────────────

const socDigits = (soc) => soc.replace('-', '');
const nationalSeries = (soc, dt = DT_EMPLOYMENT) =>
    `OEUN0000000000000${socDigits(soc)}${dt}`;

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

    console.log('\nState data is not refreshed here: npx tsx scripts/build_state_map.ts builds it from the BLS state file.');

    if (DRY_RUN) console.log('\n--dry-run: computing the report below, but no files will be written.');

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
