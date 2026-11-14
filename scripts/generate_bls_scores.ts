/**
 * generate_bls_scores.ts
 * ----------------------
 * AI scores for BLS occupations outside the 50 Kelley roles. Same method as
 * the published 50 (scripts/generate_ai_scores.ts): claude-sonnet-5, the shared
 * buildJobAnalysisPrompt + parseJobAnalysis, thinking disabled, max_tokens 4096,
 * 5 O*NET tasks per role. See scripts/lib/claudeScoring.ts, scripts/lib/blsTasks.ts
 * and scripts/lib/scorePlanAll.ts. Decisions: docs/scoring-decisions.md.
 *
 * Two modes:
 *
 * A. Business & Finance (no --family/--fields; done 2026-11-01, kept as it was):
 *   1. Confirm from the data that exactly these 13 SOCs lack a Kelley role, and
 *      that the task plan matches the committed data/bls_scoring_plan.json.
 *   2. Control: re-score 5 published Kelley roles and compare each role's
 *      average aiCapabilityScore and humanCriticalityScore with ai_scores.json.
 *      Passes only if the mean absolute gap is <= 5 points (0-100) on BOTH.
 *      Control scores are never written to the app or adjusted in any way.
 *   3. Growth sensitivity (report only) on 2 published Kelley roles.
 *   4. Score the 13 and write src/data/ai_scores_bls.json, all 13 or nothing.
 *
 * B. A batch from data/bls_score_plan_all.json (--family 1|2|3, --fields 11,15,17
 *    or --batch kelley):
 *   1. Rebuild the plan for all 830 occupations and refuse to start unless it
 *      equals the committed data/bls_score_plan_all.json.
 *   2. Control: 5 re-scores of already-published roles and the same pass rule,
 *      once per batch (cached in the ledger under the batch name, so a re-run
 *      does not repeat them). --family/--fields re-score the 5 Kelley roles
 *      above against ai_scores.json; --batch kelley re-scores 5 published
 *      Business & Finance jobs (KELLEY_CONTROL_SOCS) from their own plan rows
 *      against ai_scores_bls.json, since the Kelley SOCs are what it replaces.
 *   3. Score the batch's jobs in plan order, skipping any already in the ledger
 *      or already in src/data/ai_scores_bls.json. Jobs with no O*NET tasks are
 *      never sent.
 *   4. Only when every job in the batch is scored, add them to
 *      src/data/ai_scores_bls.json; the existing entries stay byte for byte.
 *
 *   --batch kelley scores the 47 SOCs of the 50 Kelley titles by exactly the
 *   rules, prompt, inputs, model and settings of every other row, so every
 *   scored role ends up on one method. The app then reads each Kelley title's
 *   tasks and scores from ai_scores_bls.json by its SOC (titles that share a
 *   SOC share them too); src/data/ai_scores.json stays in the repo as history.
 *
 * Routes (pick one; the request body is identical either way):
 *   --proxy <url>  through the app's /api/claude/messages (or CLAUDE_PROXY_URL)
 *   --direct       straight to https://api.anthropic.com/v1/messages with the
 *                  key in FOJ_SCORING_API_KEY or ~/.foj_scoring_key and the
 *                  workspace in FOJ_SCORING_WORKSPACE or ~/.foj_scoring_workspace
 *                  (scripts/lib/scoringAuth.ts). ANTHROPIC_API_KEY is never read.
 *
 * Any HTTP failure stops the run at once. A response that fails parsing or the
 * forecast rules gets one retry in the same run; in a batch a job rejected twice
 * is skipped and the run goes on, and after 4 failed calls across runs it is
 * no longer tried. Every call is written to the gitignored ledger
 * data/ai_scores_bls_run.json (tokens, cost, running total), which also caches
 * each success so a rerun never pays twice. Never delete that file.
 *
 * Flags:
 *   --plan            rewrite data/bls_scoring_plan.json and data/bls_score_plan_all.json
 *                     from the committed data and print counts and a cost estimate (no API calls)
 *   --dry-run         print the plan, controls and budget, then exit (no API calls)
 *   --family 1|2|3    scoring order group (1 Management/Business/Science/Arts, 2 Sales
 *                     and Office, 3 the rest); --fields 11,15 picks fields instead
 *   --batch kelley    the 47 Kelley SOCs (never with --family or --fields)
 *   --max-calls N     API calls this run may make, retries and controls included
 *                     (default 30; anything above 450 is refused)
 *   --max-jobs N      score at most N new jobs this run (batch mode)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { initialJobs } from '../src/data';
import { MAP_TITLE_TO_SOC } from '../src/utils/onet';
import { buildJobAnalysisPrompt, CACHE_VERSION, type JobAnalysisResult } from '../src/utils/taskScoring';
import { buildRiskScale, riskBand } from '../src/config/theme';
import {
    ANTHROPIC_URL,
    CLAUDE_MODEL,
    MAX_TOKENS,
    ResponseError,
    TransportError,
    scoreWithClaude,
    type Auth,
    type ClaudeUsage,
    type JobInput,
} from './lib/claudeScoring';
import {
    BF_TARGET_SOCS,
    CONTROL_JOB_IDS,
    SENSITIVITY_JOB_IDS,
    GROWTH_MISMATCH_NOTE,
    GROWTH_SOURCE,
    PROMPT_GROWTH_LABEL,
    TASKS_PER_ROLE,
    TASK_STATEMENTS_PATH,
    loadPlanInputs,
    planAll,
    uncoveredBusinessFinanceSocs,
    type RolePlan,
} from './lib/blsTasks';
import {
    KELLEY_CONTROL_SOCS,
    PLAN_ALL_PATH,
    PLAN_BATCHES,
    SCORING_GROUPS,
    applyFilter,
    batchKey,
    countPlan,
    estimateCost,
    isFiltered,
    loadAllInputs,
    parsePlanFilter,
    planAllFields,
    planAllFile,
    promptFor,
    type PlanAllEntry,
    type PlanFilter,
} from './lib/scorePlanAll';
import { loadDirectAuth } from './lib/scoringAuth';
import { RANK_TABLE_FIXTURE, writeRankTable } from './rank_table';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The repository. main({ root }) points every path below at a copy instead (tests only). */
const REPO_ROOT = path.join(__dirname, '..');
let ROOT = REPO_ROOT;
const paths = () => ({
    OUT_FILE: path.join(ROOT, 'src', 'data', 'ai_scores_bls.json'),
    PUBLISHED_FILE: path.join(ROOT, 'src', 'data', 'ai_scores.json'),
    PLAN_FILE: path.join(ROOT, 'data', 'bls_scoring_plan.json'),
    PLAN_ALL_FILE: path.join(ROOT, PLAN_ALL_PATH),
    RUN_FILE: path.join(ROOT, 'data', 'ai_scores_bls_run.json'),
});

