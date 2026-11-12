/**
 * A FAKE `--batch kelley` result, for tests of the state after the Kelley SOCs
 * are scored. Never real scores and never committed: every file goes to a new
 * folder under the OS temp directory.
 *
 * The 47 entries are built from the committed plan's kelley rows exactly as
 * the scoring script would write them (scripts/generate_bls_scores.ts
 * scoreEntry), with deterministic fake two-decimal scores in place of
 * Claude's. Kelley titles that share a SOC therefore share one entry.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FAKE_SCORED_AT = '2026-11-09T12:00:00.000Z';

export interface PlanRow {
    soc: string;
    title: string;
    batch?: string;
    taskRule: string;
    selectionRule: string | null;
    onetCodes: string[];
    employment: number;
    projectedGrowth: number;
    promptSha256: string | null;
    tasks: { name: string; onetCode: string; taskId: number }[];
}

const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8'));

export const planRows = (): PlanRow[] => read('data/bls_score_plan_all.json').jobs;

/** A deterministic fake two-decimal score from 0.05 to 0.95. */
export function fakeScore(seed: string): number {
    const h = crypto.createHash('sha256').update(seed).digest();
    return (5 + (h[0] % 91)) / 100;
}

/** The 47 fake Kelley entries, in the shape the scoring script writes. */
export function fakeKelleyEntries(scoredAt = FAKE_SCORED_AT): Record<string, unknown> {
    return Object.fromEntries(
        planRows()
            .filter((r) => r.batch === 'kelley')
            .map((r) => [
                r.soc,
                {
                    title: r.title,
                    rule: r.selectionRule,
                    onetCodes: r.onetCodes,
                    employment: r.employment,
                    projectedGrowth: r.projectedGrowth,
                    responseModel: 'claude-sonnet-5',
                    scoredAt,
                    promptSha256: r.promptSha256,
                    tasks: r.tasks.map((t, i) => ({
                        taskName: t.name,
                        aiCapabilityScore: fakeScore(`${r.soc}|${i}|ai`),
                        humanCriticalityScore: fakeScore(`${r.soc}|${i}|human`),
                        onetCode: t.onetCode,
                        taskId: t.taskId,
                    })),
                    yearlyForecast: [2025, 2026, 2027, 2028, 2029, 2030].map((year) => ({ year, growthImpact: 0, reasoning: 'FAKE' })),
                },
            ]),
    );
}

/** The published ai_scores_bls.json plus the fake Kelley batch, as one parsed file. */
export function fakeAfterFile(): Record<string, unknown> & { scores: Record<string, unknown> } {
    const file = read('src/data/ai_scores_bls.json');
    return {
        ...file,
        generatedAt: FAKE_SCORED_AT,
        controlRuns: {
            ...file.controlRuns,
            kelley: { roles: ['FAKE'], meanAbsGapRiskPoints: 0, meanAbsGapHumanPoints: 0, limitPoints: 5, passed: true, route: 'FAKE', plan: 'data/bls_score_plan_all.json', comparedWith: 'src/data/ai_scores_bls.json (FAKE)' },
        },
        scores: { ...file.scores, ...fakeKelleyEntries() },
    };
}

/**
 * Writes the after-state file to a new temporary folder and returns its path
 * and contents. The file is read back from disk, so tests use a real file.
 */
export function writeFakeAfterFile(): { file: string; dir: string; json: ReturnType<typeof fakeAfterFile> } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foj-fake-kelley-'));
    const file = path.join(dir, 'ai_scores_bls.json');
    fs.writeFileSync(file, JSON.stringify(fakeAfterFile(), null, 2) + '\n');
    return { file, dir, json: JSON.parse(fs.readFileSync(file, 'utf-8')) };
}

/**
 * A throwaway copy of what the scoring script reads and writes, for a mocked
 * run: the plan, both score files and the O*NET / occupation inputs (linked,
 * read only). Nothing in the repository is touched. The copy's scores file is
 * always the state BEFORE --batch kelley (any Kelley entries are taken out),
 * so the mocked run is the same test before and after the real batch.
 */
export function scratchRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foj-scoring-root-'));
    for (const d of ['data', 'src/data', 'src/__tests__/fixtures']) fs.mkdirSync(path.join(root, d), { recursive: true });
    for (const f of ['data/bls_score_plan_all.json', 'data/bls_scoring_plan.json', 'src/data/ai_scores.json']) {
        fs.copyFileSync(path.join(REPO_ROOT, f), path.join(root, f));
    }
    const kelley = new Set(planRows().filter((r) => r.batch === 'kelley').map((r) => r.soc));
    const scores = read('src/data/ai_scores_bls.json');
    const { kelley: _kelleyRun, ...controlRuns } = scores.controlRuns ?? {};
    void _kelleyRun;
    const before = { ...scores, controlRuns, scores: Object.fromEntries(Object.entries(scores.scores).filter(([soc]) => !kelley.has(soc))) };
    fs.writeFileSync(path.join(root, 'src/data/ai_scores_bls.json'), JSON.stringify(before, null, 2) + '\n');
    fs.symlinkSync(path.join(REPO_ROOT, 'data/db_30_1_text'), path.join(root, 'data/db_30_1_text'));
    fs.symlinkSync(path.join(REPO_ROOT, 'src/data/occupations'), path.join(root, 'src/data/occupations'));
    return root;
}
