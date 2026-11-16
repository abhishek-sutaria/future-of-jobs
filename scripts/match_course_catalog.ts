/**
 * Matches catalog courses to the 783 scored jobs (Step 2 of 3). Offline data
 * only: writes data/course_catalog/matches.json, which nothing in the app reads
 * yet. Method in scripts/lib/courseMatch.ts; results in docs/course-matches.md.
 *
 *   npx tsx scripts/match_course_catalog.ts --shortlist 13-2011     print one job's 30 candidates (no API)
 *   npx tsx scripts/match_course_catalog.ts --estimate              count every request's input tokens (free endpoint), estimate the cost
 *   npx tsx scripts/match_course_catalog.ts --pilot                 one batch: the 20 pilot jobs
 *   npx tsx scripts/match_course_catalog.ts --run --max-usd 10      one batch: every job without a current answer, only if the estimate is under the cap
 *   npx tsx scripts/match_course_catalog.ts --run --socs a,b,c      re-run these jobs (replaces their answers)
 *   npx tsx scripts/match_course_catalog.ts --resume <batch id>     collect a batch that was submitted earlier
 *   npx tsx scripts/match_course_catalog.ts                         rebuild matches.json from the saved answers (no API)
 *
 * Calls api.anthropic.com directly with the scoring key (scripts/lib/scoringAuth.ts:
 * FOJ_SCORING_API_KEY / ~/.foj_scoring_key and the workspace ID). Model: the
 * app's claude-sonnet-5, through the Message Batches API (half price). Every
 * run's tokens and dollars go into data/course_catalog/match_runs.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTHROPIC_VERSION } from './lib/claudeScoring';
import { loadDirectAuth } from './lib/scoringAuth';
import type { CatalogEntry } from './lib/courseCatalog';
import {
    assembleMatches,
    buildIndex,
    buildProfiles,
    checkPicks,
    costUsd,
    coverage,
    customIdFor,
    MATCH_MODEL,
    MATCH_PATHS,
    matchProblems,
    parseAnswer,
    PILOT_SOCS,
    PROMPT_VERSION,
    readOnetTsv,
    requestParams,
    sha256,
    shortlist,
    socForCustomId,
    usable,
    type JobProfile,
    type SavedResponse,
} from './lib/courseMatch';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const abs = (rel: string) => path.join(ROOT, rel);
const readJson = <T>(rel: string, fallback?: T): T => {
    if (fallback !== undefined && !fs.existsSync(abs(rel))) return fallback;
    return JSON.parse(fs.readFileSync(abs(rel), 'utf8')) as T;
};
const writeJson = (rel: string, data: unknown) => fs.writeFileSync(abs(rel), `${JSON.stringify(data, null, 2)}\n`);
const log = (msg: string) => console.log(`[match] ${msg}`);

// ── Inputs ──────────────────────────────────────────────────────────────────

interface Inputs { jobs: JobProfile[]; catalog: CatalogEntry[]; byId: Map<string, CatalogEntry> }

function loadInputs(): Inputs {
    const scored = readJson<{ scores: Record<string, { title: string; onetCodes: string[] }> }>(MATCH_PATHS.scores).scores;
    const jobs = buildProfiles(
        scored,
        readOnetTsv(fs.readFileSync(abs(MATCH_PATHS.tasks), 'utf8')),
        readOnetTsv(fs.readFileSync(abs(MATCH_PATHS.technology), 'utf8')),
        readOnetTsv(fs.readFileSync(abs(MATCH_PATHS.occupations), 'utf8')),
    ).sort((a, b) => a.soc.localeCompare(b.soc));
    const catalog = readJson<{ entries: CatalogEntry[] }>(MATCH_PATHS.catalog).entries;
    return { jobs, catalog, byId: new Map(catalog.map((e) => [e.id, e])) };
}

interface Prepared { job: JobProfile; shortlist: string[]; params: ReturnType<typeof requestParams>; promptSha256: string }

function prepare(inputs: Inputs, socs: string[]): Prepared[] {
    const index = buildIndex(inputs.catalog.filter(usable));
    const want = new Set(socs);
    return inputs.jobs.filter((j) => want.has(j.soc)).map((job) => {
        const ids = shortlist(index, job).map((s) => s.id);
        const params = requestParams(job, ids.map((id) => inputs.byId.get(id)!));
        return { job, shortlist: ids, params, promptSha256: sha256(JSON.stringify(params)) };
    });
}

// ── API ─────────────────────────────────────────────────────────────────────

const API = 'https://api.anthropic.com/v1';

function headers(): Record<string, string> {
    const auth = loadDirectAuth();
    return { 'x-api-key': auth.key, 'anthropic-workspace-id': auth.workspace, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' };
}

async function api<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
        if (res.ok) return (await res.json()) as T;
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
            continue;
        }
        throw new Error(`${method} ${url.replace(API, '')}: ${res.status} ${text.slice(0, 400)}`);
    }
}

async function countTokens(p: Prepared): Promise<number> {
    const { max_tokens: _maxTokens, ...countable } = p.params;
    void _maxTokens;
    const r = await api<{ input_tokens: number }>('POST', `${API}/messages/count_tokens`, countable);
    return r.input_tokens;
}

async function countAll(list: Prepared[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (i < list.length) {
            const p = list[i++];
            out.set(p.job.soc, await countTokens(p));
            if (out.size % 100 === 0) log(`counted ${out.size}/${list.length}`);
        }
    }));
    return out;
}

// ── Runs ledger ─────────────────────────────────────────────────────────────

interface Run {
    run: string;
    kind: 'estimate' | 'pilot' | 'run' | 'rerun';
    promptVersion: string;
    model: string;
    at: string;
    jobs: number;
    batchId?: string;
    status?: 'submitted' | 'ended';
    endedAt?: string;
    succeeded?: number;
    errored?: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    note?: string;
    socs?: string[];
}
interface Ledger { _about: string; pricing: string; runs: Run[]; totalCostUsd: number }

function ledger(): Ledger {
    return readJson<Ledger>(MATCH_PATHS.runs, {
        _about: 'Every Claude API use of scripts/match_course_catalog.ts: token counts (free) and batches (billed), with the real tokens and dollars from each batch\'s usage.',
        pricing: 'claude-sonnet-5 via Message Batches: $1 per million input tokens, $5 per million output tokens (50% of list).',
        runs: [],
        totalCostUsd: 0,
    });
}
function saveLedger(l: Ledger) {
    l.totalCostUsd = Math.round(l.runs.reduce((a, r) => a + r.costUsd, 0) * 1e6) / 1e6;
    writeJson(MATCH_PATHS.runs, l);
}

// ── Estimate ────────────────────────────────────────────────────────────────

/** Output tokens per job assumed before any real answers exist (5 picks with reasons ≈ 300); after a pilot, the pilot's own average. */
function outputPerJob(responses: Record<string, SavedResponse>): { perJob: number; basis: string } {
    const real = Object.values(responses).filter((r) => r.promptVersion === PROMPT_VERSION && !r.error);
    if (real.length >= 10) {
        const avg = real.reduce((a, r) => a + r.usage.output_tokens, 0) / real.length;
        return { perJob: Math.ceil(avg), basis: `average of ${real.length} real answers` };
    }
    return { perJob: 300, basis: 'assumed 300 (5 picks with reasons), no real answers yet' };
}

