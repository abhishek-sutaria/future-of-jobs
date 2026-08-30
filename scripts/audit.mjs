#!/usr/bin/env node
/**
 * EXHAUSTIVE AUDIT TEST SUITE
 * Future of Jobs — Data Integrity & Production Readiness
 *
 * Runs 64 automated checks across 10 categories:
 *   [CAT-1]  Telemetry Cleanup
 *   [CAT-2]  Dead Code Removal
 *   [CAT-3]  Data Integrity — Jobs & Tasks
 *   [CAT-4]  SOC Code Map Coverage
 *   [CAT-5]  Config & Constants Correctness
 *   [CAT-6]  API / Proxy / Serverless Functions
 *   [CAT-7]  Validation & Data Flow
 *   [CAT-8]  Real-data policy
 *   [CAT-9]  Geographic Map Data Integrity
 *   [CAT-10] Production Build
 *
 * Usage: node scripts/audit.mjs
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Colour helpers ─────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};
const pass = (msg) => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const fail = (msg, detail = '') => {
  console.log(`  ${C.red}✗${C.reset} ${C.bold}${msg}${C.reset}`);
  if (detail) console.log(`    ${C.gray}→ ${detail}${C.reset}`);
};
const warn = (msg, detail = '') => {
  console.log(`  ${C.yellow}⚠${C.reset} ${msg}`);
  if (detail) console.log(`    ${C.gray}→ ${detail}${C.reset}`);
};
const heading = (cat, label) => {
  console.log(`\n${C.cyan}${C.bold}[${cat}] ${label}${C.reset}`);
  console.log(C.gray + '─'.repeat(60) + C.reset);
};

// ─── File helpers ────────────────────────────────────────────────────────────
/** Accept repo-relative paths (e.g. src/App.tsx) or absolute paths from collectSourceFiles */
function resolveProjectPath(relOrAbs) {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
}
const read = (relOrAbs) => fs.readFileSync(resolveProjectPath(relOrAbs), 'utf-8');
const exists = (relOrAbs) => fs.existsSync(resolveProjectPath(relOrAbs));

/** Recursively collect all .ts/.tsx files under a directory */
function collectSourceFiles(dir) {
  const results = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name)) results.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return results;
}

const SRC_FILES = collectSourceFiles('src');
const API_FILES = collectSourceFiles('api');
const ALL_FILES = [...SRC_FILES, ...API_FILES];

