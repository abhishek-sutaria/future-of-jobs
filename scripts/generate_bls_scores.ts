/**
 * generate_bls_scores.ts
 * ----------------------
 * AI scores for the 13 Business & Finance occupations (SOC major 13) that no
 * Kelley role covers, so the whole field can be shown in colour. Same method as
 * the published 50 (scripts/generate_ai_scores.ts): claude-sonnet-5, the shared
 * buildJobAnalysisPrompt + parseJobAnalysis, thinking disabled, max_tokens 4096,
 * 5 O*NET tasks per role. See scripts/lib/claudeScoring.ts and scripts/lib/blsTasks.ts.
 *
 *   npm run generate-bls-scores -- --proxy https://futureofjobs.vercel.app/api/claude/messages
 *
 * Steps, each stopping the run on failure except step 3:
 *   1. Confirm from the data that exactly these 13 SOCs lack a Kelley role, and
 *      that the task plan matches the committed data/bls_scoring_plan.json.
 *   2. Control: re-score 5 published Kelley roles and compare each role's
 *      average aiCapabilityScore and humanCriticalityScore with ai_scores.json.
 *      Passes only if the mean absolute gap is ≤ 5 points (0–100) on BOTH.
 *      Control scores are never written to the app or adjusted in any way.
 *   3. Growth sensitivity (report only): re-score 2 published Kelley roles with
 *      their stored tasks and employment but their BLS EP 2025–35 growth, the
 *      vintage the 13 use, and print them against published. Never published,
 *      and nothing is changed because of them. A role rejected twice shows as
 *      failed in the table and the run goes on; a proxy failure still stops it.
 *   4. Score the 13 and write src/data/ai_scores_bls.json — all 13 or nothing.
 *
 * Only the proxy route is accepted (no local key). Any HTTP failure stops the
 * run at once. A response that fails parsing or the forecast rules gets one
 * retry, as in generate_ai_scores.ts. Every stop prints calls, tokens and cost.
 * Hard limit: 30 API calls in total across
 * every run, retries included, counted in data/ai_scores_bls_run.json, which
 * also caches each success so a rerun never pays twice. Never delete that file
 * to "reset" the limit.
 *
 * Flags:
 *   --plan      rewrite data/bls_scoring_plan.json from the committed data (no API calls)
 *   --dry-run   print the plan, control roles and call budget, then exit (no API calls)
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'ai_scores_bls.json');
const PUBLISHED_FILE = path.join(ROOT, 'src', 'data', 'ai_scores.json');
const PLAN_FILE = path.join(ROOT, 'data', 'bls_scoring_plan.json');
const RUN_FILE = path.join(ROOT, 'data', 'ai_scores_bls_run.json');

export const MAX_API_CALLS = 30;
const ATTEMPTS_PER_ROLE = 2;
const RATE_LIMIT_MS = 1200;
const CONTROL_PASS_POINTS = 5;
/** claude-sonnet-5 list price, USD per million tokens. */
const PRICE_PER_MTOK = { input: 2, output: 10 } as const;
const REMAINING_JOBS = 770;

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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const avgAi = (a: JobAnalysisResult) => mean(a.tasks.map((t) => t.aiCapabilityScore));
const avgHuman = (a: JobAnalysisResult) => mean(a.tasks.map((t) => t.humanCriticalityScore));

/** Thrown when a role's responses are rejected on every attempt. Stops the run unless a step catches it. */
class RejectedTwice extends Error {}

/** Set as soon as the ledger loads, so every stop can print what was spent. */
let runLedger: RunLedger | null = null;

function fail(message: string, code = 1): never {
    if (runLedger) reportUsage(runLedger);
    console.error(`\n❌  ${message}\n`);
    process.exit(code);
}

function getProxyAuth(): Auth {
    const i = process.argv.indexOf('--proxy');
    const url = (i !== -1 ? process.argv[i + 1] : undefined) ?? process.env.CLAUDE_PROXY_URL;
    if (!url || url.startsWith('--')) {
        fail('This script only runs through the app proxy. Add:\n    --proxy https://futureofjobs.vercel.app/api/claude/messages');
    }
    return { mode: 'proxy', url };
}