async function estimate(inputs: Inputs, socs: string[], record = true) {
    const list = prepare(inputs, socs);
    const counts = await countAll(list);
    const input = [...counts.values()].reduce((a, b) => a + b, 0);
    const { perJob, basis } = outputPerJob(readJson<Record<string, SavedResponse>>(MATCH_PATHS.responses, {}));
    const typical = costUsd(input, perJob * list.length);
    const worst = costUsd(input, 1024 * list.length);
    log(`${list.length} requests: ${input.toLocaleString()} input tokens (${Math.round(input / list.length)} per job). Output ${basis}.`);
    log(`estimate: $${typical.toFixed(2)} (worst case, every answer at max_tokens: $${worst.toFixed(2)})`);
    if (record) {
        const l = ledger();
        l.runs.push({ run: `estimate-${new Date().toISOString()}`, kind: 'estimate', promptVersion: PROMPT_VERSION, model: MATCH_MODEL, at: new Date().toISOString(), jobs: list.length, inputTokens: 0, outputTokens: 0, costUsd: 0, note: `count_tokens (free): ${input} input tokens; estimated batch cost $${typical.toFixed(4)} (output ${basis}); worst case $${worst.toFixed(4)}` });
        saveLedger(l);
    }
    return { input, typical, worst, list };
}