export const DEFAULT_MAX_CALLS = 30;
/** No single run may make more calls than this, whatever --max-calls says. */
export const HARD_MAX_CALLS = 450;
const ATTEMPTS_PER_ROLE = 2;
/** Failed calls for one job across every run, after which a batch stops trying it. */
const MAX_FAILED_CALLS_PER_JOB = 4;
/** Pause between calls; none under vitest, where Claude is mocked. */
const RATE_LIMIT_MS = process.env.VITEST ? 0 : 1200;
const CONTROL_PASS_POINTS = 5;
/** claude-sonnet-5 list price, USD per million tokens. */
const PRICE_PER_MTOK = { input: 2, output: 10 } as const;

type Kind = 'control' | 'sensitivity' | 'score';

interface CallRecord {
    n: number;
    at: string;
    kind: Kind;
    key: string;
    attempt: number;
    outcome: 'ok' | 'response-error' | 'transport-error';
    model: string | null;
    usage: ClaudeUsage | null;
    error?: string;
    route?: Auth['mode'];
    /** Batch name (batch mode only). */
    batch?: string;
    /** USD for this call at PRICE_PER_MTOK. */
    costUsd?: number;
    /** USD for every call in the ledger up to and including this one. */
    runningTotalUsd?: number;
}

interface CachedResult {
    analysis: JobAnalysisResult;
    model: string | null;
    scoredAt: string;
    promptSha256: string;
}

interface RunLedger {
    version: number;
    calls: CallRecord[];
    control: Record<string, CachedResult>;
    /** Report-only growth sensitivity results; never written to src/data. */
    sensitivity?: Record<string, CachedResult>;
    scores: Record<string, CachedResult>;
    /** Batch mode control re-scores, by batch name then Kelley job id (or SOC for --batch kelley). Never published. */
    controlRuns?: Record<string, Record<string, CachedResult>>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
type ScoredTasks = { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] };
const avgAi = (a: ScoredTasks) => mean(a.tasks.map((t) => t.aiCapabilityScore));
const avgHuman = (a: ScoredTasks) => mean(a.tasks.map((t) => t.humanCriticalityScore));

/** Thrown when a role's responses are rejected on every attempt. Stops the run unless a step catches it. */
class RejectedTwice extends Error {}

/** Thrown before a call that would go past --max-calls. The ledger is already saved. */
class CallCapReached extends Error {}

/** Set as soon as the ledger loads, so every stop can print what was spent. */
let runLedger: RunLedger | null = null;
/** Calls made by this process, and the most it may make. */
let callsThisRun = 0;
let maxCalls = DEFAULT_MAX_CALLS;
/** Batch name stamped on each call record (batch mode only). */
let currentBatch: string | undefined;

/** --max-calls N: a whole number from 1 to HARD_MAX_CALLS. Throws on anything else. */
export function parseMaxCalls(argv: readonly string[]): number {
    const i = argv.indexOf('--max-calls');
    if (i === -1) return DEFAULT_MAX_CALLS;
    const raw = argv[i + 1];
    if (!raw || !/^\d+$/.test(raw)) throw new Error(`--max-calls needs a whole number, not "${raw ?? ''}"`);
    const n = Number(raw);
    if (n < 1) throw new Error('--max-calls must be at least 1');
    if (n > HARD_MAX_CALLS) throw new Error(`--max-calls ${n} refused: no run may make more than ${HARD_MAX_CALLS} calls. Split the work into smaller runs.`);
    return n;
}

/** --max-jobs N, or Infinity. */
export function parseMaxJobs(argv: readonly string[]): number {
    const i = argv.indexOf('--max-jobs');
    if (i === -1) return Infinity;
    const raw = argv[i + 1];
    if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`--max-jobs needs a whole number of at least 1, not "${raw ?? ''}"`);
    return Number(raw);
}

function fail(message: string, code = 1): never {
    if (runLedger) reportUsage(runLedger);
    console.error(`\n❌  ${message}\n`);
    process.exit(code);
}

/** --direct or --proxy, never both. Prints where the key came from, never the key. */
function getAuth(argv: readonly string[]): Auth {
    const direct = argv.includes('--direct');
    const i = argv.indexOf('--proxy');
    if (direct && i !== -1) fail('Pick one route: --direct or --proxy, not both.');
    if (direct) {
        try {
            const auth = loadDirectAuth();
            console.log(`🔑  Direct · ${ANTHROPIC_URL} · key from ${auth.keySource} · workspace from ${auth.workspaceSource}`);
            return { mode: 'direct', key: auth.key, workspace: auth.workspace };
        } catch (err) {
            fail(err instanceof Error ? err.message : String(err));
        }
    }
    const url = (i !== -1 ? argv[i + 1] : undefined) ?? process.env.CLAUDE_PROXY_URL;
    if (!url || url.startsWith('--')) {
        fail('Pick a route. Either:\n    --direct   (key in FOJ_SCORING_API_KEY or ~/.foj_scoring_key, workspace in FOJ_SCORING_WORKSPACE or ~/.foj_scoring_workspace)\n    --proxy https://futureofjobs.vercel.app/api/claude/messages');
    }
    console.log(`🔑  Proxy ${url}`);
    return { mode: 'proxy', url };
}

/** claude-sonnet-5 itself (bare or dated), never another model that shares the prefix. */
const isExpectedModel = (m: string | null) => m === CLAUDE_MODEL || (!!m && new RegExp(`^${CLAUDE_MODEL}-\\d{8}$`).test(m));