/** claude-sonnet-5 itself (bare or dated), never another model that shares the prefix. */
const isExpectedModel = (m: string | null) => m === CLAUDE_MODEL || (!!m && new RegExp(`^${CLAUDE_MODEL}-\\d{8}$`).test(m));

function loadLedger(): RunLedger {
    if (!fs.existsSync(RUN_FILE)) return { version: CACHE_VERSION, calls: [], control: {}, sensitivity: {}, scores: {} };
    const parsed = JSON.parse(fs.readFileSync(RUN_FILE, 'utf-8')) as RunLedger;
    if (parsed.version !== CACHE_VERSION) {
        // Keep the call count (money already spent) but drop results scored under another schema.
        return { version: CACHE_VERSION, calls: parsed.calls ?? [], control: {}, sensitivity: {}, scores: {} };
    }
    return { ...parsed, sensitivity: parsed.sensitivity ?? {} };
}

function saveLedger(ledger: RunLedger): void {
    fs.writeFileSync(RUN_FILE, JSON.stringify(ledger, null, 2) + '\n');
}

function usageTotals(calls: CallRecord[]) {
    const input = calls.reduce((s, c) => s + (c.usage?.input_tokens ?? 0) + (c.usage?.cache_creation_input_tokens ?? 0) + (c.usage?.cache_read_input_tokens ?? 0), 0);
    const output = calls.reduce((s, c) => s + (c.usage?.output_tokens ?? 0), 0);
    const cost = (input * PRICE_PER_MTOK.input + output * PRICE_PER_MTOK.output) / 1e6;
    return { input, output, cost };
}

/**
 * One role, up to ATTEMPTS_PER_ROLE calls. Every call is written to the ledger
 * before the next step, so an interrupted run still counts what it spent.
 */
async function scoreOnce(ledger: RunLedger, kind: Kind, key: string, label: string, job: JobInput, auth: Auth): Promise<CachedResult> {
    const prompt = buildJobAnalysisPrompt(job.title, job.taskNames, job.employment, job.projectedGrowth);
    let lastError = '';
    for (let attempt = 1; attempt <= ATTEMPTS_PER_ROLE; attempt++) {
        if (ledger.calls.length >= MAX_API_CALLS) {
            saveLedger(ledger);
            fail(`Call limit reached: ${ledger.calls.length} of ${MAX_API_CALLS} API calls already made. Stopping before ${label}.`);
        }
        const record: CallRecord = { n: ledger.calls.length + 1, at: new Date().toISOString(), kind, key, attempt, outcome: 'ok', model: null, usage: null };
        ledger.calls.push(record);
        try {
            const { analysis, usage, model } = await scoreWithClaude(job, auth);
            record.usage = usage;
            record.model = model;
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
            console.log(`✓  [call ${record.n}/${MAX_API_CALLS}] ${label.padEnd(52)} risk ${avgAi(analysis).toFixed(2)}  human ${avgHuman(analysis).toFixed(2)}`);
            return { analysis, model, scoredAt: record.at, promptSha256: sha256(prompt) };
        } catch (err) {
            if (err instanceof TransportError) {
                record.outcome = 'transport-error';
                record.error = err.message;
                saveLedger(ledger);
                fail(`${label}: the proxy call failed — ${err.message}\n    Stopped. No retry for a proxy or HTTP failure.`);
            }
            record.outcome = 'response-error';
            record.error = err instanceof Error ? err.message : String(err);
            if (err instanceof ResponseError) {
                record.usage ??= err.usage;
                record.model ??= err.model;
            }
            saveLedger(ledger);
            lastError = record.error;
            console.log(`↻  [call ${record.n}/${MAX_API_CALLS}] ${label.padEnd(52)} response rejected: ${lastError.slice(0, 80)}`);
            if (attempt < ATTEMPTS_PER_ROLE) await sleep(RATE_LIMIT_MS);
        }
    }
    throw new RejectedTwice(`${label}: ${ATTEMPTS_PER_ROLE} responses in a row failed validation (last: ${lastError}).`);
}