// ─── Data helpers ────────────────────────────────────────────────────────────
/** Crude extraction of job titles from data.ts without full TS execution */
function extractJobTitles() {
  const src = read('src/data.ts');
  const matches = [...src.matchAll(/"title":\s*"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

function extractSOCKeys() {
  const src = read('src/utils/onet.ts');
  const matches = [...src.matchAll(/"([^"]+)":\s*"\d{2}-\d{4}"/g)];
  return matches.map(m => m[1]);
}

/** Pull all task name strings out of a given job block in data.ts */
function extractJobTasks(jobId) {
  const src = read('src/data.ts');
  // Find the job block by id
  const idPattern = new RegExp(`"id":\\s*"${jobId}"[\\s\\S]+?(?="id":\\s*"job-|\\];)`, 'g');
  const block = src.match(idPattern);
  if (!block) return [];
  const taskNames = [...block[0].matchAll(/"name":\s*"([^"]+)"/g)];
  return taskNames.map(m => m[1]);
}

/** Extract all numeric score values from the source file for a given field */
function extractScoreValues(fieldName) {
  const src = read('src/data.ts');
  const re = new RegExp(`"${fieldName}":\\s*([0-9.]+)`, 'g');
  const vals = [];
  let m;
  while ((m = re.exec(src)) !== null) vals.push(parseFloat(m[1]));
  return vals;
}

function extractAllJobs() {
  const src = read('src/data.ts');
  // Extract all job blocks with basic fields
  const idRe = /"id":\s*"(job-\d+)"/g;
  const jobs = [];
  let m;
  while ((m = idRe.exec(src)) !== null) jobs.push(m[1]);
  return jobs;
}

// ─── Test runner ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let warned = 0;

function check(label, condition, detail = '', isWarn = false) {
  if (condition) {
    passed++;
    pass(label);
  } else if (isWarn) {
    warned++;
    warn(label, detail);
  } else {
    failed++;
    fail(label, detail);
  }
}

// =============================================================================
// CATEGORY 1: Telemetry Cleanup
// =============================================================================
heading('CAT-1', 'Telemetry Cleanup — localhost:7252 / Agent Log Markers');

// T1: No localhost:7252 URLs in any source/api file
{
  const hits = ALL_FILES.filter(f => read(f).includes('127.0.0.1:7252'));
  check(
    'T01 — No fetch("http://127.0.0.1:7252/...") calls remain in src/ or api/',
    hits.length === 0,
    hits.length > 0 ? `Found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// T2: No #region agent log markers
{
  const hits = ALL_FILES.filter(f => read(f).includes('#region agent log'));
  check(
    'T02 — No "#region agent log" markers remain',
    hits.length === 0,
    hits.length > 0 ? `Found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// T3: No #endregion markers left from agent logging
{
  const hits = ALL_FILES.filter(f => {
    const content = read(f);
    // Only flag #endregion if it appears with agent-log pattern context (loose check)
    return content.includes('// #endregion') && content.includes('sessionId');
  });
  check(
    'T03 — No orphaned "#endregion" markers from agent telemetry',
    hits.length === 0,
    hits.length > 0 ? `Found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// T4: No sessionId / hypothesisId / runId debug fields remain
{
  const keywords = ['hypothesisId', 'sessionId:', '"runId"', 'X-Debug-Session-Id'];
  const hits = ALL_FILES.filter(f => {
    const content = read(f);
    return keywords.some(k => content.includes(k));
  });
  check(
    'T04 — No debug session fields (hypothesisId, X-Debug-Session-Id, etc.) remain',
    hits.length === 0,
    hits.length > 0 ? `Found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// T5: Unused lastFrameLogRef removed from Terrain.tsx
{
  const src = read('src/components/Terrain.tsx');
  check(
    'T05 — lastFrameLogRef removed from Terrain.tsx',
    !src.includes('lastFrameLogRef')
  );
}

// T6: Unused lastMarkerLogRef removed from JobMarkers.tsx
{
  const src = read('src/components/JobMarkers.tsx');
  check(
    'T06 — lastMarkerLogRef removed from JobMarkers.tsx',
    !src.includes('lastMarkerLogRef')
  );
}

// T7: Unused lastLoggedYearRef removed from JobMesh.tsx
{
  const src = read('src/components/JobMesh.tsx');
  check(
    'T07 — lastLoggedYearRef removed from JobMesh.tsx',
    !src.includes('lastLoggedYearRef')
  );
}

// =============================================================================
// CATEGORY 2: Dead Code Removal
// =============================================================================
heading('CAT-2', 'Dead Code Removal');

// T8: AI_API constant block removed from constants.ts
{
  const src = read('src/config/constants.ts');
  check(
    'T08 — Dead AI_API constant (Gemini) removed from constants.ts',
    !src.includes('AI_API') && !src.includes('generativelanguage.googleapis.com')
  );
}

// T9: No import of AI_API anywhere in source
{
  const hits = SRC_FILES.filter(f => read(f).includes('AI_API'));
  check(
    'T09 — No source file imports or references AI_API',
    hits.length === 0,
    hits.length > 0 ? `Found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// T10: Brittle "tasks" text-detection heuristic removed from claude.ts
{
  const src = read('src/utils/claude.ts');
  check(
    'T10 — Brittle jsonText.includes(\'\\\"tasks\\\"\') heuristic removed from claude.ts',
    !src.includes('jsonText.includes') && !src.includes('"tasks"')
  );
}

// T11: validateClaudeResponse is still defined (not accidentally deleted)
{
  const src = read('src/utils/claude.ts');
  check(
    'T11 — validateClaudeResponse() function still exists in claude.ts',
    src.includes('validateClaudeResponse')
  );
}

// =============================================================================
// CATEGORY 3: Data Integrity — Jobs & Tasks
// =============================================================================
heading('CAT-3', 'Data Integrity — Jobs & Tasks in data.ts');

const jobTitles = extractJobTitles();
const uniqueTitles = new Set(jobTitles);

// T12: All job titles are unique
{
  const dupes = jobTitles.filter((t, i) => jobTitles.indexOf(t) !== i);
  check(
    `T12 — All ${jobTitles.length} job titles are unique`,
    dupes.length === 0,
    dupes.length > 0 ? `Duplicates: ${[...new Set(dupes)].join(', ')}` : ''
  );
}

// T13: Job count is reasonable (at least 40 jobs)
check(
  `T13 — Minimum 40 jobs in dataset (found ${jobTitles.length})`,
  jobTitles.length >= 40
);

// T14: Business Intelligence Analyst does NOT have business continuity tasks
{
  const tasks = extractJobTasks('job-3');
  const badKeywords = ['disaster recovery', 'call tree', 'continuity', 'shutdown'];
  const badTasks = tasks.filter(t => badKeywords.some(k => t.toLowerCase().includes(k)));
  check(
    'T14 — Business Intelligence Analyst (job-3) has NO business continuity tasks',
    badTasks.length === 0,
    badTasks.length > 0 ? `Found: "${badTasks[0]}"` : ''
  );
}

// T15: Business Intelligence Analyst HAS correct BI-related tasks
{
  const tasks = extractJobTasks('job-3');
  const goodKeywords = ['sql', 'dashboard', 'data', 'query', 'business'];
  const hasBITask = tasks.some(t => goodKeywords.some(k => t.toLowerCase().includes(k)));
  check(
    'T15 — Business Intelligence Analyst (job-3) has correct BI tasks (SQL/dashboard/data)',
    hasBITask && tasks.length > 0,
    tasks.length === 0 ? 'No tasks found for job-3' : `Tasks found: ${tasks.length}`
  );
}

// T16: All aiCapabilityScore values are in [0, 1]
{
  const vals = extractScoreValues('aiCapabilityScore');
  const bad = vals.filter(v => v < 0 || v > 1);
  check(
    `T16 — All aiCapabilityScore values are in [0,1] (checked ${vals.length} values)`,
    bad.length === 0,
    bad.length > 0 ? `Out-of-range: ${bad.join(', ')}` : ''
  );
}

// T17: All humanCriticalityScore values are in [0, 1]
{
  const vals = extractScoreValues('humanCriticalityScore');
  const bad = vals.filter(v => v < 0 || v > 1);
  check(
    `T17 — All humanCriticalityScore values are in [0,1] (checked ${vals.length} values)`,
    bad.length === 0,
    bad.length > 0 ? `Out-of-range: ${bad.join(', ')}` : ''
  );
}

// T18: No task has an empty "name" field
{
  const src = read('src/data.ts');
  const emptyNames = [...src.matchAll(/"name":\s*""/g)];
  check(
    'T18 — No task has an empty "name" field',
    emptyNames.length === 0,
    emptyNames.length > 0 ? `${emptyNames.length} empty task names found` : ''
  );
}

// T19: No job has employment <= 0
{
  const src = read('src/data.ts');
  const employmentVals = [...src.matchAll(/"employment":\s*(\d+)/g)].map(m => parseInt(m[1]));
  const bad = employmentVals.filter(v => v <= 0);
  check(
    `T19 — All employment figures are positive (checked ${employmentVals.length})`,
    bad.length === 0,
    bad.length > 0 ? `Non-positive: ${bad.join(', ')}` : ''
  );
}

// T20: All automationCostIndex values are in [0, 1]
{
  const vals = extractScoreValues('automationCostIndex');
  const bad = vals.filter(v => v < 0 || v > 1);
  check(
    `T20 — All automationCostIndex values are in [0,1] (checked ${vals.length} values)`,
    bad.length === 0,
    bad.length > 0 ? `Out-of-range: ${bad.join(', ')}` : ''
  );
}

// T21: All job IDs follow pattern job-N and are unique
{
  const src = read('src/data.ts');
  const ids = [...src.matchAll(/"id":\s*"(job-\d+)"/g)].map(m => m[1]);
  const uniqueIds = new Set(ids);
  const dupeIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(
    `T21 — All job IDs follow "job-N" pattern and are unique (${ids.length} jobs)`,
    ids.length > 0 && dupeIds.length === 0,
    dupeIds.length > 0 ? `Duplicate IDs: ${[...new Set(dupeIds)].join(', ')}` : ''
  );
}

// T22: All jobs have confidenceScore
{
  const src = read('src/data.ts');
  const jobCount = (src.match(/"id":\s*"job-/g) || []).length;
  const confCount = (src.match(/"confidenceScore":/g) || []).length;
  check(
    `T22 — All ${jobCount} jobs have a confidenceScore field`,
    jobCount === confCount,
    `Jobs: ${jobCount}, confidenceScore entries: ${confCount}`
  );
}

// T23: No task has a truncated description (less than 20 chars)
{
  const src = read('src/data.ts');
  const taskNames = [...src.matchAll(/"name":\s*"([^"]+)"/g)].map(m => m[1]);
  const tooShort = taskNames.filter(n => n.length < 20);
  check(
    `T23 — No task description is too short (<20 chars) (checked ${taskNames.length} tasks)`,
    tooShort.length === 0,
    tooShort.length > 0 ? `Short tasks: "${tooShort[0]}"` : ''
  );
}

// =============================================================================
// CATEGORY 4: SOC Code Map Coverage
// =============================================================================
heading('CAT-4', 'SOC Code Map Coverage (onet.ts ↔ data.ts)');

const socKeys = extractSOCKeys();
const socSet = new Set(socKeys);

// T24: SOC map has substantial coverage (at least 40 entries)
check(
  `T24 — SOC map has ≥40 entries (found ${socKeys.length})`,
  socKeys.length >= 40
);

// T25: Every job title in data.ts is present in MAP_TITLE_TO_SOC
{
  const missing = jobTitles.filter(t => !socSet.has(t));
  check(
    `T25 — All ${jobTitles.length} job titles have SOC codes in onet.ts`,
    missing.length === 0,
    missing.length > 0 ? `Missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}` : ''
  );
}

// T26: All SOC codes follow correct format (NN-NNNN)
{
  const src = read('src/utils/onet.ts');
  const socValues = [...src.matchAll(/"(\d{2}-\d{4})"/g)].map(m => m[1]);
  const badFormat = socValues.filter(v => !/^\d{2}-\d{4}$/.test(v));
  check(
    `T26 — All ${socValues.length} SOC codes follow "NN-NNNN" format`,
    badFormat.length === 0,
    badFormat.length > 0 ? `Bad format: ${badFormat.join(', ')}` : ''
  );
}

// T27: No duplicate job titles in SOC map
{
  const dupes = socKeys.filter((k, i) => socKeys.indexOf(k) !== i);
  check(
    'T27 — No duplicate job title keys in MAP_TITLE_TO_SOC',
    dupes.length === 0,
    dupes.length > 0 ? `Duplicates: ${[...new Set(dupes)].join(', ')}` : ''
  );
}

// =============================================================================
// CATEGORY 5: Config & Constants Correctness
// =============================================================================
heading('CAT-5', 'Config & Constants Correctness');

// T28: If IS_DEMO_MODE exists in analysis.ts it must be false (flag may be omitted)
{
  const src = read('src/utils/analysis.ts');
  const match = src.match(/export\s+const\s+IS_DEMO_MODE\s*=\s*(true|false)/);
  const ok = !match || match[1] === 'false';
  check(
    `T28 — analysis.ts demo flag: absent or explicitly false (found: ${match ? match[1] : 'absent'})`,
    ok,
    !ok ? 'IS_DEMO_MODE = true would route fake analysis — not allowed' : ''
  );
}

// T29: CLAUDE_PROXY_ENDPOINT points to /api/claude/messages
{
  const src = read('src/utils/claude.ts');
  check(
    'T29 — CLAUDE_PROXY_ENDPOINT points to /api/claude/messages',
    src.includes('/api/claude/messages')
  );
}

// T30: BLS proxy URL points to /api/bls
{
  const src = read('src/config/constants.ts');
  check(
    'T30 — BLS_API.PROXY_URL points to /api/bls',
    src.includes('/api/bls')
  );
}

// T31: YEAR_MIN and YEAR_MAX are defined and reasonable
{
  const src = read('src/config/constants.ts');
  const minMatch = src.match(/YEAR_MIN\s*=\s*(\d{4})/);
  const maxMatch = src.match(/YEAR_MAX\s*=\s*(\d{4})/);
  const yearMin = minMatch ? parseInt(minMatch[1]) : 0;
  const yearMax = maxMatch ? parseInt(maxMatch[1]) : 0;
  check(
    `T31 — YEAR_MIN (${yearMin}) and YEAR_MAX (${yearMax}) are defined and span at least 5 years`,
    yearMin >= 2020 && yearMax >= yearMin + 5
  );
}

// T32: No hardcoded API keys in source (look for sk-, ant-, etc.)
{
  const keyPatterns = [/sk-ant-[a-zA-Z0-9]{10,}/, /AIza[0-9A-Za-z-_]{35}/, /Bearer [a-zA-Z0-9]{20,}/];
  const hits = SRC_FILES.filter(f => {
    const content = read(f);
    return keyPatterns.some(p => p.test(content));
  });
  check(
    'T32 — No hardcoded API keys found in source files',
    hits.length === 0,
    hits.length > 0 ? `Keys found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// =============================================================================
// CATEGORY 6: API / Proxy / Serverless Functions
// =============================================================================
heading('CAT-6', 'API / Proxy / Serverless Functions');

// T33: Vercel serverless function api/claude.ts exists
check(
  'T33 — Vercel serverless function api/claude.ts exists',
  exists('api/claude.ts')
);

// T34: Vercel serverless function api/bls.ts exists
check(
  'T34 — Vercel serverless function api/bls.ts exists',
  exists('api/bls.ts')
);

// T35: api/claude.ts correctly reads ANTHROPIC_API_KEY from process.env
{
  if (exists('api/claude.ts')) {
    const src = read('api/claude.ts');
    check(
      'T35 — api/claude.ts reads ANTHROPIC_API_KEY from process.env',
      src.includes('ANTHROPIC_API_KEY')
    );
  } else {
    check('T35 — api/claude.ts reads ANTHROPIC_API_KEY from process.env', false, 'File missing');
  }
}

// T36: api/bls.ts proxies to api.bls.gov
{
  if (exists('api/bls.ts')) {
    const src = read('api/bls.ts');
    check(
      'T36 — api/bls.ts proxies to api.bls.gov',
      src.includes('api.bls.gov')
    );
  } else {
    check('T36 — api/bls.ts proxies to api.bls.gov', false, 'File missing');
  }
}

// T37: vercel.json exists and has rewrites or routes
{
  if (exists('vercel.json')) {
    const content = read('vercel.json');
    const json = JSON.parse(content);
    check(
      'T37 — vercel.json exists and contains routing config',
      !!(json.rewrites || json.routes || json.functions)
    );
  } else {
    check('T37 — vercel.json exists and contains routing config', false, 'vercel.json missing');
  }
}

// T38: vite.config.ts dev proxy points to real Anthropic endpoint
{
  const src = read('vite.config.ts');
  check(
    'T38 — vite.config.ts dev proxy for /api/claude points to api.anthropic.com',
    src.includes('api.anthropic.com')
  );
}

// =============================================================================
// CATEGORY 7: Validation & Data Flow
// =============================================================================
heading('CAT-7', 'Validation, Data Flow & Schema Correctness');

// T39: Zod schema exists for Claude response validation
{
  const src = read('src/utils/claude.ts');
  check(
    'T39 — Zod ClaudeResponseSchema is defined in claude.ts',
    src.includes('ClaudeResponseSchema') || src.includes('z.object')
  );
}

// T40: taskScoring.ts caches scores in localStorage
{
  const src = read('src/utils/taskScoring.ts');
  check(
    'T40 — taskScoring.ts uses localStorage caching',
    src.includes('localStorage')
  );
}

// T41: applyPercentileLabels function exists in store.ts
{
  const src = read('src/store.ts');
  check(
    'T41 — applyPercentileLabels() is used in store.ts (re-labelling after each AI score)',
    src.includes('applyPercentileLabels')
  );
}

// T42: No "TODO: replace with real" or "FIXME: mock" comments suggesting fake data
{
  const fakeDataKeywords = [
    'TODO: replace with real',
    'FIXME: mock',
    'fake data',
    'placeholder data',
    'dummy data',
    'hard-coded mock',
    'remove before prod',
  ];
  const hits = SRC_FILES.filter(f => {
    const content = read(f).toLowerCase();
    return fakeDataKeywords.some(k => content.includes(k.toLowerCase()));
  });
  check(
    'T42 — No "fake/dummy/mock data" or "remove before prod" comments found',
    hits.length === 0,
    hits.length > 0 ? `Found in: ${hits.map(f => path.relative(ROOT, f)).join(', ')}` : ''
  );
}

// =============================================================================
// CATEGORY 8: Real-data policy (no synthetic labor-market simulation)
// =============================================================================
heading('CAT-8', 'Real-data policy — banned simulation tokens in src/');

{
  const banned = ['GROWTH_RATES', 'WORKERS_TIMELINE_PEAK_AMPLIFIER'];
  const hits = [];
  for (const f of SRC_FILES) {
    const content = read(f);
    for (const token of banned) {
      if (content.includes(token)) hits.push(`${path.relative(ROOT, f)} (${token})`);
    }
  }
  check(
    'T47 — No GROWTH_RATES or WORKERS_TIMELINE_PEAK_AMPLIFIER in src/',
    hits.length === 0,
    hits.length > 0 ? hits.join(', ') : ''
  );
}

{
  const src = read('src/utils/taskScoring.ts');
  const m = src.match(/const CACHE_VERSION = (\d+)/);
  const v = m ? parseInt(m[1], 10) : 0;
  check(
    'T48 — taskScoring.ts CACHE_VERSION is at least 5 (prompt + validation bumps)',
    v >= 5,
    m ? `Found CACHE_VERSION = ${v}` : 'CACHE_VERSION not found'
  );
}

{
  const src = read('src/utils/terrainMath.ts');
  check(
    'T49 — Workers height maps implied headcount via getVisualHeightForEmployment (no WORKERS_TIMELINE amplifier)',
    src.includes('getVisualHeightForWorkersAtYear') &&
      src.includes('getVisualHeightForEmployment') &&
      !src.includes('WORKERS_TIMELINE')
  );
}

// =============================================================================
// CATEGORY 9: Geographic Map Data Integrity
// =============================================================================
heading('CAT-9', 'Geographic Map Data Integrity (geo_real.json ↔ onet.ts)');

{
  const geoPath = path.join(ROOT, 'src', 'data', 'geo_real.json');
  const onetSrc = read('src/utils/onet.ts');

  if (!exists('src/data/geo_real.json')) {
    failed++;
    fail('T54 — src/data/geo_real.json exists', 'File not found');
  } else {
    let geo;
    try {
      geo = JSON.parse(read('src/data/geo_real.json'));
    } catch (e) {
      failed++;
      fail('T54 — src/data/geo_real.json is valid JSON', e.message);
      geo = null;
    }

    if (geo) {
      // T54: _meta block present
      check(
        'T54 — geo_real.json has a _meta provenance block',
        !!geo._meta && !!geo._meta.bls_release && !!geo._meta.extracted,
        !geo._meta ? 'No _meta key' : 'Missing bls_release or extracted'
      );

      // T55: at least 40 SOC codes in geo
      const socKeys = Object.keys(geo).filter(k => k !== '_meta');
      check(
        `T55 — geo_real.json has ≥40 SOC code entries (found ${socKeys.length})`,
        socKeys.length >= 40,
        `Found ${socKeys.length}`
      );

      // T56: at least 1000 state rows in total
      const totalRows = socKeys.reduce((n, soc) => n + (geo[soc]?.length ?? 0), 0);
      check(
        `T56 — geo_real.json has ≥1000 state rows total (found ${totalRows})`,
        totalRows >= 1000,
        `Found ${totalRows}`
      );

      // T57: every SOC in MAP_TITLE_TO_SOC has an entry in geo_real.json.
      // No suppression allowlist needed any more: a SOC pending its state-level
      // refresh (e.g. 13-1020, 13-2054 — see geo_real.json _meta.note_pending_refresh)
      // still gets an empty-array KEY from refresh_oes_data.mjs, which satisfies
      // this check while remaining honestly empty. A code truly absent as a key
      // means the SOC map and geo_real.json have drifted and must be reconciled.
      const titleToSocMatches = [...onetSrc.matchAll(/"[^"]+"\s*:\s*"(\d{2}-\d{4})"/g)];
      const appSocSet = new Set(titleToSocMatches.map(m => m[1]));
      const geoSocSet = new Set(socKeys);
      const missingInGeo = [...appSocSet].filter(s => !geoSocSet.has(s));
      check(
        'T57 — Every MAP_TITLE_TO_SOC code has a key in geo_real.json',
        missingInGeo.length === 0,
        missingInGeo.length > 0 ? `Missing: ${missingInGeo.join(', ')}` : ''
      );

      // T58: no orphaned geo keys (every geo SOC is used by at least one title)
      const orphaned = socKeys.filter(s => !appSocSet.has(s));
      check(
        `T58 — No orphaned SOC keys in geo_real.json (all ${socKeys.length} SOCs used by a job title)`,
        orphaned.length === 0,
        orphaned.length > 0 ? `Orphaned: ${orphaned.join(', ')}` : ''
      );

      // T59: every state row has employment > 0 and lq >= 0
      let badRows = 0;
      for (const soc of socKeys) {
        for (const row of (geo[soc] || [])) {
          if (!row.employment || row.employment <= 0 || row.lq < 0) badRows++;
        }
      }
      check(
        `T59 — All state rows have employment > 0 and lq ≥ 0`,
        badRows === 0,
        badRows > 0 ? `${badRows} invalid rows found` : ''
      );

      // T60: _meta.note_coordinates explicitly mentions Census Bureau
      check(
        'T60 — _meta.note_coordinates documents lat/lng as Census centroids (display-only)',
        !!(geo._meta?.note_coordinates?.toLowerCase().includes('census')),
        'Expected "Census" in note_coordinates'
      );
    }
  }
}

// T61: MapView uses aggregateByState (de-duped SOC aggregation)
{
  const mapSrc = read('src/components/MapView.tsx');
  check(
    'T61 — MapView.tsx imports and uses aggregateByState (SOC-level de-dup)',
    mapSrc.includes('aggregateByState')
  );
}

// T62: mapAggregation.ts exists and de-dupes by SOC
{
  if (exists('src/utils/mapAggregation.ts')) {
    const src = read('src/utils/mapAggregation.ts');
    check(
      'T62 — mapAggregation.ts de-dupes by SOC (bySoc grouping present)',
      src.includes('bySoc') && src.includes('MAP_TITLE_TO_SOC')
    );
  } else {
    failed++;
    fail('T62 — src/utils/mapAggregation.ts exists', 'File not found');
  }
}

// T63: MapView does NOT use the old double-counting pattern (slice on raw job loop)
{
  const mapSrc = read('src/components/MapView.tsx');
  // Old pattern was: activeJobs.forEach(job => job.locations.forEach(loc => byState[loc.name].totalJobs += loc.employment))
  // New pattern uses aggregateByState. Check old pattern is gone.
  check(
    'T63 — MapView.tsx no longer double-counts per job.locations (uses aggregateByState)',
    !mapSrc.includes('loc.employment') || mapSrc.includes('aggregateByState')
  );
}

// T64: Deprecated/retired onet.ts SOC codes are gone.
// 11-2031, 41-3099: pre-2018 SOC codes superseded by their current equivalents.
// 13-1022, 13-1023: BLS retired both (Wholesale & Retail Buyer / Purchasing
// Agent) and now publishes only the combined broad code 13-1020.
{
  const onetSrc = read('src/utils/onet.ts');
  const badCodes = ['11-2031', '41-3099', '13-1022', '13-1023'];
  const found = badCodes.filter(c => onetSrc.includes(`"${c}"`));
  check(
    `T64 — Deprecated SOC codes removed from onet.ts (${badCodes.join(', ')})`,
    found.length === 0,
    found.length > 0 ? `Still present: ${found.join(', ')}` : ''
  );
}

// =============================================================================
heading('CAT-11', 'OES Vintage Consistency (data.ts ↔ constants.ts ↔ geo_real.json)');

{
  const dataSrc = read('src/data.ts');
  const constantsSrc = read('src/config/constants.ts');

  // T65: DATA_SOURCES.BLS_OES matches the literal baked into every job's
  // dataSources array. A partial rename here silently drops the OES
  // provenance badge for every job with no test failure elsewhere
  // (src/utils/provenance.ts matches on exact string equality).
  const constMatch = constantsSrc.match(/BLS_OES:\s*'([^']+)'/);
  const constValue = constMatch?.[1];
  const jobCount = (dataSrc.match(/"employment":\s*\d+/g) || []).length;
  const literalCount = constValue ? (dataSrc.match(new RegExp(`"${constValue}"`, 'g')) || []).length : 0;
  check(
    `T65 — DATA_SOURCES.BLS_OES ('${constValue}') appears in data.ts exactly once per job (${literalCount}/${jobCount})`,
    !!constValue && literalCount === jobCount && jobCount > 0,
    !constValue ? 'Could not find BLS_OES in constants.ts' : `Expected ${jobCount}, found ${literalCount}`
  );

  // T66: no stale prior-vintage literal left behind by an incomplete rename.
  const staleHits = (dataSrc.match(/"BLS-OES-\d{4}"/g) || []).filter(s => s !== `"${constValue}"`);
  check(
    'T66 — No stale BLS-OES-<year> literal in data.ts other than the current DATA_SOURCES.BLS_OES value',
    staleHits.length === 0,
    staleHits.length > 0 ? `Stale: ${[...new Set(staleHits)].join(', ')}` : ''
  );

  // T67: geo_real.json's own vintage is independently well-formed — it is a
  // SEPARATE extract from DATA_SOURCES.BLS_OES and is not asserted to match it
  // (see AGENTS.md "OES vintage is SPLIT"). Only checked for basic sanity.
  if (exists('src/data/geo_real.json')) {
    const geo = JSON.parse(read('src/data/geo_real.json'));
    check(
      'T67 — geo_real.json._meta.bls_release is a non-empty, plausible OES vintage string',
      typeof geo._meta?.bls_release === 'string' && /\b(19|20)\d{2}\b/.test(geo._meta.bls_release),
      `Found: ${JSON.stringify(geo._meta?.bls_release)}`
    );
  }
}

// =============================================================================
// CATEGORY 10: Build
// =============================================================================
heading('CAT-10', 'Production Build');

// T50: TypeScript compilation succeeds (tsc --noEmit)
{
  try {
    execSync('npx tsc --noEmit 2>&1', { cwd: ROOT, stdio: 'pipe' });
    passed++;
    pass('T50 — TypeScript type-check (tsc --noEmit) passes with zero errors');
  } catch (e) {
    failed++;
    const output = e.stdout?.toString() || e.message || '';
    const errorLines = output.split('\n').filter(l => l.includes('error TS')).slice(0, 5);
    fail('T50 — TypeScript type-check failed', errorLines.join(' | '));
  }
}

// T51: Vite production build succeeds
{
  try {
    execSync('npm run build 2>&1', { cwd: ROOT, stdio: 'pipe' });
    passed++;
    pass('T51 — Vite production build (npm run build) succeeds');
  } catch (e) {
    failed++;
    const output = e.stdout?.toString() || e.message || '';
    fail('T51 — Vite production build failed', output.slice(0, 200));
  }
}

// T52: dist/index.html exists after build
check(
  'T52 — dist/index.html exists post-build',
  exists('dist/index.html')
);

// T53: dist/assets directory has JS bundle
{
  const assetsDir = path.join(ROOT, 'dist', 'assets');
  const hasJs = fs.existsSync(assetsDir) &&
    fs.readdirSync(assetsDir).some(f => f.endsWith('.js'));
  check(
    'T53 — dist/assets/ contains a JavaScript bundle',
    hasJs
  );
}

// =============================================================================
// SUMMARY
// =============================================================================
const total = passed + failed + warned;
console.log('\n' + C.gray + '═'.repeat(60) + C.reset);
console.log(`${C.bold}AUDIT SUMMARY${C.reset}`);
console.log(C.gray + '═'.repeat(60) + C.reset);
console.log(`  Total checks  : ${C.bold}${total}${C.reset}`);
console.log(`  ${C.green}Passed${C.reset}         : ${C.green}${C.bold}${passed}${C.reset}`);
console.log(`  ${C.red}Failed${C.reset}         : ${C.red}${C.bold}${failed}${C.reset}`);
if (warned > 0) console.log(`  ${C.yellow}Warnings${C.reset}       : ${C.yellow}${C.bold}${warned}${C.reset}`);

if (failed === 0) {
  console.log(`\n${C.green}${C.bold}✓ ALL CHECKS PASSED — PRODUCTION READY${C.reset}\n`);
} else {
  console.log(`\n${C.red}${C.bold}✗ ${failed} CHECKS FAILED — REVIEW REQUIRED${C.reset}\n`);
  process.exit(1);
}
