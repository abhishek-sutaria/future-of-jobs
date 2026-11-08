/**
 * One scale for every scored role (utils/roleScale, utils/allRoleScale).
 *
 * Checked against the published files read straight from disk, not through the
 * app: who is counted (each Kelley title once, each other scored occupation
 * once, no BLS code twice), the cut-offs, the 50 Kelley roles' new labels and
 * colour bands (fixture written by scripts/rank_table.ts), and that no score
 * VALUE moved: only ranks.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useStore } from '../store';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { buildWorldScene } from '../components/world/worldScene';
import { RISK_BAND_COLORS, buildRiskScale, riskBand } from '../config/theme';
import { PERCENTILES, RESILIENCE_LABELS } from '../config/constants';
import { BLS_SCORE_POINTS, kelleyScorePoints, roleScaleFor } from '../utils/allRoleScale';
import { bandFor, buildRoleScale, rankScopeText, resilienceLabelFor, roundHuman, volatilityLabelFor } from '../utils/roleScale';
import { SCORE_COUNTS } from '../utils/blsScores';
import { blsSummaryJob } from '../utils/blsRoleJob';
import kelley50 from './fixtures/kelley50_published.json';
import rankChange from './fixtures/kelley50_rank_change.json';

const ROOT = path.resolve(__dirname, '../..');
const KELLEY_FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores.json'), 'utf-8')) as {
    scores: Record<string, { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] }>;
};
const BLS_FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ai_scores_bls.json'), 'utf-8')) as {
    scores: Record<string, { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] }>;
};

const jobs = useStore.getState().jobs;
const scale = roleScaleFor(jobs);

/** Whole hundredths summed as integers: no float error of its own. */
const hundredths = (xs: number[]) => xs.reduce((s, x) => s + Math.round(x * 100), 0);

describe('who is counted', () => {
    it('each Kelley title once and each other scored occupation once: no key and no BLS code twice', () => {
        const points = [...kelleyScorePoints(jobs), ...BLS_SCORE_POINTS];
        expect(new Set(points.map((p) => p.key)).size).toBe(points.length);
        const kelleySocs = new Set(jobs.map((j) => MAP_TITLE_TO_SOC[j.title]));
        for (const p of BLS_SCORE_POINTS) expect(kelleySocs.has(p.key.slice(4)), p.key).toBe(false);
        expect(points).toHaveLength(Object.keys(KELLEY_FILE.scores).length + Object.keys(BLS_FILE.scores).length);
        expect(scale.count).toBe(points.length);
        expect(scale.count).toBe(SCORE_COUNTS.roles);
        expect(SCORE_COUNTS.roles - SCORE_COUNTS.scored).toBe(SCORE_COUNTS.kelleyTitles - SCORE_COUNTS.kelleySocs);
    });

    it('the Kelley titles that share a BLS code each have their own tasks and scores, so none is a duplicate', () => {
        const bySoc = new Map<string, typeof jobs>();
        for (const j of jobs) bySoc.set(MAP_TITLE_TO_SOC[j.title], [...(bySoc.get(MAP_TITLE_TO_SOC[j.title]) ?? []), j]);
        const shared = [...bySoc.values()].filter((list) => list.length > 1);
        expect(shared).toHaveLength(SCORE_COUNTS.sharedKelleySocs);
        for (const list of shared) {
            const [a, b] = list;
            expect(a.tasks.map((t) => t.name), a.title).not.toEqual(b.tasks.map((t) => t.name));
        }
    });
});

describe('the cut-offs, recomputed from the raw files', () => {
    const risks: number[] = [];
    const humans: number[] = [];
    for (const file of [KELLEY_FILE, BLS_FILE]) {
        for (const e of Object.values(file.scores)) {
            const ai = hundredths(e.tasks.map((t) => t.aiCapabilityScore));
            risks.push(Math.round(ai / e.tasks.length) / 100);
            humans.push(hundredths(e.tasks.map((t) => t.humanCriticalityScore)) / e.tasks.length / 100);
        }
    }
    risks.sort((a, b) => a - b);
    humans.sort((a, b) => a - b);
    const at = (arr: number[], p: number) => arr[Math.min(Math.floor(p * arr.length), arr.length - 1)];

    it('Human Resilience: p25 and p75 of every scored role', () => {
        expect(scale.humanP25).toBeCloseTo(at(humans, PERCENTILES.LOW), 10);
        expect(scale.humanP75).toBeCloseTo(at(humans, PERCENTILES.HIGH), 10);
    });

    it('colour bands: terciles of every scored role', () => {
        const independent = buildRiskScale(risks);
        expect(scale.risk.lower).toBe(independent.lower);
        expect(scale.risk.upper).toBe(independent.upper);
        expect(rankChange._meta.after.riskLower).toBe(scale.risk.lower);
        expect(rankChange._meta.after.riskUpper).toBe(scale.risk.upper);
    });

    it('labels split the roles about a quarter / a half / a quarter', () => {
        const counts = { top: 0, mid: 0, bottom: 0 };
        for (const h of humans) {
            const l = resilienceLabelFor(h, scale);
            if (l === RESILIENCE_LABELS.TOP) counts.top++;
            else if (l === RESILIENCE_LABELS.MID) counts.mid++;
            else counts.bottom++;
        }
        expect(counts.top / humans.length).toBeGreaterThan(0.2);
        expect(counts.bottom / humans.length).toBeGreaterThan(0.2);
        expect(counts.mid / humans.length).toBeGreaterThan(0.4);
    });
});

