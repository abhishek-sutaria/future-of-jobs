/**
 * Every number and colour the role panel shows, for EVERY scored role (the 50
 * Kelley titles and every other scored occupation), checked against an
 * independent recount from the published two-decimal scores:
 *
 *   - each % (Automation Risk, Human Criticality, every task chip) is the exact
 *     mean in whole hundredths, rounded once, halves up (72.5% → 73%);
 *   - the risk gauge and its % take the map's band and colour, the same as the
 *     role's hill;
 *   - the header badge, the task view's worker total and Methodology's counts
 *     come from the data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { useStore } from '../store';
import type { Job } from '../types';
import { JobDetailPanel } from '../components/JobDetailPanel';
import { MethodologyModal } from '../components/MethodologyModal';
import { buildWorldScene } from '../components/world/worldScene';
import { RISK_BAND_COLORS } from '../config/theme';
import { roleScaleFor } from '../utils/allRoleScale';
import { bandFor } from '../utils/roleScale';
import { blsRoleJob } from '../utils/blsRoleJob';
import { BLS_SCORE_RISK, KELLEY_SOC_SCORES, SCORE_COUNTS, blsScoreFor, loadAllBlsScores, monthRangeLabel, publishedScoreDates } from '../utils/blsScores';
import { SCORES_BADGE_MONTHS } from '../utils/scoreDates';
import { INDEX_CONTINENTS, loadContinentFile, type OccupationEntry } from '../utils/occupationIndex';
import { meanPercent } from '../utils/scoreRounding';
import { averageRiskPct, totalWorkers } from '../utils/taskSplitMath';

/** Whole hundredths from the decimal text, not float maths: 0.29 → 29. */
const hundredths = (v: number) => {
    const [whole, frac = ''] = v.toFixed(2).split('.');
    return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
};
/** Mean of two-decimal scores as a whole percent, halves up, by quotient and remainder. */
const expectedPct = (values: number[]) => {
    const sum = values.reduce((s, v) => s + hundredths(v), 0);
    const q = Math.floor(sum / values.length);
    return 2 * (sum - q * values.length) >= values.length ? q + 1 : q;
};

const jobs = useStore.getState().jobs;
const scale = roleScaleFor(jobs);
const scene = buildWorldScene(jobs);
const roles: { job: Job; occupation: OccupationEntry | null; pip: string }[] = [];

beforeAll(async () => {
    await loadAllBlsScores();
    for (const j of jobs) roles.push({ job: j, occupation: null, pip: scene.peaks.find((p) => p.entry.jobId === j.id)!.pipColor });
    for (const c of INDEX_CONTINENTS) {
        const file = await loadContinentFile(c.code);
        for (const occ of Object.values(file.occupations)) {
            const score = blsScoreFor(occ.soc);
            if (!score) continue;
            roles.push({ job: blsRoleJob(occ, score, scale), occupation: occ, pip: scene.peaks.find((p) => p.entry.soc === occ.soc && p.entry.kind === 'bls')!.pipColor });
        }
    }
});

