/**
 * build_calibration_ratings.ts — phase 3a helper.
 * Turns the compact hand ratings (`<id> ai,human ai,human ...` per line) into
 * reports/calibration/ratings_phase3a.json, validated by the SAME zod schema and
 * parseJobAnalysis() the generator uses. Never reads ai_scores.json.
 *
 * The yearlyForecast is NOT part of the calibration: it is filled with a
 * deterministic ease-in path toward the BLS 2030 cap purely so the schema and
 * forecast-cap validation pass.
 */
import fs from 'fs';
import path from 'path';
import { initialJobs } from '../src/data';
import { buildJobAnalysisPrompt, parseJobAnalysis, CACHE_VERSION, type JobAnalysisResult } from '../src/utils/taskScoring';
import { JobTaskScoringSchema } from '../src/utils/claude';
import { OOH_FRACTION_AT_YEAR_MAX } from '../src/config/constants';

const [, , outFile, ...inFiles] = process.argv;
const compact = new Map<string, number[][]>();
for (const f of inFiles) {
    for (const line of fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean)) {
        const [id, ...pairs] = line.trim().split(/\s+/);
        compact.set(id, pairs.map(p => p.split(',').map(Number)));
    }
}
const EASE = [0, 0.15, 0.35, 0.6, 0.82, 1];
const scores: Record<string, JobAnalysisResult> = {};
for (const job of initialJobs) {
    const pairs = compact.get(job.id);
    if (!pairs) throw new Error(`missing rating for ${job.id}`);
    if (pairs.length !== job.tasks.length) throw new Error(`${job.id}: ${pairs.length} ratings for ${job.tasks.length} tasks`);
    const cap = job.projectedGrowth * OOH_FRACTION_AT_YEAR_MAX;
    const raw = {
        tasks: job.tasks.map((t, i) => ({ taskName: t.name, aiCapabilityScore: pairs[i][0], humanCriticalityScore: pairs[i][1] })),
        yearlyForecast: EASE.map((e, i) => ({
            year: 2025 + i,
            growthImpact: Math.trunc(cap * e * 100) / 100, // truncate toward 0 so it never overshoots the cap
            reasoning: i === 0 ? 'Baseline year.' : 'Smooth progression toward the BLS-implied 2030 endpoint.',
        })),
    };
    scores[job.id] = parseJobAnalysis(JobTaskScoringSchema.parse(raw), job.tasks.map(t => t.name), job.projectedGrowth);
    buildJobAnalysisPrompt(job.title, job.tasks.map(t => t.name), job.employment, job.projectedGrowth); // same inputs as generator
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({
    version: CACHE_VERSION,
    model: 'claude-sonnet-5-5 (in-session rating, phase 3a)',
    generatedAt: new Date().toISOString(),
    scores,
}, null, 2) + '\n');
console.log(`wrote ${outFile}: ${Object.keys(scores).length} roles, ${Object.values(scores).reduce((s, r) => s + r.tasks.length, 0)} tasks`);
