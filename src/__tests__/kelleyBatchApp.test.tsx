/**
 * The whole app in the state AFTER `--batch kelley`, from a FAKE batch in a
 * temporary file (helpers/fakeKelleyBatch.ts, never committed). The build's
 * two virtual modules are replaced by what blsScoresPlugin would serve from
 * that file, so the store, the counts, the role panel, Methodology and the
 * header badge all run on it. No Claude call, no network.
 *
 * The state BEFORE the batch is the real data, which every other test runs on.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

vi.mock('virtual:bls-scores', async () => {
    const { writeFakeAfterFile } = await import('./helpers/fakeKelleyBatch');
    const { buildBlsBundle } = await import('../utils/blsScoresData');
    const { KELLEY_SOC_SET } = await import('../utils/kelleySocs');
    const b = buildBlsBundle(writeFakeAfterFile().json, KELLEY_SOC_SET);
    return {
        meta: b.meta,
        risks: b.risks,
        humans: b.humans,
        kelley: b.kelley,
        fieldLoaders: Object.fromEntries(Object.entries(b.fields).map(([code, f]) => [code, async () => ({ default: f })])),
    };
});
vi.mock('virtual:kelley-legacy-scores', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { writeFakeAfterFile, REPO_ROOT } = await import('./helpers/fakeKelleyBatch');
    const { legacyKelleySubset } = await import('../utils/blsScoresData');
    const { KELLEY_JOB_SOCS } = await import('../utils/kelleySocs');
    const legacy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/data/ai_scores.json'), 'utf-8'));
    return { default: legacyKelleySubset(legacy, KELLEY_JOB_SOCS, new Set(Object.keys(writeFakeAfterFile().json.scores))) };
});

const { useStore } = await import('../store');
const { SCORE_COUNTS, KELLEY_SOC_SCORES, BLS_SCORES_META } = await import('../utils/blsScores');
const { getBakedScores } = await import('../utils/bakedScores');
const { SCORES_BADGE_MONTHS } = await import('../utils/scoreDates');
const { roleScaleFor } = await import('../utils/allRoleScale');
const { bandFor, rankScopeText } = await import('../utils/roleScale');
const { MAP_TITLE_TO_SOC } = await import('../utils/onet');
const { JobDetailPanel } = await import('../components/JobDetailPanel');
const { MethodologyModal } = await import('../components/MethodologyModal');
const { loadContinentFile } = await import('../utils/occupationIndex');
const { buildWorldScene } = await import('../components/world/worldScene');
const { RISK_BAND_COLORS } = await import('../config/theme');
const { FAKE_SCORED_AT } = await import('./helpers/fakeKelleyBatch');

const jobs = useStore.getState().jobs;
const byTitle = (t: string) => jobs.find((j) => j.title === t)!;

function panel(title: string, occupation: Awaited<ReturnType<typeof loadContinentFile>>['occupations'][string] | null = null) {
    const html = renderToStaticMarkup(
        <JobDetailPanel
            job={byTitle(title)}
            occupation={occupation}
            analysisResult={null}
            analysisLoading={false}
            analysisError={null}
            missingApiKey={false}
            onClose={() => {}}
            onSetAnalysisResult={() => {}}
            onSetAnalysisLoading={() => {}}
            onShowMethodology={() => {}}
        />,
    );
    return new JSDOM(`<body>${html}</body>`).window.document;
}

describe('after --batch kelley (fake batch): one method for every scored role', () => {
    it('counts: all 783 on the one method, 0 Kelley titles left on first scores, ranks over 783', () => {
        expect(KELLEY_SOC_SCORES.size).toBe(47);
        expect(SCORE_COUNTS).toMatchObject({ scored: 783, kelleyOnFile: 47, kelleyTitlesOnFile: 50, legacyKelleySocs: 0, legacyKelleyTitles: 0, oneMethod: 783, ranked: 783, bls: 736 });
        expect(BLS_SCORES_META!.count).toBe(783);
        expect(roleScaleFor(jobs).count).toBe(783);
    });

    it('the app reads nothing from ai_scores.json, and still counts as published scores (no live re-score kicks in)', () => {
        expect(getBakedScores()).toBeNull();
        const s = useStore.getState();
        expect(s.hasAIScores).toBe(true);
        expect(s.scoresSource).toBe('baked');
    });

    it('every Kelley title reads its tasks and scores from its SOC; shared titles identical, separate peaks and labels', () => {
        for (const j of jobs) {
            const e = KELLEY_SOC_SCORES.get(MAP_TITLE_TO_SOC[j.title])!;
            expect(j.tasks.map((t) => t.name), j.title).toEqual(e.tasks.map((t) => t.name));
            expect(j.automationCostIndex, j.title).toBe(e.automationCostIndex);
        }
        const scene = buildWorldScene(jobs);
        for (const [a, b] of [['Marketing Manager', 'Brand Manager'], ['Business Intelligence Analyst', 'Data Scientist'], ['Wholesale & Retail Buyer', 'Purchasing Agent']]) {
            expect(byTitle(a).tasks).toEqual(byTitle(b).tasks);
            expect(byTitle(a).humanResilienceLabel).toBe(byTitle(b).humanResilienceLabel);
            const pa = scene.peaks.find((p) => p.entry.jobId === byTitle(a).id)!;
            const pb = scene.peaks.find((p) => p.entry.jobId === byTitle(b).id)!;
            expect(pa.entry.key).not.toBe(pb.entry.key);
            expect(pa.pipColor).toBe(pb.pipColor);
            const da = panel(a);
            const db = panel(b);
            expect(da.querySelector('[data-testid="risk-value"]')!.textContent).toBe(db.querySelector('[data-testid="risk-value"]')!.textContent);
            expect(da.querySelector('[data-testid="human-value"]')!.textContent).toBe(db.querySelector('[data-testid="human-value"]')!.textContent);
            expect(da.querySelector('[data-testid="kelley-label"]')).not.toBeNull();
            expect(db.querySelector('[data-testid="kelley-label"]')).not.toBeNull();
        }
    });

    it('the panel gauge is the hill band, and the rank text counts 783 occupations', () => {
        const scale = roleScaleFor(jobs);
        const scene = buildWorldScene(jobs);
        for (const j of jobs) {
            const doc = panel(j.title);
            const band = bandFor(j.automationCostIndex, scale);
            expect(doc.querySelector('[data-testid="risk-tile"]')!.getAttribute('data-band'), j.title).toBe(band);
            expect(doc.querySelector('[data-testid="risk-gauge"]')!.getAttribute('stroke'), j.title).toBe(RISK_BAND_COLORS[band]);
            expect(scene.peaks.find((p) => p.entry.jobId === j.id)!.pipColor, j.title).toBe(RISK_BAND_COLORS[band]);
            expect(doc.querySelector('[data-testid="rank-scope"]')!.textContent).toBe(`Rank ${rankScopeText(scale)}`);
        }
        expect(rankScopeText(scale)).toBe('among all 783 scored occupations');
    });

    it('Buyer / Purchasing Agent names the O*NET codes their tasks come from', async () => {
        const occ = (await loadContinentFile('13')).occupations['13-1020'];
        const note = panel('Purchasing Agent', occ).querySelector('[data-testid="task-source-note"]')!.textContent!;
        expect(note).toContain('The scored tasks above come from O*NET 13-1021.00');
        expect(note).toContain('13-1022.00');
        expect(note).toContain('13-1023.00');
    });

    it('the header badge shows the scores\' own month, from the data', () => {
        expect(BLS_SCORES_META!.lastScoredAt).toBe(FAKE_SCORED_AT);
        expect(SCORES_BADGE_MONTHS).toBe('Nov 2026');
    });

    it('Methodology says all 783 are on one method, with the four rules counted over all of them', () => {
        const html = renderToStaticMarkup(<MethodologyModal isOpen onClose={() => {}} />);
        const text = new JSDOM(`<body>${html}</body>`).window.document.body.textContent!;
        expect(text).toContain('AI scores cover 783 of 830 occupations, all scored the same way.');
        expect(text).toContain('the 50 Kelley roles (47 BLS occupations) included');
        expect(text).toContain('(748 scored jobs)');
        expect(text).toContain('(23 scored jobs)');
        expect(text).toContain('(12 scored jobs)');
        expect(text).toContain('(47 jobs, all “All Other” groups)');
        expect(text).not.toContain('first scores');
        expect(text).toContain('both titles of a code have that code’s tasks and scores');
    });
});

describe('the fake batch file itself', () => {
    beforeAll(() => undefined);
    it('lives in the OS temp folder', async () => {
        const { writeFakeAfterFile, REPO_ROOT } = await import('./helpers/fakeKelleyBatch');
        expect(writeFakeAfterFile().file.startsWith(REPO_ROOT)).toBe(false);
    });
});
