/**
 * The Kelley batch (`--batch kelley`), before and after, with a FAKE batch in a
 * temporary file (helpers/fakeKelleyBatch.ts). Claude is mocked everywhere:
 * no test makes a network call, and nothing in the repository is written.
 *
 *   - What the build serves after the batch: the 47 Kelley SOCs go whole into
 *     the main bundle, ai_scores.json's entries drop out, the 736 others are
 *     served exactly as before.
 *   - How the store seeds the 50 titles: each from its SOC's entry, so titles
 *     that share a SOC get identical tasks and scores; a user re-score made on
 *     the old tasks is ignored.
 *   - Ranks: 783 scored occupations either way, each SOC once.
 *   - The scoring run itself, end to end on a scratch copy: the dry run, a
 *     first run of controls + 5 jobs, then the rest; the call cap, the ledger
 *     and the control gate; the 736 entries untouched.
 * App-level checks of the after state (panel, Methodology, badge) are in
 * kelleyBatchApp.test.tsx; the before state is the real data in every other
 * test.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initialJobs } from '../data';
import type { Job } from '../types';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { buildBlsBundle, legacyKelleySubset, parseBlsScores, type RawBlsFile } from '../utils/blsScoresData';
import { KELLEY_JOB_SOCS, KELLEY_SOC_SET } from '../utils/kelleySocs';
import { analysisFitsTasks, seedKelleyJobs } from '../utils/kelleyScores';
import { BLS_SCORE_RISK, KELLEY_SOC_SCORES } from '../utils/blsScores';
import { buildRoleScale, resilienceLabelFor, bandFor } from '../utils/roleScale';
import { meanUnit } from '../utils/scoreRounding';
import { promptFor, sha256 } from '../../scripts/lib/scorePlanAll';
import { buildRankTable } from '../../scripts/rank_table';
import { ANTHROPIC_URL, CLAUDE_MODEL } from '../../scripts/lib/claudeScoring';
import type { JobAnalysisResult } from '../utils/taskScoring';
import { FAKE_SCORED_AT, REPO_ROOT, fakeScore, planRows, scratchRepo, writeFakeAfterFile } from './helpers/fakeKelleyBatch';

const LEGACY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/data/ai_scores.json'), 'utf-8'));
const REAL = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/data/ai_scores_bls.json'), 'utf-8'));
const ENTRIES_736_SHA256 = 'a404fadde75ed1d45cc13f69289eff8839b4a5a53885888b113aad7bb4a99165';
const hash736 = (scores: Record<string, unknown>) => {
    const socs = Object.keys(REAL.scores).filter((s) => !KELLEY_SOC_SET.has(s)).sort();
    return crypto.createHash('sha256').update(JSON.stringify(socs.map((s) => [s, scores[s]]))).digest('hex');
};

/** The store's own merge, as a stand-in: fills a job's tasks from an analysis by name, then position. */
function applyAnalyses(jobs: Job[], analyses: Record<string, JobAnalysisResult>): Job[] {
    return jobs.map((job) => {
        const a = analyses[job.id];
        if (!a) return job;
        const tasks = job.tasks.map((t, i) => {
            const m = a.tasks.find((x) => x.taskName === t.name) ?? a.tasks[i];
            return m ? { ...t, aiCapabilityScore: m.aiCapabilityScore, humanCriticalityScore: m.humanCriticalityScore } : t;
        });
        return { ...job, tasks, automationCostIndex: meanUnit(tasks.map((t) => t.aiCapabilityScore)) };
    });
}

const after = writeFakeAfterFile();
const afterBundle = buildBlsBundle(after.json as RawBlsFile, KELLEY_SOC_SET);
const afterKelley = parseBlsScores(afterBundle.kelley).scores;
const afterLegacy = legacyKelleySubset(LEGACY, KELLEY_JOB_SOCS, new Set(Object.keys(afterBundle.kelley.scores ?? {})));
const legacyScores = (LEGACY.scores ?? {}) as Record<string, JobAnalysisResult>;

