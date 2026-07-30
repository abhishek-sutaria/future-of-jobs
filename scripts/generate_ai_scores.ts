/**
 * generate_ai_scores.ts
 * ---------------------
 * Precomputes Claude task scores + yearly forecasts for every job in
 * src/data.ts and writes them to src/data/ai_scores.json, which the app
 * imports statically so a cold load needs ZERO API calls.
 *
 * Run deliberately (not on deploy) whenever ratings should be refreshed:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run generate-scores
 *
 * No local key? Route through the deployed app's proxy, which holds the key
 * server-side (avoids copying the production secret onto disk):
 *   npm run generate-scores -- --proxy https://futureofjobs.vercel.app/api/claude/messages
 *
 * Add `--limit N` to score only N jobs (cheap validation run).
 *
 * Progress is cached in data/ai_scores_cache.json so an interrupted run
 * resumes instead of re-paying for jobs that already succeeded.
 *
 * Prompt + validation are imported from src/utils/taskScoring.ts rather than
 * duplicated here — the previous Gemini script (scripts/score_tasks.mjs) kept
 * its own copy of the prompt and silently drifted out of sync with the app.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initialJobs } from '../src/data';
import {
    buildJobAnalysisPrompt,
    parseJobAnalysis,
    CACHE_VERSION,
    type JobAnalysisResult,
} from '../src/utils/taskScoring';
import { JobTaskScoringSchema } from '../src/utils/claude';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'ai_scores.json');
const CACHE_FILE = path.join(ROOT, 'data', 'ai_scores_cache.json');
const ENV_FILE = path.join(ROOT, '.env');

// Must mirror src/utils/claude.ts. `thinking: disabled` and max_tokens 4096 are
// deliberate fixes for Sonnet 5 spending the token budget on hidden reasoning
// and truncating the JSON mid-array — do not "simplify" these away.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

const RATE_LIMIT_MS = 1200;
const ATTEMPTS_PER_JOB = 2; // forecast-cap validation can legitimately fail once

/**
 * Two ways to authenticate, so this is runnable without copying the production
 * secret onto disk:
 *   direct — ANTHROPIC_API_KEY in env/.env, calls api.anthropic.com
 *   proxy  — --proxy <url> (or CLAUDE_PROXY_URL), routes through the app's own
 *            /api/claude/messages endpoint, which holds the key server-side
 */
type Auth = { mode: 'direct'; key: string } | { mode: 'proxy'; url: string };

function getAuth(): Auth {
    const proxyFlagIdx = process.argv.indexOf('--proxy');
    const proxyUrl =
        (proxyFlagIdx !== -1 ? process.argv[proxyFlagIdx + 1] : undefined) ?? process.env.CLAUDE_PROXY_URL;
    if (proxyUrl) return { mode: 'proxy', url: proxyUrl };

    let key = process.env.ANTHROPIC_API_KEY;
    if (!key && fs.existsSync(ENV_FILE)) {
        for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('ANTHROPIC_API_KEY=')) {
                key = trimmed.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
                break;
            }
        }
    }
    if (key) return { mode: 'direct', key };

    console.error('\n❌  No Claude credentials found. Use either:');
    console.error('    · a local key:  ANTHROPIC_API_KEY=sk-ant-...  npm run generate-scores');
    console.error('    · the deployed proxy (no local secret needed):');
    console.error('        npm run generate-scores -- --proxy https://futureofjobs.vercel.app/api/claude/messages\n');
    process.exit(1);
}