// ── Batches ─────────────────────────────────────────────────────────────────

interface Batch { id: string; processing_status: string; request_counts: Record<string, number>; results_url: string | null; ended_at?: string | null }

async function submit(list: Prepared[], kind: Run['kind']): Promise<string> {
    const batch = await api<Batch>('POST', `${API}/messages/batches`, {
        requests: list.map((p) => ({ custom_id: customIdFor(p.job.soc), params: p.params })),
    });
    const l = ledger();
    l.runs.push({ run: batch.id, kind, promptVersion: PROMPT_VERSION, model: MATCH_MODEL, at: new Date().toISOString(), jobs: list.length, batchId: batch.id, status: 'submitted', inputTokens: 0, outputTokens: 0, costUsd: 0, socs: list.map((p) => p.job.soc) });
    saveLedger(l);
    // Remember exactly what was asked, so --resume can check the answers against the same shortlists.
    const pendingDir = abs('.cache/course_matches');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, `${batch.id}.json`), JSON.stringify(list.map((p) => ({ soc: p.job.soc, title: p.job.title, shortlist: p.shortlist, promptSha256: p.promptSha256 }))));
    log(`submitted ${batch.id} (${list.length} requests)`);
    return batch.id;
}

async function collect(batchId: string): Promise<void> {
    let batch: Batch;
    const started = Date.now();
    for (;;) {
        batch = await api<Batch>('GET', `${API}/messages/batches/${batchId}`);
        if (batch.processing_status === 'ended') break;
        log(`${batchId}: ${batch.processing_status} ${JSON.stringify(batch.request_counts)} (${Math.round((Date.now() - started) / 1000)} s)`);
        await new Promise((r) => setTimeout(r, 30_000));
    }
    const res = await fetch(batch.results_url ?? `${API}/messages/batches/${batchId}/results`, { headers: headers() });
    if (!res.ok) throw new Error(`results: ${res.status}`);
    const lines = (await res.text()).split('\n').filter(Boolean);
    const asked = new Map((JSON.parse(fs.readFileSync(abs(`.cache/course_matches/${batchId}.json`), 'utf8')) as { soc: string; title: string; shortlist: string[]; promptSha256: string }[]).map((a) => [a.soc, a]));
    const responses = readJson<Record<string, SavedResponse>>(MATCH_PATHS.responses, {});
    let input = 0;
    let output = 0;
    let ok = 0;
    let bad = 0;
    for (const line of lines) {
        const r = JSON.parse(line) as { custom_id: string; result: { type: string; message?: { content: { type: string; text?: string }[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; model: string }; error?: unknown } };
        const soc = socForCustomId(r.custom_id);
        const a = soc ? asked.get(soc) : undefined;
        if (!soc || !a) { log(`unknown custom_id ${r.custom_id}`); continue; }
        const usage = r.result.message?.usage ?? { input_tokens: 0, output_tokens: 0 };
        input += usage.input_tokens;
        output += usage.output_tokens;
        const base = { soc, title: a.title, promptVersion: PROMPT_VERSION, model: r.result.message?.model ?? MATCH_MODEL, batchId, run: batchId, promptSha256: a.promptSha256, shortlist: a.shortlist, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } };
        if (r.result.type !== 'succeeded' || !r.result.message) {
            bad++;
            responses[soc] = { ...base, kept: [], rejected: [], error: `${r.result.type}: ${JSON.stringify(r.result.error ?? '').slice(0, 200)}` };
            continue;
        }
        try {
            const checked = checkPicks(parseAnswer(r.result.message), a.shortlist);
            responses[soc] = { ...base, ...checked };
            ok++;
        } catch (err) {
            bad++;
            responses[soc] = { ...base, kept: [], rejected: [], error: err instanceof Error ? err.message : String(err) };
        }
    }
    const sorted = Object.fromEntries(Object.entries(responses).sort(([x], [y]) => x.localeCompare(y)));
    writeJson(MATCH_PATHS.responses, sorted);
    const l = ledger();
    const run = l.runs.find((x) => x.batchId === batchId);
    if (run) Object.assign(run, { status: 'ended', endedAt: batch.ended_at ?? new Date().toISOString(), succeeded: ok, errored: bad, inputTokens: input, outputTokens: output, costUsd: Math.round(costUsd(input, output) * 1e6) / 1e6 });
    saveLedger(l);
    log(`${batchId}: ${ok} answered, ${bad} failed; ${input.toLocaleString()} input + ${output.toLocaleString()} output tokens = $${costUsd(input, output).toFixed(4)} (${Math.round((Date.now() - started) / 1000)} s)`);
}

