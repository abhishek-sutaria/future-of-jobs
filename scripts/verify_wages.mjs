#!/usr/bin/env node
/**
 * Cross-check src/data/national_wages.json against api.bls.gov.
 *
 * The bundled wages come from the BLS OEWS May 2025 national workbook
 * (scripts/extract_oews_wages.py). This script is the independent second
 * source: it shares no code with the extractor and reads no cache. It rebuilds
 * every series ID from MAP_TITLE_TO_SOC, re-downloads every wage series, and
 * diffs value, null-ness and top-code flag against the file. Expected output:
 * zero mismatches.
 *
 * Not blocking: it starts with ONE probe request. If api.bls.gov is down it
 * prints "API still <status>, verify deferred" and exits 3 without retrying.
 *
 * USAGE
 *   node scripts/verify_wages.mjs
 * Uses VITE_BLS_API_KEY / BLS_API_KEY when set (50 series per request), else
 * the key-less tier (25 per request, 8 requests for 47 SOCs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const WAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/national_wages.json'), 'utf8'));
const EMPLOYMENT_META = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/national_employment.json'), 'utf8'))._meta;
const YEAR = WAGES._meta.api_vintage.split(' ')[0];
const API_KEY = (process.env.VITE_BLS_API_KEY || process.env.BLS_API_KEY || '').trim();
const PER_REQUEST = API_KEY ? 50 : 25;

// What this verifier independently expects each measure's datatype code to be
// (BLS oe.datatype: 03 Hourly mean wage, 04 Annual mean wage, 08 Hourly median
// wage, 13 Annual median wage).
const DATATYPE = { annualMedian: '13', annualMean: '04', hourlyMedian: '08', hourlyMean: '03' };

const mismatches = [];
const fail = (msg) => mismatches.push(msg);

function socsFromOnet() {
    const src = fs.readFileSync(path.join(ROOT, 'src/utils/onet.ts'), 'utf8');
    const start = src.indexOf('MAP_TITLE_TO_SOC');
    const body = src.slice(start, src.indexOf('\n};', start));
    return [...new Set([...body.matchAll(/"[^"]+"\s*:\s*"(\d{2}-\d{4})"/g)].map((m) => m[1]))].sort();
}

async function post(ids) {
    const body = { seriesid: ids, startyear: YEAR, endyear: YEAR };
    if (API_KEY) body.registrationkey = API_KEY;
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify(body),
        cache: 'no-store',
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML error page */ }
    return { status: res.status, json };
}

const topcodedText = (t) => /equal to or greater than/i.test(String(t));

async function main() {
    const socs = socsFromOnet();
    const jobs = socs.flatMap((soc) =>
        Object.entries(DATATYPE).map(([measure, code]) => ({ soc, measure, id: `OEUN0000000000000${soc.replace('-', '')}${code}` }))
    );

    // ── One probe; no loop ──
    const first = await post(jobs.slice(0, PER_REQUEST).map((j) => j.id));
    if (first.status !== 200 || first.json?.status !== 'REQUEST_SUCCEEDED') {
        console.log(`API still ${first.status}${first.json?.status ? ` (${first.json.status})` : ''}, verify deferred`);
        process.exit(3);
    }

    console.log(`verify_wages: api.bls.gov, OEWS ${YEAR} A01, no cache${API_KEY ? ' (registered key)' : ' (key-less tier)'}\n`);
    const meta = WAGES._meta;
    if (meta.bls_release !== EMPLOYMENT_META.bls_release) fail(`_meta.bls_release ${meta.bls_release} != employment ${EMPLOYMENT_META.bls_release}`);
    console.log(`vintage: wages ${meta.bls_release} / ${meta.api_vintage}; employment ${EMPLOYMENT_META.bls_release} / ${EMPLOYMENT_META.api_vintage}`);

    const entrySocs = Object.keys(WAGES).filter((k) => k !== '_meta').sort();
    if (JSON.stringify(entrySocs) !== JSON.stringify(socs)) fail(`SOC set differs: file ${entrySocs.length}, MAP_TITLE_TO_SOC ${socs.length}`);
    console.log(`coverage: ${socs.length} SOCs in MAP_TITLE_TO_SOC; file has ${entrySocs.length} entries\n`);

    const series = {};
    const absorb = (json) => { for (const s of json.Results?.series || []) series[s.seriesID] = s; };
    absorb(first.json);
    for (let i = PER_REQUEST; i < jobs.length; i += PER_REQUEST) {
        const r = await post(jobs.slice(i, i + PER_REQUEST).map((j) => j.id));
        if (r.json?.status !== 'REQUEST_SUCCEEDED') {
            console.log(`API failed mid-run (HTTP ${r.status}, ${r.json?.status ?? 'non-JSON'}), verify incomplete`);
            process.exit(3);
        }
        absorb(r.json);
    }

    let numeric = 0;
    for (const { soc, measure, id } of jobs) {
        const entry = WAGES[soc];
        if (!entry) continue;
        if (entry.seriesIds?.[measure] !== id) fail(`${soc} ${measure}: seriesId ${entry.seriesIds?.[measure]} != ${id}`);

        const data = series[id]?.data || [];
        const point = data.find((d) => d.year === YEAR && d.period === 'A01');
        if (data.length && !point) fail(`${id}: API returned ${data.map((d) => `${d.year} ${d.period}`)}, not ${YEAR} A01`);

        const n = point ? Number(String(point.value).replace(/,/g, '')) : NaN;
        const apiValue = Number.isFinite(n) ? n : null;
        const apiTop = (point?.footnotes || []).some((f) => f && topcodedText(f.text));

        if (entry[measure] !== apiValue) fail(`${soc} ${measure} (${id}): file ${entry[measure]} != API ${apiValue} (raw "${point?.value}")`);
        if (Boolean(entry.topcoded?.[measure]) !== apiTop) fail(`${soc} ${measure}: topcoded ${entry.topcoded?.[measure]} != API ${apiTop}`);
        if (apiValue !== null) numeric++;
    }

    console.log(`series checked: ${jobs.length} (${numeric} numeric, ${jobs.length - numeric} null)`);
    console.log(`mismatches: ${mismatches.length}`);
    for (const m of mismatches) console.log(`  MISMATCH ${m}`);
    process.exit(mismatches.length ? 1 : 0);
}

main().catch((err) => {
    console.error(`verify_wages failed: ${err.message}`);
    process.exit(2);
});