function loadLedger(): RunLedger {
    if (!fs.existsSync(paths().RUN_FILE)) return { version: CACHE_VERSION, calls: [], control: {}, sensitivity: {}, scores: {} };
    const parsed = JSON.parse(fs.readFileSync(paths().RUN_FILE, 'utf-8')) as RunLedger;
    if (parsed.version !== CACHE_VERSION) {
        // Keep the call count (money already spent) but drop results scored under another schema.
        return { version: CACHE_VERSION, calls: parsed.calls ?? [], control: {}, sensitivity: {}, scores: {} };
    }
    return { ...parsed, sensitivity: parsed.sensitivity ?? {} };
}

function saveLedger(ledger: RunLedger): void {
    fs.writeFileSync(paths().RUN_FILE, JSON.stringify(ledger, null, 2) + '\n');
}

function usageTotals(calls: CallRecord[]) {
    const input = calls.reduce((s, c) => s + (c.usage?.input_tokens ?? 0) + (c.usage?.cache_creation_input_tokens ?? 0) + (c.usage?.cache_read_input_tokens ?? 0), 0);
    const output = calls.reduce((s, c) => s + (c.usage?.output_tokens ?? 0), 0);
    const cost = (input * PRICE_PER_MTOK.input + output * PRICE_PER_MTOK.output) / 1e6;
    return { input, output, cost };
}

/** Stamps tokens' cost and the ledger's running total on a call record. */
function priceCall(ledger: RunLedger, record: CallRecord): void {
    record.costUsd = Number(usageTotals([record]).cost.toFixed(6));
    record.runningTotalUsd = Number(usageTotals(ledger.calls).cost.toFixed(6));
}

const callTag = (record: CallRecord) =>
    `[call ${callsThisRun}/${maxCalls} this run · $${(record.costUsd ?? 0).toFixed(4)} · total $${(record.runningTotalUsd ?? 0).toFixed(4)}]`;

/**
 * One role, up to ATTEMPTS_PER_ROLE calls. Every call is written to the ledger
 * before the next step, so an interrupted run still counts what it spent.
 */
async function scoreOnce(ledger: RunLedger, kind: Kind, key: string, label: string, job: JobInput, auth: Auth): Promise<CachedResult> {
    const prompt = buildJobAnalysisPrompt(job.title, job.taskNames, job.employment, job.projectedGrowth);
    let lastError = '';
    for (let attempt = 1; attempt <= ATTEMPTS_PER_ROLE; attempt++) {
        if (callsThisRun >= maxCalls) {
            saveLedger(ledger);
            throw new CallCapReached(`--max-calls ${maxCalls} reached. Stopped before ${label}.`);
        }
        const record: CallRecord = {
            n: ledger.calls.length + 1,
            at: new Date().toISOString(),
            kind,
            key,
            attempt,
            outcome: 'ok',
            model: null,
            usage: null,
            route: auth.mode,
            ...(currentBatch ? { batch: currentBatch } : {}),
        };
        ledger.calls.push(record);
        callsThisRun++;
        try {
            const { analysis, usage, model } = await scoreWithClaude(job, auth);
            record.usage = usage;
            record.model = model;
            priceCall(ledger, record);
            if (!isExpectedModel(model)) {
                record.outcome = 'response-error';
                record.error = `response came from model "${model}", not ${CLAUDE_MODEL}`;
                saveLedger(ledger);
                fail(`${label}: ${record.error}. Nothing from this response is used.`);
            }
            saveLedger(ledger);
            const tasksBack = analysis.tasks.length;
            if (tasksBack !== job.taskNames.length) {
                throw new ResponseError(`returned ${tasksBack} task scores for ${job.taskNames.length} tasks`, usage, model);
            }
            console.log(`✓  ${callTag(record)} ${label.padEnd(52)} risk ${avgAi(analysis).toFixed(2)}  human ${avgHuman(analysis).toFixed(2)}`);
            return { analysis, model, scoredAt: record.at, promptSha256: sha256(prompt) };
        } catch (err) {
            if (err instanceof TransportError) {
                record.outcome = 'transport-error';
                record.error = err.message;
                saveLedger(ledger);
                fail(`${label}: the ${auth.mode} call failed — ${err.message}\n    Stopped. No retry for an HTTP failure. Run again to resume; nothing already scored is lost.`);
            }
            record.outcome = 'response-error';
            record.error = err instanceof Error ? err.message : String(err);
            if (err instanceof ResponseError) {
                record.usage ??= err.usage;
                record.model ??= err.model;
            }
            priceCall(ledger, record);
            saveLedger(ledger);
            lastError = record.error;
            console.log(`↻  ${callTag(record)} ${label.padEnd(52)} response rejected: ${lastError.slice(0, 80)}`);
            if (attempt < ATTEMPTS_PER_ROLE) await sleep(RATE_LIMIT_MS);
        }
    }
    throw new RejectedTwice(`${label}: ${ATTEMPTS_PER_ROLE} responses in a row failed validation (last: ${lastError}).`);
}

function checkPlan(plans: RolePlan[]): void {
    const fresh = JSON.stringify(plans, null, 2);
    if (!fs.existsSync(paths().PLAN_FILE)) fail(`${path.relative(ROOT, paths().PLAN_FILE)} is missing. Run with --plan, review it and commit it first.`);
    const committed = JSON.parse(fs.readFileSync(paths().PLAN_FILE, 'utf-8'));
    if (JSON.stringify(committed.roles, null, 2) !== fresh) {
        fail(`${path.relative(ROOT, paths().PLAN_FILE)} does not match the committed O*NET/BLS data. Re-run --plan and review the diff.`);
    }
}

function writePlan(plans: RolePlan[], dir: string): void {
    const file = {
        _meta: {
            purpose: 'The exact tasks and BLS inputs each unscored Business & Finance occupation is scored on. Generated by `npm run generate-bls-scores -- --plan`; the scoring run refuses to start if this file and the data disagree.',
            taskSource: `O*NET 30.1 (${TASK_STATEMENTS_PATH}); for SOC 13-2020 the O*NET codes 13-2022.00 and 13-2023.00`,
            rules: {
                'first-5-onet-order': 'The occupation\'s own .00 tasks, first 5 in O*NET file order (as scripts/extract_new_jobs.cjs did for the published 50).',
                'round-robin-sub-codes': 'No .00 task list: one task from each O*NET sub-code in turn, in sub-code order, each in O*NET file order.',
                'round-robin-onet-codes': 'No O*NET code of its own: the O*NET codes it maps to, taken in turn the same way.',
            },
            employment: 'BLS OEWS May 2025 national employment (src/data/occupations/13.json employment)',
            growth: GROWTH_SOURCE,
            promptGrowthLabel: PROMPT_GROWTH_LABEL,
            growthNote: GROWTH_MISMATCH_NOTE,
            tasksPerRole: TASKS_PER_ROLE,
        },
        roles: plans,
    };
    const out = path.join(dir, path.basename(paths().PLAN_FILE));
    fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
    console.log(`💾  Wrote ${path.relative(ROOT, out)}`);
}