/** `--limit N` scores only the first N pending jobs (for cheap validation runs). */
function getLimit(): number | null {
    const idx = process.argv.indexOf('--limit');
    if (idx === -1) return null;
    const n = Number(process.argv[idx + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function loadCache(): Record<string, JobAnalysisResult> {
    if (!fs.existsSync(CACHE_FILE)) return {};
    try {
        const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        if (parsed?.version !== CACHE_VERSION) {
            console.log(`ℹ️   Resume cache is v${parsed?.version} but schema is v${CACHE_VERSION} — ignoring it.`);
            return {};
        }
        return parsed.scores ?? {};
    } catch {
        return {};
    }
}

function saveCache(scores: Record<string, JobAnalysisResult>): void {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, scores }, null, 2));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Extracts the JSON object/array from a possibly fenced Claude response. */
function extractJsonBlock(text: string): string {
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const objectStart = cleaned.indexOf('{');
    const arrayStart = cleaned.indexOf('[');
    const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
    if (start === -1) return cleaned;
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (end === -1 || end < start) return cleaned.slice(start);
    return cleaned.slice(start, end + 1);
}

async function scoreJob(
    job: (typeof initialJobs)[number],
    auth: Auth,
): Promise<JobAnalysisResult> {
    const taskNames = job.tasks.map(t => t.name);
    const prompt = buildJobAnalysisPrompt(job.title, taskNames, job.employment, job.projectedGrowth);

    const response = await fetch(auth.mode === 'direct' ? ANTHROPIC_URL : auth.url, {
        method: 'POST',
        headers:
            auth.mode === 'direct'
                ? {
                      'x-api-key': auth.key,
                      'anthropic-version': ANTHROPIC_VERSION,
                      'content-type': 'application/json',
                  }
                : { 'content-type': 'application/json' },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'disabled' },
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Claude ${response.status}: ${body.slice(0, 300)}`);
    }

    const body = await response.json();
    if (body?.stop_reason === 'max_tokens') {
        throw new Error(`response truncated (hit max_tokens=${MAX_TOKENS})`);
    }
    const text: string = (body?.content ?? [])
        .map((part: { text?: string }) => part?.text ?? '')
        .join('\n')
        .trim();
    if (!text) throw new Error('empty response from Claude');

    const parsed = JobTaskScoringSchema.parse(JSON.parse(extractJsonBlock(text)));
    return parseJobAnalysis(parsed, taskNames, job.projectedGrowth);
}

async function main(): Promise<void> {
    console.log('='.repeat(64));
    console.log(`  Precomputing AI scores — ${CLAUDE_MODEL} — schema v${CACHE_VERSION}`);
    console.log('='.repeat(64));

    const auth = getAuth();
    console.log(auth.mode === 'direct' ? '🔑  Using local ANTHROPIC_API_KEY\n' : `🔑  Using proxy ${auth.url}\n`);

    const scores = loadCache();
    const cachedCount = Object.keys(scores).length;
    if (cachedCount > 0) console.log(`📂  Resuming: ${cachedCount} job(s) already scored.\n`);

    const limit = getLimit();
    let pending = initialJobs.filter(j => !scores[j.id]);
    if (limit !== null && pending.length > limit) {
        console.log(`⚠️   --limit ${limit}: scoring only the first ${limit} of ${pending.length} pending job(s).`);
        pending = pending.slice(0, limit);
    }
    console.log(`📝  ${initialJobs.length} jobs total · ${pending.length} to score now\n`);

    const failed: { title: string; reason: string }[] = [];

    for (const [i, job] of pending.entries()) {
        const label = `[${i + 1}/${pending.length}] ${job.title}`;
        let lastError = '';

        for (let attempt = 1; attempt <= ATTEMPTS_PER_JOB; attempt++) {
            try {
                const analysis = await scoreJob(job, auth);
                scores[job.id] = analysis;
                saveCache(scores); // persist incrementally so Ctrl-C is safe
                const avgAi = analysis.tasks.reduce((s, t) => s + t.aiCapabilityScore, 0) / analysis.tasks.length;
                console.log(`✓  ${label.padEnd(46)} risk ${avgAi.toFixed(2)}  ${analysis.tasks.length} tasks`);
                lastError = '';
                break;
            } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
                if (attempt < ATTEMPTS_PER_JOB) {
                    console.log(`↻  ${label.padEnd(46)} retry after: ${lastError.slice(0, 60)}`);
                    await sleep(RATE_LIMIT_MS);
                }
            }
        }

        if (lastError) {
            console.log(`✗  ${label.padEnd(46)} FAILED: ${lastError.slice(0, 80)}`);
            failed.push({ title: job.title, reason: lastError });
        }

        if (i < pending.length - 1) await sleep(RATE_LIMIT_MS);
    }

    // Write the app-facing file (only jobs that actually have scores).
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(
        OUT_FILE,
        JSON.stringify(
            {
                version: CACHE_VERSION,
                model: CLAUDE_MODEL,
                generatedAt: new Date().toISOString(),
                scores,
            },
            null,
            2,
        ) + '\n',
    );

    const total = Object.keys(scores).length;
    console.log('\n' + '-'.repeat(64));
    console.log(`💾  Wrote ${path.relative(ROOT, OUT_FILE)} — ${total}/${initialJobs.length} jobs`);
    if (failed.length > 0) {
        console.log(`\n⚠️   ${failed.length} job(s) failed:`);
        for (const f of failed) console.log(`     · ${f.title}: ${f.reason.slice(0, 100)}`);
        console.log('\n    Re-run to retry only the failures (successes are kept in the resume cache).');
        process.exit(1);
    }

    // Drop the resume cache on a clean run. It exists to survive an interrupted
    // run — keeping it would make the *next* run skip every job and merely
    // re-stamp identical scores, defeating the point of re-running to refresh.
    if (limit === null && fs.existsSync(CACHE_FILE)) {
        fs.rmSync(CACHE_FILE);
    }
    console.log('✅  All jobs scored. Commit src/data/ai_scores.json so deploys include it.');
}

main().catch(err => {
    console.error('\nFatal:', err instanceof Error ? err.message : err);
    process.exit(1);
});
