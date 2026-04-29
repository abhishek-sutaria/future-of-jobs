/**
 * score_tasks.mjs
 * ---------------
 * Reads every task from src/data.ts, calls Gemini to score each one
 * (aiCapabilityScore + humanCriticalityScore), then writes the scores
 * back into data.ts in place.
 *
 * Run once after setting VITE_GEMINI_API_KEY in .env:
 *   npm run score-tasks
 *
 * Results are cached in data/task_scores_cache.json so re-runs are free.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_TS = path.join(ROOT, 'src', 'data.ts');
const CACHE_FILE = path.join(ROOT, 'data', 'task_scores_cache.json');
const ENV_FILE = path.join(ROOT, '.env');

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const RATE_LIMIT_MS = 1200; // ~50 req/min on free tier

// ── Helpers ────────────────────────────────────────────────────────────────

function getApiKey() {
    let key = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!key && fs.existsSync(ENV_FILE)) {
        for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
            if (line.startsWith('VITE_GEMINI_API_KEY=')) {
                key = line.split('=')[1].trim();
                break;
            }
        }
    }
    if (!key || key === 'YOUR_GEMINI_API_KEY') {
        console.error('❌  VITE_GEMINI_API_KEY not set in .env');
        process.exit(1);
    }
    return key;
}

function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } catch {}
    }
    return {};
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function scoreTask(taskText, apiKey) {
    const prompt = `You are an expert in labor economics and AI capabilities.
Analyze this specific job task and return two scores between 0.0 and 1.0:

Task: "${taskText}"

1. aiCapabilityScore: How easily can current GenAI/LLMs automate this task?
   (0.0 = impossible for AI, 1.0 = trivially automated today)
2. humanCriticalityScore: How essential is human judgment, empathy, or physical presence?
   (0.0 = not needed at all, 1.0 = absolutely requires a human)

Return ONLY valid JSON, no markdown:
{ "aiCapabilityScore": 0.0, "humanCriticalityScore": 0.0 }`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Gemini API error ${res.status}: ${err.error?.message}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[^}]+\}/);
    if (!match) throw new Error(`Could not parse JSON from: ${text.slice(0, 100)}`);
    return JSON.parse(match[0]);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('═'.repeat(60));
    console.log('  Gemini Task Scoring Pipeline');
    console.log('═'.repeat(60));

    const apiKey = getApiKey();
    console.log(`🔑  API key found: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}\n`);

    const cache = loadCache();
    console.log(`📂  Loaded ${Object.keys(cache).length} cached scores\n`);

    // Extract all unique task names from data.ts
    const src = fs.readFileSync(DATA_TS, 'utf-8');
    const taskNames = [...new Set([...src.matchAll(/"name":\s*"([^"]+)"/g)].map(m => m[1]))];
    console.log(`📝  Found ${taskNames.length} unique tasks in data.ts\n`);

    // Score any uncached tasks
    let newScores = 0;
    for (const task of taskNames) {
        if (cache[task]) continue;

        process.stdout.write(`   Scoring: ${task.slice(0, 55).padEnd(55)} `);
        try {
            const scores = await scoreTask(task, apiKey);
            cache[task] = scores;
            newScores++;
            console.log(`✓  AI:${scores.aiCapabilityScore.toFixed(2)}  Human:${scores.humanCriticalityScore.toFixed(2)}`);

            // Save incrementally every 5 tasks
            if (newScores % 5 === 0) saveCache(cache);
            await sleep(RATE_LIMIT_MS);
        } catch (err) {
            console.log(`✗  ${err.message}`);
        }
    }

    if (newScores > 0) {
        saveCache(cache);
        console.log(`\n💾  Saved ${newScores} new scores to cache\n`);
    } else {
        console.log('\n✓  All tasks already cached — no API calls needed\n');
    }

    // Patch data.ts in place
    console.log('🔄  Patching src/data.ts...');
    let patched = src;
    let count = 0;

    for (const [taskName, scores] of Object.entries(cache)) {
        const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
            `("name":\\s*"${escaped}",\\s*\\n\\s*"aiCapabilityScore":\\s*)([\\d.]+)(,\\s*\\n\\s*"humanCriticalityScore":\\s*)([\\d.]+)`,
            'g'
        );
        const before = patched;
        patched = patched.replace(pattern, (_, p1, _ai, p3, _human) =>
            `${p1}${scores.aiCapabilityScore}${p3}${scores.humanCriticalityScore}`
        );
        if (patched !== before) count++;
    }

    fs.writeFileSync(DATA_TS, patched);
    console.log(`✅  Updated ${count} tasks in src/data.ts`);
    console.log('\nDone! Restart the dev server to see the new scores.');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