function kelleySocList(): string[] {
    return initialJobs.map((j) => {
        const soc = MAP_TITLE_TO_SOC[j.title];
        if (!soc) fail(`Kelley role "${j.title}" has no SOC`);
        return soc;
    });
}

/** Plan for all 830 occupations in all 22 fields, plus the counts. */
export function buildPlanAll(root: string = ROOT) {
    const inputs = loadAllInputs(root);
    const entries = planAllFields(inputs, kelleySocList());
    const counts = countPlan(entries, Object.keys(inputs.occupations).length);
    return { entries, counts };
}

/** Mean prompt length of the 13 Business & Finance prompts, the base of the cost estimate. */
function bfMeanPromptLength(plans: RolePlan[]): number {
    return plans.reduce((s, p) => s + promptFor(p).length, 0) / plans.length;
}

function printPlanSummary(entries: PlanAllEntry[], counts: ReturnType<typeof countPlan>, filter: PlanFilter, bfMeanLength: number): void {
    console.log(`\n${counts.totalOccupations} occupations, one plan row each = ${counts.scorable} scorable + ${counts.noTasks} with no O*NET tasks`);
    console.log('\n| Batch | Rows | Scorable | Own code | Sub-codes | Combined | No tasks | Est. cost | +15% retries | Time at 7 s/call |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    const line = (name: string, sel: PlanAllEntry[]) => {
        const est = estimateCost(sel, bfMeanLength);
        const r = (rule: string) => sel.filter((e) => e.taskRule === rule).length;
        console.log(`| ${name} | ${sel.length} | ${est.jobs} | ${r('own-code')} | ${r('sub-codes')} | ${r('combined')} | ${r('no-tasks')} | $${est.cost.toFixed(2)} | $${est.costWithRetries.toFixed(2)} | ${est.minutes.toFixed(0)} min |`);
    };
    for (const g of SCORING_GROUPS) line(`family ${g.id} ${g.name}`, entries.filter((e) => !e.batch && e.family === g.id));
    for (const b of PLAN_BATCHES) line(`${b}${b === 'business-finance' ? ' (scored 2026-11-01)' : ''}`, entries.filter((e) => e.batch === b));
    line('All', entries);
    console.log('(Estimate only, no calls: B&F measured 1,208 input + 721 output tokens per call, input scaled by prompt length; controls not included.)');
    if (counts.fewerThanFiveTasks.length > 0) console.log(`Fewer than 5 tasks available: ${counts.fewerThanFiveTasks.join(', ')}`);
    if (isFiltered(filter)) {
        const sel = applyFilter(entries, filter);
        const est = estimateCost(sel, bfMeanLength);
        console.log(`\nSelected (${batchKey(filter)}): ${sel.length} rows, ${est.jobs} scorable, ${sel.length - est.jobs} with no tasks · ~$${est.cost.toFixed(2)} ($${est.costWithRetries.toFixed(2)} with retries) · ~${est.minutes.toFixed(0)} min`);
    }
}

function checkPlanAll(entries: PlanAllEntry[]): void {
    const rel = path.relative(ROOT, paths().PLAN_ALL_FILE);
    if (!fs.existsSync(paths().PLAN_ALL_FILE)) fail(`${rel} is missing. Run with --plan, review it and commit it first.`);
    const committed = JSON.parse(fs.readFileSync(paths().PLAN_ALL_FILE, 'utf-8'));
    if (JSON.stringify(committed.jobs, null, 2) !== JSON.stringify(entries, null, 2)) {
        fail(`${rel} does not match the committed O*NET/BLS data. Re-run --plan and review the diff.`);
    }
}

interface ControlOutcome {
    rows: { role: string; publishedAi: number; newAi: number; publishedHuman: number; newHuman: number }[];
    gapAi: number;
    gapHuman: number;
    passed: boolean;
}

/** One control re-score: a published role, the exact input it was scored on, and its published numbers. */
interface ControlCase {
    /** Ledger key: the Kelley job id, or the SOC for --batch kelley. */
    key: string;
    label: string;
    job: JobInput;
    published: ScoredTasks;
}

/** Re-scores the control roles (cached in `store`) and compares them with the published set. */
async function runControls(ledger: RunLedger, store: Record<string, CachedResult>, cases: ControlCase[], auth: Auth): Promise<ControlOutcome> {
    console.log('Control run (never published):');
    for (const c of cases) {
        if (store[c.key]) {
            console.log(`·  cached   ${c.label}`);
            continue;
        }
        store[c.key] = await scoreOnce(ledger, 'control', c.key, `control: ${c.label}`, c.job, auth);
        saveLedger(ledger);
        await sleep(RATE_LIMIT_MS);
    }

    const rows = cases.map((c) => {
        const now = store[c.key].analysis;
        return {
            role: c.label,
            publishedAi: avgAi(c.published) * 100,
            newAi: avgAi(now) * 100,
            publishedHuman: avgHuman(c.published) * 100,
            newHuman: avgHuman(now) * 100,
        };
    });
    const gapAi = mean(rows.map((r) => Math.abs(r.newAi - r.publishedAi)));
    const gapHuman = mean(rows.map((r) => Math.abs(r.newHuman - r.publishedHuman)));
    const passed = gapAi <= CONTROL_PASS_POINTS && gapHuman <= CONTROL_PASS_POINTS;

    console.log('\n| Role | Risk published | Risk new | Gap | Human published | Human new | Gap |');
    console.log('|---|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
        console.log(`| ${r.role} | ${r.publishedAi.toFixed(1)} | ${r.newAi.toFixed(1)} | ${(r.newAi - r.publishedAi).toFixed(1)} | ${r.publishedHuman.toFixed(1)} | ${r.newHuman.toFixed(1)} | ${(r.newHuman - r.publishedHuman).toFixed(1)} |`);
    }
    console.log(`| **Mean absolute gap** | | | **${gapAi.toFixed(2)}** | | | **${gapHuman.toFixed(2)}** |`);
    console.log(`\nControl ${passed ? 'PASSED' : 'FAILED'} (limit ${CONTROL_PASS_POINTS} points on both measures).`);
    return { rows, gapAi, gapHuman, passed };
}