describe('the fake batch is a real file in a temp folder, never in the repo', () => {
    it('holds the 736 published entries unchanged plus 47 fake Kelley entries', () => {
        expect(after.file.startsWith(path.resolve(REPO_ROOT))).toBe(false);
        expect(fs.existsSync(after.file)).toBe(true);
        expect(Object.keys(after.json.scores)).toHaveLength(783);
        expect(hash736(after.json.scores)).toBe(ENTRIES_736_SHA256);
        expect(hash736(REAL.scores)).toBe(ENTRIES_736_SHA256);
    });
});

describe('what the build serves', () => {
    it('before (the real file): no Kelley entry, every Kelley title on its first score', () => {
        const real = buildBlsBundle(REAL, KELLEY_SOC_SET);
        const onFile = new Set(Object.keys(real.kelley.scores ?? {}));
        const legacy = legacyKelleySubset(LEGACY, KELLEY_JOB_SOCS, onFile);
        if (onFile.size === 0) {
            expect(Object.keys(legacy.scores ?? {})).toHaveLength(50);
        } else {
            expect(onFile.size).toBe(47);
            expect(Object.keys(legacy.scores ?? {})).toHaveLength(0);
        }
    });

    it('after: the 47 Kelley SOCs whole in the main bundle, nothing from ai_scores.json, the 736 exactly as before', () => {
        expect(Object.keys(afterBundle.kelley.scores ?? {}).sort()).toEqual([...KELLEY_SOC_SET].sort());
        expect(afterKelley.size).toBe(47);
        expect(Object.keys(afterLegacy.scores ?? {})).toEqual([]);
        expect(afterBundle.risks).toEqual(Object.fromEntries(BLS_SCORE_RISK));
        expect(Object.keys(afterBundle.risks)).toHaveLength(736);
        expect(afterBundle.meta!.count).toBe(783);
        expect(afterBundle.meta!.rules).toEqual({ 'first-5-onet-order': 748, 'round-robin-sub-codes': 23, 'round-robin-onet-codes': 12 });
        expect(afterBundle.meta!.lastScoredAt).toBe(FAKE_SCORED_AT);
    });
});

describe('how the store seeds the 50 Kelley titles', () => {
    const seededAfter = seedKelleyJobs(initialJobs, afterKelley, afterLegacy.scores as Record<string, JobAnalysisResult>, applyAnalyses);
    const seededBefore = seedKelleyJobs(initialJobs, KELLEY_SOC_SCORES, legacyScores, applyAnalyses);
    const bySoc = (jobs: Job[]) => {
        const m = new Map<string, Job[]>();
        for (const j of jobs) m.set(MAP_TITLE_TO_SOC[j.title], [...(m.get(MAP_TITLE_TO_SOC[j.title]) ?? []), j]);
        return m;
    };

    it('after: every title reads its tasks AND scores from its SOC entry, keeping its own id and title', () => {
        expect(seededAfter).toHaveLength(50);
        for (const j of seededAfter) {
            const s = afterKelley.get(MAP_TITLE_TO_SOC[j.title])!;
            expect(j.tasks.map((t) => [t.name, t.aiCapabilityScore, t.humanCriticalityScore]), j.title).toEqual(s.tasks.map((t) => [t.name, t.aiCapabilityScore, t.humanCriticalityScore]));
            expect(j.automationCostIndex, j.title).toBe(s.automationCostIndex);
            expect(j.yearlyForecast, j.title).toBeUndefined();
        }
        expect(seededAfter.map((j) => [j.id, j.title])).toEqual(initialJobs.map((j) => [j.id, j.title]));
    });

    it('after: titles that share a SOC get identical tasks and scores (Marketing / Brand, BI Analyst / Data Scientist, Buyer / Purchasing Agent)', () => {
        const shared = [...bySoc(seededAfter)].filter(([, l]) => l.length > 1);
        expect(shared.map(([soc]) => soc).sort()).toEqual(['11-2021', '13-1020', '15-2051']);
        for (const [, [a, b]] of shared) {
            expect(a.tasks).toEqual(b.tasks);
            expect(a.automationCostIndex).toBe(b.automationCostIndex);
            expect(a.id).not.toBe(b.id);
        }
    });

    it('before: each title keeps its first score; shared titles still differ', () => {
        if (KELLEY_SOC_SCORES.size > 0) return; // the real batch is in: kelleyBatchApp covers this state
        for (const j of seededBefore) {
            const first = legacyScores[j.id];
            expect(j.tasks.map((t) => t.aiCapabilityScore), j.title).toEqual(first.tasks.map((t) => t.aiCapabilityScore));
        }
        for (const [, [a, b]] of [...bySoc(seededBefore)].filter(([, l]) => l.length > 1)) expect(a.tasks.map((t) => t.name)).not.toEqual(b.tasks.map((t) => t.name));
    });

    it('a user re-score made on the old tasks is ignored on a SOC entry; one made on the new tasks applies', () => {
        const brand = initialJobs.find((j) => j.title === 'Brand Manager')!;
        const entry = afterKelley.get('11-2021')!;
        const oldRescore: JobAnalysisResult = { tasks: brand.tasks.map((t) => ({ taskName: t.name, aiCapabilityScore: 0.99, humanCriticalityScore: 0.01 })), yearlyForecast: [] };
        const newRescore: JobAnalysisResult = { tasks: entry.tasks.map((t) => ({ taskName: t.name, aiCapabilityScore: 0.11, humanCriticalityScore: 0.88 })), yearlyForecast: [] };
        const [ignored] = seedKelleyJobs([brand], afterKelley, { [brand.id]: oldRescore }, applyAnalyses);
        expect(ignored.tasks.map((t) => t.aiCapabilityScore)).toEqual(entry.tasks.map((t) => t.aiCapabilityScore));
        const [applied] = seedKelleyJobs([brand], afterKelley, { [brand.id]: newRescore }, applyAnalyses);
        expect(applied.tasks.every((t) => t.aiCapabilityScore === 0.11)).toBe(true);
        expect(analysisFitsTasks(applied, newRescore)).toBe(true);
        expect(analysisFitsTasks(applied, oldRescore)).toBe(false);
    });
});