function render(job: Job, occupation: OccupationEntry | null) {
    const html = renderToStaticMarkup(
        <JobDetailPanel
            job={job}
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

describe('every displayed % is the exact mean of whole hundredths, rounded once, halves up', () => {
    it('all scored roles: Automation Risk, Human Criticality and every task chip', () => {
        expect(roles).toHaveLength(SCORE_COUNTS.kelleyTitles + SCORE_COUNTS.bls);
        let checked = 0;
        for (const { job, occupation } of roles) {
            const doc = render(job, occupation);
            expect(doc.querySelector('[data-testid="risk-value"]')!.textContent, job.title).toBe(`${expectedPct(job.tasks.map((t) => t.aiCapabilityScore))}%`);
            expect(doc.querySelector('[data-testid="human-value"]')!.textContent, job.title).toBe(`${expectedPct(job.tasks.map((t) => t.humanCriticalityScore))}%`);
            const chips = [...doc.querySelectorAll('div')].map((d) => d.textContent ?? '').filter((t) => /^\d+% (RISK|HUMAN)$/.test(t));
            const expected = job.tasks.flatMap((t) => [`${hundredths(t.aiCapabilityScore)}% RISK`, `${hundredths(t.humanCriticalityScore)}% HUMAN`]);
            expect(chips.sort(), job.title).toEqual(expected.sort());
            checked++;
        }
        expect(checked).toBe(roles.length);
    }, 120_000);

    it('39-5093 Shampooers: Human Criticality 72.5% shows as 73%', () => {
        const r = roles.find((x) => x.job.id === 'soc:39-5093')!;
        expect(r.job.tasks.map((t) => t.humanCriticalityScore)).toEqual([0.95, 0.85, 0.9, 0.2]);
        expect(render(r.job, r.occupation).querySelector('[data-testid="human-value"]')!.textContent).toBe('73%');
        expect((0.725).toFixed(2)).toBe('0.72'); // the float rounding that used to show 72%
        expect(meanPercent([0.95, 0.85, 0.9, 0.2])).toBe(73);
    });
});

describe('the risk gauge takes the map’s band and colour, the same as the hill', () => {
    it('all scored roles: gauge ring, % colour and band equal the hill’s pip colour', () => {
        let disagreeWithOldCutoffs = 0;
        for (const { job, occupation, pip } of roles) {
            const doc = render(job, occupation);
            const band = bandFor(job.automationCostIndex, scale);
            const tile = doc.querySelector('[data-testid="risk-tile"]')!;
            expect(tile.getAttribute('data-band'), job.title).toBe(band);
            expect(doc.querySelector('[data-testid="risk-gauge"]')!.getAttribute('stroke'), job.title).toBe(RISK_BAND_COLORS[band]);
            expect((doc.querySelector('[data-testid="risk-value"]') as HTMLElement).style.color, job.title).toBe(toRgb(RISK_BAND_COLORS[band]));
            expect(pip, job.title).toBe(RISK_BAND_COLORS[band]);
            // The cut-offs are in the tooltip, so the reason for the colour is visible.
            expect(tile.getAttribute('title'), job.title).toContain(`green below ${Math.round(scale.risk.lower * 100)}%`);
            const old = job.automationCostIndex > 0.6 ? 'high' : job.automationCostIndex > 0.3 ? 'hybrid' : 'safe';
            if (old !== band) disagreeWithOldCutoffs++;
        }
        // The fixed 30% / 60% gauge used to disagree with the hill for this many roles.
        expect(disagreeWithOldCutoffs).toBeGreaterThan(200);
    }, 120_000);

    it('the Human Resilience label shows its cut-offs and says it is rated separately', () => {
        const { job, occupation } = roles[0];
        const title = render(job, occupation).querySelector('[data-testid="resilience-label"]')!.getAttribute('title')!;
        expect(title).toContain(`Future-Proof from ${(scale.humanP75 * 100).toFixed(1)}%`);
        expect(title).toContain(`High from ${(scale.humanP25 * 100).toFixed(1)}%`);
        expect(title).toContain('rated separately from Automation Risk');
        const doc = render(job, occupation);
        expect(doc.body.textContent).toContain('are rated separately');
        expect(doc.body.textContent).not.toContain('independent ratings');
    });
});

/** "#ef4444" → "rgb(239, 68, 68)", as jsdom reports a style colour. */
function toRgb(hex: string) {
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

describe('the header badge date comes from the data', () => {
    it('month ranges', () => {
        expect(monthRangeLabel('2026-11-01T00:00:00Z', '2026-11-08T05:00:00Z')).toBe('Nov 2026');
        expect(monthRangeLabel('2026-08-20T22:23:37Z', '2026-11-08T05:00:00Z')).toBe('Aug–Nov 2026');
        expect(monthRangeLabel('2026-12-30T00:00:00Z', '2027-01-02T00:00:00Z')).toBe('Dec 2026–Jan 2027');
        expect(monthRangeLabel(null, null)).toBeNull();
    });

    it('spans every published score in use: the first scores (Aug 2026) while any Kelley title is on them, and every scoredAt', () => {
        const dates = publishedScoreDates({ model: 'm', generatedAt: null, count: 1, firstScoredAt: '2026-11-01T00:00:00Z', lastScoredAt: '2026-11-08T00:00:00Z', rules: {} }, '2026-08-20T22:23:37.765Z');
        expect(dates).toEqual({ first: '2026-08-20T22:23:37.765Z', last: '2026-11-08T00:00:00Z' });
        if (KELLEY_SOC_SCORES.size === 0) expect(SCORES_BADGE_MONTHS).toBe('Aug–Nov 2026');
        else expect(SCORES_BADGE_MONTHS).not.toContain('Aug');
    });
});

describe('the task view counts workers the way every other view does (BLS EP 2025)', () => {
    it('sums EP 2025 employment, not OEWS payroll employment', () => {
        const bls = roles.filter((r) => r.occupation).map((r) => r.job);
        expect(totalWorkers(bls)).toBe(roles.filter((r) => r.occupation).reduce((s, r) => s + r.occupation!.ep!.employment2025, 0));
        expect(totalWorkers(bls)).not.toBe(bls.reduce((s, j) => s + j.employment, 0));
        expect(averageRiskPct(bls)).toBe(meanPercent(bls.map((j) => j.automationCostIndex)));
    });
});

describe.runIf(KELLEY_SOC_SCORES.size === 0)('Methodology before --batch kelley: counts and rules from the data', () => {
    const text = new JSDOM(`<body>${renderToStaticMarkup(<MethodologyModal isOpen onClose={() => {}} />)}</body>`).window.document.body.textContent!;

    it('the real no-task count, and the split jobs named separately', () => {
        expect(text).toContain('47 of the 830 BLS occupations have no O*NET tasks at all');
        expect(text).toContain("For 12 more, O*NET has no list under the job's own code");
        expect(text).not.toContain('59 of the');
    });

    it('says which scores are on the one method and that the Kelley roles are not yet', () => {
        expect(text).toContain('AI scores cover 783 of 830 occupations.');
        expect(text).toContain(`${BLS_SCORE_RISK.size} of them were scored the same way`);
        expect(text).toContain('The 50 Kelley roles still show their first scores from August 2026');
        expect(text).toContain('Until their BLS code is re-scored, each still shows its own first score.');
    });

    it('the four task rules once, with "No tasks" outside the scored counts', () => {
        expect(text).toContain('Which tasks are scored: four rules.');
        expect(text).toContain('(704 scored jobs)');
        expect(text).toContain('(21 scored jobs)');
        expect(text).toContain('(11 scored jobs)');
        expect(text).toContain('(47 jobs, all “All Other” groups)');
        expect(text).not.toMatch(/Of the [\d,]+ occupations outside the Kelley roles/);
    });

    it('no "year curves", ranks over 783, saving described as it really is', () => {
        expect(text).not.toContain('year curves');
        expect(text).toContain('all 783 scored occupations (each BLS code once)');
        expect(text).toContain('When saving is on');
        expect(text).toContain('(Aug–Nov 2026)');
    });
});