// ── Assemble ────────────────────────────────────────────────────────────────

function assemble(inputs: Inputs): void {
    const responses = readJson<Record<string, SavedResponse>>(MATCH_PATHS.responses, {});
    const ids = new Set(inputs.catalog.map((e) => e.id));
    const { matches, missing } = assembleMatches(responses, inputs.jobs.map((j) => j.soc), ids);
    const problems = matchProblems(matches, ids);
    if (problems.length) throw new Error(`matches.json would be invalid:\n${problems.join('\n')}`);
    const l = ledger();
    const withMatch = Object.values(matches).filter((m) => m.length > 0).length;
    writeJson(MATCH_PATHS.matches, {
        _meta: {
            about: 'Catalog courses matched to the scored jobs (Step 2). Keyed by SOC code; [] means no catalog course truly fits (the app keeps its #99 course buttons there). Built by scripts/match_course_catalog.ts; see docs/course-matches.md. Every id is in data/course_catalog/catalog.json.',
            promptVersion: PROMPT_VERSION,
            answersByPromptVersion: Object.values(responses).filter((r) => matches[r.soc]).reduce<Record<string, number>>((a, r) => ({ ...a, [r.promptVersion]: (a[r.promptVersion] ?? 0) + 1 }), {}),
            olderEmptyAnswersKept: 'Jobs v2 found no match for were not asked again under v3 (a stricter prompt cannot add a match); their [] is kept.',
            model: MATCH_MODEL,
            batches: [...new Set(Object.values(responses).filter((r) => matches[r.soc]).map((r) => r.batchId))].sort(),
            jobs: Object.keys(matches).length,
            jobsWithMatches: withMatch,
            matches: Object.values(matches).reduce((a, m) => a + m.length, 0),
            missing,
            totalCostUsd: l.totalCostUsd,
        },
        matches,
    });
    log(`matches.json: ${Object.keys(matches).length} jobs, ${withMatch} with at least one match, ${missing.length} without an answer yet`);
    for (const c of coverage(matches)) log(`  ${c.group} ${c.name}: ${c.matched}/${c.jobs} matched, ${c.none} none`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const val = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const inputs = loadInputs();
    log(`${inputs.jobs.length} scored jobs, ${inputs.catalog.length} catalog entries, prompt ${PROMPT_VERSION}, model ${MATCH_MODEL}`);

    if (val('--shortlist')) {
        const [p] = prepare(inputs, [val('--shortlist')!]);
        if (!p) throw new Error('no such scored SOC');
        console.log(p.params.messages[0].content);
        return;
    }
    if (args.includes('--estimate')) {
        await estimate(inputs, inputs.jobs.map((j) => j.soc));
        return;
    }
    if (val('--resume')) {
        await collect(val('--resume')!);
        assemble(inputs);
        return;
    }
    if (args.includes('--pilot') || args.includes('--run')) {
        const pilot = args.includes('--pilot');
        const responses = readJson<Record<string, SavedResponse>>(MATCH_PATHS.responses, {});
        const named = val('--socs')?.split(',').map((s) => s.trim()).filter(Boolean);
        const socs = pilot ? PILOT_SOCS : named ?? inputs.jobs.map((j) => j.soc).filter((s) => responses[s]?.promptVersion !== PROMPT_VERSION || responses[s]?.error);
        if (socs.length === 0) { log('nothing to run'); assemble(inputs); return; }
        const cap = Number(val('--max-usd') ?? (pilot ? 1 : 10));
        const est = await estimate(inputs, socs);
        if (est.typical >= cap) {
            log(`STOP: estimated $${est.typical.toFixed(2)} is not under the $${cap} cap; nothing submitted.`);
            process.exitCode = 2;
            return;
        }
        const id = await submit(est.list, pilot ? 'pilot' : named ? 'rerun' : 'run');
        await collect(id);
        assemble(inputs);
        return;
    }
    assemble(inputs);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
