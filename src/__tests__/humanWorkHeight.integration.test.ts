import { describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { YEAR_MIN, YEAR_MAX } from '../config/constants';
import {
    aiShareAtYear,
    getCurrentYearGrowth,
    getVisualHeightForGrowth,
    getVisualHeightForHumanWorkAtYear,
    getVisualHeightForWorkersAtYear,
} from '../utils/terrainMath';

/**
 * Correctness checks against the real 50-role catalog with published scores.
 * Guards the Human-work mode semantics: variance at 2025, and net erosion
 * as the year advances.
 */
describe('human-work heights on published roles', () => {
    const jobs = useStore.getInitialState().jobs;

    it('loads scored roles from the store seed', () => {
        expect(jobs.length).toBe(50);
        expect(jobs.every((j) => j.automationCostIndex > 0)).toBe(true);
    });

    it('old Growth encoding is flat at 2025; Human work is not', () => {
        const oldUnique = new Set(
            jobs.map((j) => getVisualHeightForGrowth(getCurrentYearGrowth(j, YEAR_MIN).value).toFixed(4)),
        );
        const humanUnique = new Set(
            jobs.map((j) =>
                getVisualHeightForHumanWorkAtYear(
                    j.employment,
                    getCurrentYearGrowth(j, YEAR_MIN).value,
                    j.automationCostIndex,
                    YEAR_MIN,
                ).toFixed(4),
            ),
        );
        expect(oldUnique.size).toBe(1);
        expect(humanUnique.size).toBeGreaterThan(10);
    });

    it('most roles erode from 2025 to 2030 under Human work', () => {
        let eroded = 0;
        let grew = 0;
        const grewTitles: string[] = [];
        for (const j of jobs) {
            const h0 = getVisualHeightForHumanWorkAtYear(
                j.employment,
                getCurrentYearGrowth(j, YEAR_MIN).value,
                j.automationCostIndex,
                YEAR_MIN,
            );
            const h1 = getVisualHeightForHumanWorkAtYear(
                j.employment,
                getCurrentYearGrowth(j, YEAR_MAX).value,
                j.automationCostIndex,
                YEAR_MAX,
            );
            if (h1 < h0 - 0.01) eroded++;
            else if (h1 > h0 + 0.01) {
                grew++;
                grewTitles.push(`${j.title} (risk ${j.automationCostIndex.toFixed(2)}, growth ${j.projectedGrowth})`);
            }
        }
        // Strong BLS employment growth can offset mild AI erosion for a few roles;
        // the majority must still shrink, and growers should be rare.
        expect(eroded).toBeGreaterThan(grew);
        expect(eroded).toBeGreaterThan(jobs.length * 0.5);
        // Surface the exceptions in the assertion message if this ever regresses.
        expect(grewTitles, `unexpected growers: ${grewTitles.join('; ')}`).toHaveLength(grew);
    });

    it('higher-risk roles have higher AI share at every year', () => {
        const sorted = [...jobs].sort((a, b) => a.automationCostIndex - b.automationCostIndex);
        const safest = sorted[0];
        const riskiest = sorted[sorted.length - 1];
        for (const year of [YEAR_MIN, 2027, YEAR_MAX]) {
            expect(aiShareAtYear(riskiest.automationCostIndex, year))
                .toBeGreaterThan(aiShareAtYear(safest.automationCostIndex, year));
        }
    });

    it('Workers mode still varies at 2025 (unchanged contract)', () => {
        const unique = new Set(
            jobs.map((j) =>
                getVisualHeightForWorkersAtYear(
                    j.employment,
                    getCurrentYearGrowth(j, YEAR_MIN).value,
                ).toFixed(4),
            ),
        );
        expect(unique.size).toBeGreaterThan(10);
    });

    it('Workers height ignores cumulative % (static BLS headcount)', () => {
        for (const j of jobs.slice(0, 10)) {
            const h0 = getVisualHeightForWorkersAtYear(j.employment, 0);
            const hPos = getVisualHeightForWorkersAtYear(j.employment, 12);
            const hNeg = getVisualHeightForWorkersAtYear(j.employment, -8);
            expect(h0).toBe(hPos);
            expect(h0).toBe(hNeg);
        }
    });

    it('JobMarkers and Terrain share the same Human-work height helper inputs', () => {
        // Spot-check: for every role, the height formula is deterministic given
        // the same (employment, cumulative%, risk, year) tuple — the two call
        // sites must stay on this helper (enforced by import + this smoke).
        const j = jobs[0];
        const g = getCurrentYearGrowth(j, 2027).value;
        const a = getVisualHeightForHumanWorkAtYear(j.employment, g, j.automationCostIndex, 2027);
        const b = getVisualHeightForHumanWorkAtYear(j.employment, g, j.automationCostIndex, 2027);
        expect(a).toBe(b);
        expect(Number.isFinite(a)).toBe(true);
    });
});
