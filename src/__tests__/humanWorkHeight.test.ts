import { describe, expect, it } from 'vitest';
import {
    aiShareAtYear,
    getVisualHeightForHumanWorkAtYear,
    getVisualHeightForGrowth,
} from '../utils/terrainMath';
import { YEAR_MIN, YEAR_MAX } from '../config/constants';

describe('aiShareAtYear', () => {
    it('equals published risk at YEAR_MIN', () => {
        expect(aiShareAtYear(0.4, YEAR_MIN)).toBeCloseTo(0.4, 5);
        expect(aiShareAtYear(0.7, YEAR_MIN)).toBeCloseTo(0.7, 5);
    });

    it('rises toward fuller automation by YEAR_MAX', () => {
        const start = aiShareAtYear(0.4, YEAR_MIN);
        const end = aiShareAtYear(0.4, YEAR_MAX);
        expect(end).toBeGreaterThan(start);
        // Halfway from 0.4 to 1.0 → 0.7
        expect(end).toBeCloseTo(0.4 + (1 - 0.4) * 0.5, 5);
    });

    it('clamps published risk into [0, 1]', () => {
        expect(aiShareAtYear(-0.2, YEAR_MIN)).toBe(0);
        expect(aiShareAtYear(1.4, YEAR_MIN)).toBe(1);
    });
});

describe('getVisualHeightForHumanWorkAtYear', () => {
    const employment = 100_000;

    it('gives different heights at 2025 for different risk scores (no flat baseline)', () => {
        const lowRisk = getVisualHeightForHumanWorkAtYear(employment, 0, 0.25, YEAR_MIN);
        const highRisk = getVisualHeightForHumanWorkAtYear(employment, 0, 0.75, YEAR_MIN);
        expect(lowRisk).toBeGreaterThan(highRisk);
        // Old Growth encoding was identical for every role at 0% cumulative.
        expect(getVisualHeightForGrowth(0)).toBe(getVisualHeightForGrowth(0));
    });

    it('erodes high-risk peaks as the year advances', () => {
        const at2025 = getVisualHeightForHumanWorkAtYear(employment, 0, 0.6, YEAR_MIN);
        const at2030 = getVisualHeightForHumanWorkAtYear(employment, 10, 0.6, YEAR_MAX);
        expect(at2030).toBeLessThan(at2025);
    });

    it('keeps safer roles taller than riskier ones at the same year', () => {
        const safe = getVisualHeightForHumanWorkAtYear(employment, 5, 0.2, 2027);
        const risky = getVisualHeightForHumanWorkAtYear(employment, 5, 0.8, 2027);
        expect(safe).toBeGreaterThan(risky);
    });
});