function loadControlJobs(published: { scores: Record<string, JobAnalysisResult> }) {
    return CONTROL_JOB_IDS.map((id) => {
        const job = initialJobs.find((j) => j.id === id);
        if (!job || !published.scores[id]) fail(`Control role ${id} is missing from data.ts or ai_scores.json`);
        return job;
    });
}

/** The 5 published Kelley roles, re-scored on their published tasks and inputs (Business & Finance and --family/--fields). */
function kelleyRoleControls(published: { scores: Record<string, JobAnalysisResult> }): ControlCase[] {
    return loadControlJobs(published).map((job) => ({
        key: job.id,
        label: job.title,
        job: { title: job.title, taskNames: job.tasks.map((t) => t.name), employment: job.employment, projectedGrowth: job.projectedGrowth },
        published: published.scores[job.id],
    }));
}

interface PublishedBlsEntry extends ScoredTasks {
    title: string;
    promptSha256?: string;
    tasks: { taskName: string; aiCapabilityScore: number; humanCriticalityScore: number }[];
}

/**
 * --batch kelley controls: 5 published Business & Finance jobs, re-scored from
 * their own plan rows. Refuses to start unless each row's prompt hashes to the
 * promptSha256 its published score was made from, so the control sends the
 * very prompt the published numbers came from.
 */
export function publishedBlsControls(entries: readonly PlanAllEntry[], scores: Record<string, PublishedBlsEntry>): ControlCase[] {
    return KELLEY_CONTROL_SOCS.map((soc) => {
        const row = entries.find((e) => e.soc === soc);
        const pub = scores[soc];
        if (!row || row.batch !== 'business-finance') throw new Error(`Control ${soc} has no business-finance row in ${PLAN_ALL_PATH}`);
        if (!pub) throw new Error(`Control ${soc} has no published score in src/data/ai_scores_bls.json`);
        const hash = sha256(promptFor(row));
        if (hash !== row.promptSha256 || hash !== pub.promptSha256) {
            throw new Error(`Control ${soc}: its plan prompt does not hash to the published promptSha256, so it would not re-score the published input.`);
        }
        return {
            key: soc,
            label: `${soc} ${row.title}`,
            job: { title: row.title, taskNames: row.tasks.map((t) => t.name), employment: row.employment, projectedGrowth: row.projectedGrowth },
            published: pub,
        };
    });
}

const readPublished = () => JSON.parse(fs.readFileSync(paths().PUBLISHED_FILE, 'utf-8')) as { scores: Record<string, JobAnalysisResult> };

/** One scores-file entry, the same shape as the 13 Business & Finance entries. */
function scoreEntry(plan: { title: string; rule: string; onetCodes: string[]; employment: number; projectedGrowth: number; tasks: { onetCode: string; taskId: number }[] }, r: CachedResult) {
    return {
        title: plan.title,
        rule: plan.rule,
        onetCodes: plan.onetCodes,
        employment: plan.employment,
        projectedGrowth: plan.projectedGrowth,
        responseModel: r.model,
        scoredAt: r.scoredAt,
        promptSha256: r.promptSha256,
        tasks: r.analysis.tasks.map((t, i) => ({
            taskName: t.taskName,
            aiCapabilityScore: t.aiCapabilityScore,
            humanCriticalityScore: t.humanCriticalityScore,
            onetCode: plan.tasks[i].onetCode,
            taskId: plan.tasks[i].taskId,
        })),
        yearlyForecast: r.analysis.yearlyForecast,
    };
}

// ── B. A batch from the plan (--family, --fields or --batch kelley) ─────────

