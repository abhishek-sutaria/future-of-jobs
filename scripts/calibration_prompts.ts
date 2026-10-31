/**
 * calibration_prompts.ts — phase 3a helper.
 * Writes the exact buildJobAnalysisPrompt() text for each Kelley role (same inputs
 * as scripts/generate_ai_scores.ts) to <outDir>/<id>.txt, and prints an index.
 * Never reads ai_scores.json.
 */
import fs from 'fs';
import path from 'path';
import { initialJobs } from '../src/data';
import { buildJobAnalysisPrompt } from '../src/utils/taskScoring';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
initialJobs.forEach((j, i) => {
    const p = buildJobAnalysisPrompt(j.title, j.tasks.map(t => t.name), j.employment, j.projectedGrowth);
    fs.writeFileSync(path.join(outDir, `${String(i + 1).padStart(2, '0')}_${j.id}.txt`), p);
    console.log(i + 1, j.id, j.title, j.tasks.length, j.projectedGrowth);
});