describe('the 50 Kelley roles: same scores, ranked among all', () => {
    it('the before columns are the labels the app published, ranked among the 50', () => {
        const published = new Map(kelley50.roles.map((r) => [r.id, r.humanResilienceLabel]));
        for (const r of rankChange.rows) expect(r.oldLabel, r.title).toBe(published.get(r.id));
        const oldScale = buildRiskScale(kelley50.roles.map((r) => r.automationCostIndex));
        for (const r of rankChange.rows) expect(r.oldBand, r.title).toBe(riskBand(r.risk, oldScale));
    });

    it('score values are unchanged; labels and bands are the after columns', () => {
        const row = new Map(rankChange.rows.map((r) => [r.id, r]));
        const scene = buildWorldScene(jobs);
        for (const j of jobs) {
            const r = row.get(j.id)!;
            expect(j.automationCostIndex, j.title).toBe(r.risk);
            expect(roundHuman(j.tasks.reduce((s, t) => s + t.humanCriticalityScore, 0) / j.tasks.length), j.title).toBe(r.human);
            expect(j.humanResilienceLabel, j.title).toBe(r.newLabel);
            expect(bandFor(j.automationCostIndex, scale), j.title).toBe(r.newBand);
            const peak = scene.peaks.find((p) => p.entry.jobId === j.id)!;
            expect(peak.pipColor, j.title).toBe(RISK_BAND_COLORS[r.newBand as keyof typeof RISK_BAND_COLORS]);
        }
        expect(rankChange._meta.labelsChanged).toBe(rankChange.rows.filter((r) => r.oldLabel !== r.newLabel).length);
        expect(rankChange._meta.bandsChanged).toBe(rankChange.rows.filter((r) => r.oldBand !== r.newBand).length);
    });

    it('every other scored hill uses the same bands', () => {
        const scene = buildWorldScene(jobs);
        for (const p of scene.peaks.filter((x) => x.entry.kind === 'bls' && x.entry.scored)) {
            expect(p.pipColor, p.entry.soc).toBe(RISK_BAND_COLORS[bandFor(p.entry.blsRisk!, scale)]);
        }
    });
});

describe('roleScale rules', () => {
    it('rounds human means so float noise never breaks a tie', () => {
        const s = buildRoleScale([
            { key: 'a', risk: 0.3, human: 0.564 },
            { key: 'b', risk: 0.4, human: 0.5640000000001 },
            { key: 'c', risk: 0.5, human: 0.7 },
            { key: 'd', risk: 0.6, human: 0.2 },
        ]);
        expect(resilienceLabelFor(0.5639999999, s)).toBe(resilienceLabelFor(0.564, s));
    });

    it('volatility follows the same scale and the growth sign', () => {
        expect(volatilityLabelFor(scale.riskP75, -1, scale)).toBe('Critical');
        expect(volatilityLabelFor(scale.riskP75, 1, scale)).toBe('High');
        expect(volatilityLabelFor(0, 1, scale)).toBe('Stable');
    });

    it('rank text gives the count from the data', () => {
        expect(rankScopeText(scale)).toBe(`among all ${SCORE_COUNTS.roles.toLocaleString('en-US')} scored roles`);
    });

    it('a dashboard summary of a scored occupation carries the same label as its full panel would', () => {
        const [soc] = [...BLS_SCORE_POINTS].map((p) => p.key.slice(4));
        const summary = blsSummaryJob(soc, scale)!;
        const point = BLS_SCORE_POINTS.find((p) => p.key === `soc:${soc}`)!;
        expect(summary.id).toBe(`soc:${soc}`);
        expect(summary.automationCostIndex).toBe(point.risk);
        expect(summary.humanResilienceLabel).toBe(resilienceLabelFor(point.human, scale));
        expect(blsSummaryJob('47-3019', scale)).toBeNull();
    });
});