async function runBatch(argv: readonly string[], filter: PlanFilter, ledger: RunLedger, dryRun: boolean): Promise<void> {
    const { entries } = buildPlanAll();
    checkPlanAll(entries);
    const key = batchKey(filter);
    currentBatch = key;
    const selected = applyFilter(entries, filter);
    const jobs = selected.filter((e) => e.taskRule !== 'no-tasks');
    const existingFile = JSON.parse(fs.readFileSync(paths().OUT_FILE, 'utf-8')) as { scores: Record<string, PublishedBlsEntry> };
    /** Done: in the ledger, or already published (a published entry is never replaced). */
    const isDone = (soc: string) => Boolean(ledger.scores[soc] || existingFile.scores[soc]);
    const failedCalls = (soc: string) => ledger.calls.filter((c) => c.kind === 'score' && c.key === soc && c.outcome !== 'ok').length;
    const pending = jobs.filter((e) => !isDone(e.soc));
    const givenUp = pending.filter((e) => failedCalls(e.soc) >= MAX_FAILED_CALLS_PER_JOB);
    const maxJobs = parseMaxJobs(argv);
    ledger.controlRuns ??= {};
    const controls = (ledger.controlRuns[key] ??= {});
    let controlCases: ControlCase[];
    try {
        controlCases = filter.batch === 'kelley' ? publishedBlsControls(entries, existingFile.scores) : kelleyRoleControls(readPublished());
    } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
    }
    const pendingControl = controlCases.filter((c) => !controls[c.key]).length;

    console.log(`✔  Batch ${key}: ${selected.length} occupations, ${jobs.length} with tasks, ${selected.length - jobs.length} with no O*NET tasks (never sent).`);
    console.log(`📒  Ledger: ${ledger.calls.length} calls so far · ${jobs.length - pending.length} of ${jobs.length} already scored · ${pendingControl} control + ${pending.length - givenUp.length} jobs to go · this run may make ${maxCalls} calls${Number.isFinite(maxJobs) ? ` and score ${maxJobs} jobs` : ''}.`);
    if (givenUp.length > 0) console.log(`⚠️  Not tried again (${MAX_FAILED_CALLS_PER_JOB} failed calls each): ${givenUp.map((e) => e.soc).join(', ')}`);

    if (dryRun) {
        for (const e of pending) {
            console.log(`${e.soc}  ${e.title}  (${e.taskRule}; ${e.onetCodes.join(', ')}; ${e.tasks.length} tasks; prompt ${e.promptLength} chars)`);
            if (filter.batch) for (const t of e.tasks) console.log(`    ${t.onetCode} #${t.taskId}  ${t.name}`);
        }
        console.log(`\nControl roles (${filter.batch === 'kelley' ? 'published Business & Finance jobs, ai_scores_bls.json' : 'published Kelley roles, ai_scores.json'}): ${controlCases.map((c) => c.label).join(', ')}`);
        console.log(`Calls needed with no retries: ${pendingControl} control + ${pending.length - givenUp.length} jobs = ${pendingControl + pending.length - givenUp.length} (this run may make ${maxCalls}).`);
        return;
    }

    const auth = getAuth(argv);
    console.log(`    ${CLAUDE_MODEL} · thinking disabled · max_tokens ${MAX_TOKENS} · prompt schema v${CACHE_VERSION}\n`);

    const control = await runControls(ledger, controls, controlCases, auth);
    if (!control.passed) fail(`Control run failed. No ${key} job was scored. Nothing was written to src/data.`, 2);

    console.log(`\nBatch ${key}:`);
    let scoredThisRun = 0;
    const failedThisRun: string[] = [];
    for (const e of jobs) {
        if (isDone(e.soc)) continue;
        if (failedCalls(e.soc) >= MAX_FAILED_CALLS_PER_JOB) continue;
        if (scoredThisRun >= maxJobs) {
            console.log(`\n⏸  --max-jobs ${maxJobs} reached.`);
            break;
        }
        const job: JobInput = { title: e.title, taskNames: e.tasks.map((t) => t.name), employment: e.employment, projectedGrowth: e.projectedGrowth };
        if (sha256(promptFor(e)) !== e.promptSha256) fail(`${e.soc}: the prompt no longer matches the planned promptSha256. Stopped before spending anything on it.`);
        try {
            ledger.scores[e.soc] = await scoreOnce(ledger, 'score', e.soc, `${e.soc} ${e.title}`, job, auth);
            scoredThisRun++;
        } catch (err) {
            if (!(err instanceof RejectedTwice)) throw err;
            failedThisRun.push(e.soc);
            console.log(`✗  ${err.message} Skipped; the run goes on.`);
        }
        saveLedger(ledger);
        await sleep(RATE_LIMIT_MS);
    }

    const left = jobs.filter((e) => !isDone(e.soc));
    console.log(`\nScored this run: ${scoredThisRun}. Batch ${key}: ${jobs.length - left.length} of ${jobs.length} scored.`);
    if (failedThisRun.length > 0) console.log(`Rejected twice this run: ${failedThisRun.join(', ')}`);
    if (left.length > 0) {
        reportUsage(ledger);
        console.log(`\n⏸  ${left.length} still to score. Nothing written to src/data until the whole batch is scored. Run the same command again to continue.`);
        return;
    }

    // Every job in the batch is scored: add the new ones to the scores file.
    const existing = JSON.parse(fs.readFileSync(paths().OUT_FILE, 'utf-8'));
    const scores = { ...existing.scores };
    let added = 0;
    for (const e of jobs) {
        if (scores[e.soc]) continue;
        scores[e.soc] = scoreEntry({ ...e, rule: e.selectionRule! }, ledger.scores[e.soc]);
        added++;
    }
    const routeLabel = auth.mode === 'direct' ? 'api.anthropic.com/v1/messages (direct)' : 'app proxy /api/claude/messages';
    const out = {
        ...existing,
        // The file's date and route are the latest batch's; each batch's own route is in controlRuns.
        route: `${routeLabel}, latest batch ${key}; each controlRuns entry names its batch route, and the 13 Business & Finance entries (controlRun, 2026-11-01) used app proxy /api/claude/messages`,
        generatedAt: new Date().toISOString(),
        controlRuns: {
            ...(existing.controlRuns ?? {}),
            [key]: {
                roles: control.rows.map((r) => r.role),
                meanAbsGapRiskPoints: Number(control.gapAi.toFixed(2)),
                meanAbsGapHumanPoints: Number(control.gapHuman.toFixed(2)),
                limitPoints: CONTROL_PASS_POINTS,
                passed: control.passed,
                route: routeLabel,
                plan: PLAN_ALL_PATH,
                comparedWith: filter.batch === 'kelley' ? 'src/data/ai_scores_bls.json (published 2026-11-01 Business & Finance entries)' : 'src/data/ai_scores.json',
            },
        },
        scores,
    };
    fs.writeFileSync(paths().OUT_FILE, JSON.stringify(out, null, 2) + '\n');
    console.log(`\n💾  Wrote ${path.relative(ROOT, paths().OUT_FILE)}: ${added} ${key} jobs added, ${Object.keys(existing.scores).length} existing entries unchanged.`);
    if (filter.batch === 'kelley') {
        // The Kelley titles now read their SOC entries: refresh their before / after rank table (checked by rankScale.test.ts).
        const table = writeRankTable(ROOT);
        console.log(`💾  Wrote ${RANK_TABLE_FIXTURE}: ${table.out._meta.onSocEntry} of 50 Kelley titles on their SOC entry, ranked among ${table.scale.count}.`);
    }
    reportUsage(ledger);
    console.log(
        filter.batch === 'kelley'
            ? '\n✅  Done. The app now reads every Kelley title from ai_scores_bls.json by its SOC. Next: npx vitest run, npm run build, then commit src/data/ai_scores_bls.json (docs/scoring-decisions.md, "The Kelley batch").'
            : '\n✅  Done. Next: npx vitest run (expected red tests are listed in docs/scoring-decisions.md), then the user-facing text updates.',
    );
}

// ── Entry ───────────────────────────────────────────────────────────────────

export interface MainOptions {
    /** Where --plan writes its two files (tests point this at a temp folder). */
    planDir?: string;
    /** Run against a copy of the repository (tests only: a fake Kelley batch in a temp folder). */
    root?: string;
}