function checkPlan(plans: RolePlan[]): void {
    const fresh = JSON.stringify(plans, null, 2);
    if (!fs.existsSync(PLAN_FILE)) fail(`${path.relative(ROOT, PLAN_FILE)} is missing. Run with --plan, review it and commit it first.`);
    const committed = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
    if (JSON.stringify(committed.roles, null, 2) !== fresh) {
        fail(`${path.relative(ROOT, PLAN_FILE)} does not match the committed O*NET/BLS data. Re-run --plan and review the diff.`);
    }
}

function writePlan(plans: RolePlan[]): void {
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
    fs.writeFileSync(PLAN_FILE, JSON.stringify(file, null, 2) + '\n');
    console.log(`💾  Wrote ${path.relative(ROOT, PLAN_FILE)}`);
}

async function main(): Promise<void> {
    const PLAN_ONLY = process.argv.includes('--plan');
    const DRY_RUN = process.argv.includes('--dry-run');
    const ledger = loadLedger();
    runLedger = ledger;

    // ── 1. Confirm the 13 from the data ──────────────────────────────────────
    const inputs = loadPlanInputs(ROOT);
    const kelleySocs = initialJobs.map((j) => {
        const soc = MAP_TITLE_TO_SOC[j.title];
        if (!soc) fail(`Kelley role "${j.title}" has no SOC`);
        return soc;
    });
    const uncovered = uncoveredBusinessFinanceSocs(inputs.occupations, kelleySocs);
    const fieldCount = Object.keys(inputs.occupations).length;
    if (JSON.stringify(uncovered) !== JSON.stringify([...BF_TARGET_SOCS])) {
        fail(`The data says the unscored Business & Finance SOCs are:\n    ${uncovered.join(', ')}\nbut the script expects:\n    ${BF_TARGET_SOCS.join(', ')}\nStopped before spending anything.`);
    }
    console.log(`✔  Business & Finance: ${fieldCount} occupations, ${fieldCount - uncovered.length} covered by Kelley roles, ${uncovered.length} to score.`);

    const plans = planAll(inputs);
    if (PLAN_ONLY) {
        writePlan(plans);
        return;
    }
    checkPlan(plans);

    const published = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8')) as { scores: Record<string, JobAnalysisResult> };
    const controlJobs = CONTROL_JOB_IDS.map((id) => {
        const job = initialJobs.find((j) => j.id === id);
        if (!job || !published.scores[id]) fail(`Control role ${id} is missing from data.ts or ai_scores.json`);
        return job;
    });

    const sensitivityJobs = SENSITIVITY_JOB_IDS.map((id) => {
        const job = initialJobs.find((j) => j.id === id);
        if (!job || !published.scores[id]) fail(`Sensitivity role ${id} is missing from data.ts or ai_scores.json`);
        const soc = MAP_TITLE_TO_SOC[job.title];
        const epGrowth = inputs.occupations[soc]?.ep?.percentChange;
        if (epGrowth == null) fail(`Sensitivity role ${job.title} (${soc}) has no BLS EP 2025–35 change in 13.json`);
        return { job, soc, epGrowth };
    });
    const pendingControl = controlJobs.filter((j) => !ledger.control[j.id]).length;
    const pendingSensitivity = sensitivityJobs.filter((s) => !ledger.sensitivity![s.job.id]).length;
    const pendingScores = plans.filter((p) => !ledger.scores[p.soc]).length;
    console.log(`📒  ${ledger.calls.length} of ${MAX_API_CALLS} API calls used so far · ${pendingControl} control + ${pendingSensitivity} sensitivity + ${pendingScores} roles still to score.`);

    if (DRY_RUN) {
        for (const p of plans) {
            console.log(`\n${p.soc}  ${p.title}  (${p.rule}; ${p.onetCodes.join(', ')}; employment ${p.employment.toLocaleString()}; growth ${p.projectedGrowth}%)`);
            for (const t of p.tasks) console.log(`    ${t.onetCode} #${t.taskId}  ${t.name}`);
        }
        console.log(`\nControl roles: ${controlJobs.map((j) => j.title).join(', ')}`);
        console.log(`Sensitivity roles: ${sensitivityJobs.map((s) => `${s.job.title} (published growth ${s.job.projectedGrowth}%, EP 2025–35 ${s.epGrowth}%)`).join(', ')}`);
        return;
    }
    const needed = pendingControl + pendingSensitivity + pendingScores;
    if (ledger.calls.length + needed > MAX_API_CALLS) {
        fail(`Not enough calls left: ${MAX_API_CALLS - ledger.calls.length} remain but ${needed} are needed even with no retries.`);
    }

    const auth = getProxyAuth();
    console.log(`🔑  Proxy ${auth.mode === 'proxy' ? auth.url : ''} · ${CLAUDE_MODEL} · thinking disabled · max_tokens ${MAX_TOKENS} · prompt schema v${CACHE_VERSION}\n`);

    // ── 2. Control run ───────────────────────────────────────────────────────
    console.log('Control run (never published):');
    for (const job of controlJobs) {
        if (ledger.control[job.id]) {
            console.log(`·  cached   ${job.title}`);
            continue;
        }
        ledger.control[job.id] = await scoreOnce(ledger, 'control', job.id, `control: ${job.title}`, {
            title: job.title,
            taskNames: job.tasks.map((t) => t.name),
            employment: job.employment,
            projectedGrowth: job.projectedGrowth,
        }, auth);
        saveLedger(ledger);
        await sleep(RATE_LIMIT_MS);
    }

    const rows = controlJobs.map((job) => {
        const pub = published.scores[job.id];
        const now = ledger.control[job.id].analysis;
        return {
            role: job.title,
            publishedAi: avgAi(pub) * 100,
            newAi: avgAi(now) * 100,
            publishedHuman: avgHuman(pub) * 100,
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
        scores: Object.fromEntries(plans.map((plan) => {
            const r = ledger.scores[plan.soc];
            return [plan.soc, {
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
            }];
        })),
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
    console.log(`\n💾  Wrote ${path.relative(ROOT, OUT_FILE)} — ${plans.length} roles`);

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
    console.log('\n✅  Done. Next: npx vitest run, then regenerate public/student-guide.pdf and commit src/data/ai_scores_bls.json.');
}

function reportUsage(ledger: RunLedger): void {
    const t = usageTotals(ledger.calls);
    const ok = ledger.calls.filter((c) => c.outcome === 'ok');
    const perCall = ok.length > 0 ? usageTotals(ok).cost / ok.length : 0;
    console.log(`\nAPI calls: ${ledger.calls.length} (${ok.length} ok, ${ledger.calls.length - ok.length} failed) of ${MAX_API_CALLS}`);
    console.log(`Tokens: ${t.input.toLocaleString()} input + ${t.output.toLocaleString()} output = ${(t.input + t.output).toLocaleString()}`);
    console.log(`Cost at $${PRICE_PER_MTOK.input}/$${PRICE_PER_MTOK.output} per MTok: $${t.cost.toFixed(4)}`);
    if (perCall > 0) {
        console.log(`Remaining ${REMAINING_JOBS} jobs at $${perCall.toFixed(5)}/call: ~$${(perCall * REMAINING_JOBS).toFixed(2)} (Batch API at 50% off: ~$${(perCall * REMAINING_JOBS / 2).toFixed(2)})`);
    }
}

main().catch((err) => {
    fail(err instanceof RejectedTwice ? `${err.message} Stopped.` : `Fatal: ${err instanceof Error ? err.message : err}`);
});