describe('ranks: one scale across the 783 scored occupations, each SOC once', () => {
    const points = (jobs: Job[], nonKelley: Record<string, number>, humans: Record<string, number>) => {
        const bySoc = new Map<string, Job[]>();
        for (const j of jobs) bySoc.set(MAP_TITLE_TO_SOC[j.title], [...(bySoc.get(MAP_TITLE_TO_SOC[j.title]) ?? []), j]);
        const human = (j: Job) => j.tasks.reduce((s, t) => s + t.humanCriticalityScore, 0) / j.tasks.length;
        return [
            ...[...bySoc].map(([soc, l]) => ({ key: soc, risk: l.reduce((s, j) => s + j.automationCostIndex, 0) / l.length, human: l.reduce((s, j) => s + human(j), 0) / l.length })),
            ...Object.keys(nonKelley).map((soc) => ({ key: soc, risk: nonKelley[soc], human: humans[soc] })),
        ];
    };

    it('783 before and after; after, a Kelley title takes exactly its SOC rank', () => {
        const before = buildRoleScale(points(seedKelleyJobs(initialJobs, new Map(), legacyScores, applyAnalyses), buildBlsBundle(REAL, KELLEY_SOC_SET).risks, buildBlsBundle(REAL, KELLEY_SOC_SET).humans));
        const seeded = seedKelleyJobs(initialJobs, afterKelley, {}, applyAnalyses);
        const scale = buildRoleScale(points(seeded, afterBundle.risks, afterBundle.humans));
        expect(before.count).toBe(783);
        expect(scale.count).toBe(783);
        for (const j of seeded) {
            const s = afterKelley.get(MAP_TITLE_TO_SOC[j.title])!;
            expect(resilienceLabelFor(j.tasks.reduce((a, t) => a + t.humanCriticalityScore, 0) / 5, scale), j.title).toBe(resilienceLabelFor(s.humanCriticality, scale));
            expect(bandFor(j.automationCostIndex, scale), j.title).toBe(bandFor(s.automationCostIndex, scale));
        }
    });

    it('the rank table script, run on a scratch copy holding the fake batch, puts all 50 on their SOC entry among 783', () => {
        const root = scratchRepo();
        fs.copyFileSync(after.file, path.join(root, 'src/data/ai_scores_bls.json'));
        const table = buildRankTable(root);
        expect(table.out._meta.occupations).toBe(783);
        expect(table.out._meta.onSocEntry).toBe(50);
        const row = new Map(table.rows.map((r) => [r.title, r]));
        for (const [a, b] of [['Marketing Manager', 'Brand Manager'], ['Business Intelligence Analyst', 'Data Scientist'], ['Wholesale & Retail Buyer', 'Purchasing Agent']]) {
            expect([row.get(a)!.risk, row.get(a)!.human, row.get(a)!.newLabel, row.get(a)!.newBand]).toEqual([row.get(b)!.risk, row.get(b)!.human, row.get(b)!.newLabel, row.get(b)!.newBand]);
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
});

// ── The scoring run, end to end, with Claude mocked ─────────────────────────

const ROWS = planRows();
const ROW_BY_PROMPT = new Map(ROWS.filter((r) => r.promptSha256).map((r) => [r.promptSha256!, r]));

/** A mocked api.anthropic.com: answers each planned prompt; controls get their published numbers back unless `skew`. */
function mockClaude(opts: { skew?: number } = {}) {
    const calls: { url: string; soc: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe(CLAUDE_MODEL);
        const row = ROW_BY_PROMPT.get(sha256(body.messages[0].content));
        if (!row) throw new Error('mock Claude: prompt is not a planned row');
        calls.push({ url, soc: row.soc });
        const published = REAL.scores[row.soc] as { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] } | undefined;
        const tasks = row.tasks.map((t, i) => ({
            taskName: t.name,
            aiCapabilityScore: published ? Math.min(1, published.tasks[i].aiCapabilityScore + (opts.skew ?? 0)) : fakeScore(`${row.soc}|${i}|ai`),
            humanCriticalityScore: published ? published.tasks[i].humanCriticalityScore : fakeScore(`${row.soc}|${i}|human`),
        }));
        const yearlyForecast = [2025, 2026, 2027, 2028, 2029, 2030].map((year) => ({ year, growthImpact: 0, reasoning: 'MOCK' }));
        return new Response(JSON.stringify({ model: CLAUDE_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ tasks, yearlyForecast }) }], usage: { input_tokens: 1200, output_tokens: 700 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
}

describe('the scoring run (--batch kelley), Claude mocked, on a scratch copy', () => {
    let main: (argv: readonly string[], opts?: { root?: string }) => Promise<void>;
    beforeAll(async () => {
        ({ main } = await import('../../scripts/generate_bls_scores'));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });
    const quiet = () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit ${code}`);
        }) as never);
        vi.stubEnv('FOJ_SCORING_API_KEY', 'sk-ant-FIXTURE-not-a-real-key');
        vi.stubEnv('FOJ_SCORING_WORKSPACE', 'wrkspc_FIXTURE');
    };
    const ledger = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'data/ai_scores_bls_run.json'), 'utf-8'));
    const scores = (root: string) => JSON.parse(fs.readFileSync(path.join(root, 'src/data/ai_scores_bls.json'), 'utf-8'));
    const repoFiles = () => ['src/data/ai_scores_bls.json', 'data/bls_score_plan_all.json', 'src/__tests__/fixtures/kelley50_rank_change.json'].map((f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf-8'));

    it('dry run: lists 47 jobs and 5 controls, makes no call', async () => {
        quiet();
        const calls = mockClaude();
        const root = scratchRepo();
        await main(['--batch', 'kelley', '--dry-run'], { root });
        expect(calls).toHaveLength(0);
        expect(fs.existsSync(path.join(root, 'data/ai_scores_bls_run.json'))).toBe(false);
    });

    it('first run (controls + 5 jobs), then the rest: 52 calls, all 47 written, the 736 untouched, fixture refreshed, repo untouched', async () => {
        quiet();
        const repoBefore = repoFiles();
        const calls = mockClaude();
        const root = scratchRepo();
        const original = fs.readFileSync(path.join(root, 'src/data/ai_scores_bls.json'), 'utf-8');

        await main(['--batch', 'kelley', '--direct', '--max-jobs', '5', '--max-calls', '14'], { root });
        expect(calls).toHaveLength(10);
        expect(calls.slice(0, 5).map((c) => c.soc)).toEqual(['13-1074', '13-1199', '13-2020', '13-1031', '13-2081']);
        expect(calls.every((c) => c.url === ANTHROPIC_URL)).toBe(true);
        expect(ledger(root).calls).toHaveLength(10);
        expect(ledger(root).calls.at(-1).runningTotalUsd).toBeCloseTo(10 * (1200 * 2 + 700 * 10) / 1e6, 6);
        // Nothing is written until the whole batch is scored.
        expect(fs.readFileSync(path.join(root, 'src/data/ai_scores_bls.json'), 'utf-8')).toBe(original);

        await main(['--batch', 'kelley', '--direct', '--max-calls', '60'], { root });
        expect(calls).toHaveLength(52); // controls cached in the ledger: not repeated
        const file = scores(root);
        expect(Object.keys(file.scores)).toHaveLength(783);
        expect(hash736(file.scores)).toBe(ENTRIES_736_SHA256);
        for (const r of ROWS.filter((x) => x.batch === 'kelley')) {
            expect(file.scores[r.soc].promptSha256, r.soc).toBe(r.promptSha256);
            expect(file.scores[r.soc].promptSha256, r.soc).toBe(sha256(promptFor(r)));
            expect(file.scores[r.soc].tasks.map((t: { taskName: string }) => t.taskName), r.soc).toEqual(r.tasks.map((t) => t.name));
        }
        expect(file.controlRuns.kelley).toMatchObject({ passed: true, meanAbsGapRiskPoints: 0, meanAbsGapHumanPoints: 0 });
        expect(file.controlRuns.kelley.roles).toHaveLength(5);
        const fixture = JSON.parse(fs.readFileSync(path.join(root, 'src/__tests__/fixtures/kelley50_rank_change.json'), 'utf-8'));
        expect(fixture._meta.onSocEntry).toBe(50);
        expect(ledger(root).calls).toHaveLength(52);
        // A third run has nothing to do and calls nothing.
        await main(['--batch', 'kelley', '--direct'], { root });
        expect(calls).toHaveLength(52);
        expect(repoFiles()).toEqual(repoBefore);
        fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('keeps the call cap: stops before call 4 with --max-calls 3, ledger saved, nothing written', async () => {
        quiet();
        const calls = mockClaude();
        const root = scratchRepo();
        const original = fs.readFileSync(path.join(root, 'src/data/ai_scores_bls.json'), 'utf-8');
        await expect(main(['--batch', 'kelley', '--direct', '--max-calls', '3'], { root })).rejects.toThrow(/--max-calls 3 reached/);
        expect(calls).toHaveLength(3);
        expect(ledger(root).calls).toHaveLength(3);
        expect(fs.readFileSync(path.join(root, 'src/data/ai_scores_bls.json'), 'utf-8')).toBe(original);
        await expect(main(['--batch', 'kelley', '--direct', '--max-calls', '451'], { root })).rejects.toThrow('exit 1');
        expect(calls).toHaveLength(3);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('stops at the controls when they drift more than 5 points: no Kelley job is sent', async () => {
        quiet();
        const calls = mockClaude({ skew: 0.2 });
        const root = scratchRepo();
        await expect(main(['--batch', 'kelley', '--direct', '--max-calls', '60'], { root })).rejects.toThrow('exit 2');
        expect(calls.map((c) => c.soc)).toEqual(['13-1074', '13-1199', '13-2020', '13-1031', '13-2081']);
        expect(Object.keys(scores(root).scores)).toHaveLength(736);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('the old Business & Finance mode refuses to rewrite a file that holds more than its 13', async () => {
        quiet();
        const calls = mockClaude();
        const root = scratchRepo();
        await expect(main(['--direct'], { root })).rejects.toThrow('exit 1');
        expect(calls).toHaveLength(0);
        expect(Object.keys(scores(root).scores)).toHaveLength(736);
        fs.rmSync(root, { recursive: true, force: true });
    });
});