export async function main(argv: readonly string[] = process.argv.slice(2), opts: MainOptions = {}): Promise<void> {
    const PLAN_ONLY = argv.includes('--plan');
    const DRY_RUN = argv.includes('--dry-run');
    let filter: PlanFilter;
    try {
        filter = parsePlanFilter(argv);
        maxCalls = parseMaxCalls(argv);
        parseMaxJobs(argv);
    } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
    }
    callsThisRun = 0;
    ROOT = opts.root ?? REPO_ROOT;

    if (PLAN_ONLY) {
        const dir = opts.planDir ?? path.join(ROOT, 'data');
        const bfPlans = planAll(loadPlanInputs(ROOT));
        writePlan(bfPlans, dir);
        const { entries, counts } = buildPlanAll();
        const file = path.join(dir, path.basename(paths().PLAN_ALL_FILE));
        fs.writeFileSync(file, JSON.stringify(planAllFile(entries, counts), null, 2) + '\n');
        console.log(`💾  Wrote ${path.relative(ROOT, file)} (${entries.length} occupations)`);
        printPlanSummary(entries, counts, filter, bfMeanPromptLength(bfPlans));
        return;
    }

    const ledger = loadLedger();
    runLedger = ledger;

    if (isFiltered(filter)) {
        await runBatch(argv, filter, ledger, DRY_RUN);
        return;
    }

    // ── A. Business & Finance ────────────────────────────────────────────────
    // Done on 2026-11-01. It writes the scores file whole, with only its 13
    // entries, so it refuses once the file holds anything else.
    if (fs.existsSync(paths().OUT_FILE)) {
        const others = Object.keys(JSON.parse(fs.readFileSync(paths().OUT_FILE, 'utf-8')).scores ?? {}).filter((soc) => !(BF_TARGET_SOCS as readonly string[]).includes(soc));
        if (others.length > 0) {
            fail(`The Business & Finance run (no --family, --fields or --batch) was done on 2026-11-01 and would rewrite ${path.relative(ROOT, paths().OUT_FILE)} with only its 13 entries, dropping ${others.length} others. Refused. Use --family 1|2|3, --fields or --batch kelley.`);
        }
    }
    // ── 1. Confirm the 13 from the data ──────────────────────────────────────
    const inputs = loadPlanInputs(ROOT);
    const uncovered = uncoveredBusinessFinanceSocs(inputs.occupations, kelleySocList());
    const fieldCount = Object.keys(inputs.occupations).length;
    if (JSON.stringify(uncovered) !== JSON.stringify([...BF_TARGET_SOCS])) {
        fail(`The data says the unscored Business & Finance SOCs are:\n    ${uncovered.join(', ')}\nbut the script expects:\n    ${BF_TARGET_SOCS.join(', ')}\nStopped before spending anything.`);
    }
    console.log(`✔  Business & Finance: ${fieldCount} occupations, ${fieldCount - uncovered.length} covered by Kelley roles, ${uncovered.length} to score.`);

    const plans = planAll(inputs);
    checkPlan(plans);

    const published = readPublished();
    const controlCases = kelleyRoleControls(published);

    const sensitivityJobs = SENSITIVITY_JOB_IDS.map((id) => {
        const job = initialJobs.find((j) => j.id === id);
        if (!job || !published.scores[id]) fail(`Sensitivity role ${id} is missing from data.ts or ai_scores.json`);
        const soc = MAP_TITLE_TO_SOC[job.title];
        const epGrowth = inputs.occupations[soc]?.ep?.percentChange;
        if (epGrowth == null) fail(`Sensitivity role ${job.title} (${soc}) has no BLS EP 2025–35 change in 13.json`);
        return { job, soc, epGrowth };
    });
    const pendingControl = controlCases.filter((c) => !ledger.control[c.key]).length;
    const pendingSensitivity = sensitivityJobs.filter((s) => !ledger.sensitivity![s.job.id]).length;
    const pendingScores = plans.filter((p) => !ledger.scores[p.soc]).length;
    console.log(`📒  ${ledger.calls.length} API calls in the ledger · this run may make ${maxCalls} · ${pendingControl} control + ${pendingSensitivity} sensitivity + ${pendingScores} roles still to score.`);

    if (DRY_RUN) {
        for (const p of plans) {
            console.log(`\n${p.soc}  ${p.title}  (${p.rule}; ${p.onetCodes.join(', ')}; employment ${p.employment.toLocaleString()}; growth ${p.projectedGrowth}%)`);
            for (const t of p.tasks) console.log(`    ${t.onetCode} #${t.taskId}  ${t.name}`);
        }
        console.log(`\nControl roles: ${controlCases.map((c) => c.label).join(', ')}`);
        console.log(`Sensitivity roles: ${sensitivityJobs.map((s) => `${s.job.title} (published growth ${s.job.projectedGrowth}%, EP 2025–35 ${s.epGrowth}%)`).join(', ')}`);
        return;
    }
    const needed = pendingControl + pendingSensitivity + pendingScores;
    if (needed > maxCalls) {
        fail(`Not enough calls: --max-calls ${maxCalls} but ${needed} are needed even with no retries.`);
    }

    const auth = getAuth(argv);
    console.log(`    ${CLAUDE_MODEL} · thinking disabled · max_tokens ${MAX_TOKENS} · prompt schema v${CACHE_VERSION}\n`);

    // ── 2. Control run ───────────────────────────────────────────────────────
    const { rows, gapAi, gapHuman, passed } = await runControls(ledger, ledger.control, controlCases, auth);
    if (!passed) {
        fail('Control run failed. The 13 roles were NOT scored. Nothing was written to src/data.', 2);
    }

    // ── 3. Growth sensitivity (report only) ──────────────────────────────────
    console.log('\nGrowth sensitivity (report only, never published, changes nothing):');
    for (const { job, epGrowth } of sensitivityJobs) {
        if (ledger.sensitivity![job.id]) {
            console.log(`·  cached   ${job.title}`);
            continue;
        }
        try {
            ledger.sensitivity![job.id] = await scoreOnce(ledger, 'sensitivity', job.id, `sensitivity: ${job.title} @ EP ${epGrowth}%`, {
                title: job.title,
                taskNames: job.tasks.map((t) => t.name),
                employment: job.employment,
                projectedGrowth: epGrowth,
            }, auth);
        } catch (err) {
            if (!(err instanceof RejectedTwice)) throw err;
            console.log(`✗  ${err.message} Report-only, so the run goes on.`);
        }
        saveLedger(ledger);
        await sleep(RATE_LIMIT_MS);
    }
    console.log('\n| Role | Growth published → EP 2025–35 | Risk published | Risk @ EP | Gap | Human published | Human @ EP | Gap |');
    console.log('|---|---|---:|---:|---:|---:|---:|---:|');
    for (const { job, epGrowth } of sensitivityJobs) {
        const pub = published.scores[job.id];
        const now = ledger.sensitivity![job.id]?.analysis;
        if (!now) {
            console.log(`| ${job.title} | ${job.projectedGrowth}% → ${epGrowth}% | ${(avgAi(pub) * 100).toFixed(1)} | failed | n/a | ${(avgHuman(pub) * 100).toFixed(1)} | failed | n/a |`);
            continue;
        }
        const [pa, na, ph, nh] = [avgAi(pub), avgAi(now), avgHuman(pub), avgHuman(now)].map((v) => v * 100);
        console.log(`| ${job.title} | ${job.projectedGrowth}% → ${epGrowth}% | ${pa.toFixed(1)} | ${na.toFixed(1)} | ${(na - pa).toFixed(1)} | ${ph.toFixed(1)} | ${nh.toFixed(1)} | ${(nh - ph).toFixed(1)} |`);
    }

    // ── 4. The 13 ────────────────────────────────────────────────────────────
    console.log('\nBusiness & Finance occupations:');
    for (const plan of plans) {
        if (ledger.scores[plan.soc]) {
            console.log(`·  cached   ${plan.soc} ${plan.title}`);
            continue;
        }
        ledger.scores[plan.soc] = await scoreOnce(ledger, 'score', plan.soc, `${plan.soc} ${plan.title}`, {
            title: plan.title,
            taskNames: plan.tasks.map((t) => t.name),
            employment: plan.employment,
            projectedGrowth: plan.projectedGrowth,
        }, auth);
        saveLedger(ledger);
        await sleep(RATE_LIMIT_MS);
    }

    const generatedAt = new Date().toISOString();
    const out = {
        version: CACHE_VERSION,
        promptVersion: `src/utils/taskScoring.ts buildJobAnalysisPrompt + parseJobAnalysis, schema v${CACHE_VERSION} (same as src/data/ai_scores.json)`,
        model: CLAUDE_MODEL,
        thinking: 'disabled',
        maxTokens: MAX_TOKENS,
        tasksPerRole: TASKS_PER_ROLE,
        route: 'app proxy /api/claude/messages',
        generatedAt,
        inputs: {
            employment: 'BLS OEWS May 2025 national employment (src/data/occupations/13.json)',
            growth: GROWTH_SOURCE,
            promptGrowthLabel: PROMPT_GROWTH_LABEL,
            growthNote: GROWTH_MISMATCH_NOTE,
        },
        taskSource: `O*NET 30.1 task statements (${TASK_STATEMENTS_PATH}); plan in data/bls_scoring_plan.json`,
        controlRun: {
            roles: rows.map((r) => r.role),
            meanAbsGapRiskPoints: Number(gapAi.toFixed(2)),
            meanAbsGapHumanPoints: Number(gapHuman.toFixed(2)),
            limitPoints: CONTROL_PASS_POINTS,
            passed,
        },
        scores: Object.fromEntries(plans.map((plan) => [plan.soc, scoreEntry(plan, ledger.scores[plan.soc])])),
    };
    fs.writeFileSync(paths().OUT_FILE, JSON.stringify(out, null, 2) + '\n');
    console.log(`\n💾  Wrote ${path.relative(ROOT, paths().OUT_FILE)} — ${plans.length} roles`);

    // Bands exactly as the map draws Kelley hills: the 50 published roles set the scale.
    const scale = buildRiskScale(Object.values(published.scores).map((a) => Number(avgAi(a).toFixed(2))));
    console.log('\n| Title | SOC | Task source | Risk | Human criticality | Band |');
    console.log('|---|---|---|---:|---:|---|');
    for (const plan of plans) {
        const a = ledger.scores[plan.soc].analysis;
        const risk = Number(avgAi(a).toFixed(2));
        console.log(`| ${plan.title} | ${plan.soc} | ${plan.onetCodes.join(' + ')} (${plan.rule}) | ${(risk * 100).toFixed(0)}% | ${(avgHuman(a) * 100).toFixed(0)}% | ${riskBand(risk, scale)} |`);
    }
    reportUsage(ledger);
    console.log('\n✅  Done. Next: npx vitest run, then commit src/data/ai_scores_bls.json.');
}

function reportUsage(ledger: RunLedger): void {
    const t = usageTotals(ledger.calls);
    const ok = ledger.calls.filter((c) => c.outcome === 'ok');
    const perCall = ok.length > 0 ? usageTotals(ok).cost / ok.length : 0;
    console.log(`\nAPI calls: ${callsThisRun} this run (limit ${maxCalls}); ledger ${ledger.calls.length} (${ok.length} ok, ${ledger.calls.length - ok.length} failed)`);
    console.log(`Tokens: ${t.input.toLocaleString()} input + ${t.output.toLocaleString()} output = ${(t.input + t.output).toLocaleString()}`);
    console.log(`Cost at $${PRICE_PER_MTOK.input}/$${PRICE_PER_MTOK.output} per MTok: $${t.cost.toFixed(4)}`);
    if (perCall > 0) console.log(`Average per successful call: $${perCall.toFixed(5)}`);
}

const realPath = (p: string) => {
    try {
        return fs.realpathSync(p);
    } catch {
        return path.resolve(p);
    }
};
const isEntry = !!process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url));
if (isEntry) {
    main().catch((err) => {
        if (err instanceof CallCapReached) {
            if (runLedger) {
                saveLedger(runLedger);
                reportUsage(runLedger);
            }
            console.log(`\n⏸  ${err.message} The ledger is saved; run the same command again to continue.`);
            process.exit(3);
        }
        fail(err instanceof RejectedTwice ? `${err.message} Stopped.` : `Fatal: ${err instanceof Error ? err.message : err}`);
    });
}
