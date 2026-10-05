import { describe, it, expect } from 'vitest';
import { OOH_FRACTION_AT_YEAR_MAX, YEAR_MAX, YEAR_MIN, OOH_ENDPOINT_YEAR } from '../config/constants';
import { oohEnvelopeCap, oohFractionAtYear, getCurrentYearGrowth } from '../utils/terrainMath';
import type { Job } from '../types';

describe('OOH decade → 2030 envelope', () => {
    it('caps YEAR_MAX at 5/9 of the 10-year OOH figure', () => {
        expect(OOH_FRACTION_AT_YEAR_MAX).toBeCloseTo(5 / 9, 5);
        expect(oohEnvelopeCap(18)).toBeCloseTo(10, 5);
        expect(oohEnvelopeCap(-9)).toBeCloseTo(-5, 5);
    });

    it('treats 2025 as the zero baseline and 2034 as full OOH', () => {
        expect(oohFractionAtYear(YEAR_MIN)).toBe(0);
        expect(oohFractionAtYear(OOH_ENDPOINT_YEAR)).toBe(1);
        expect(oohFractionAtYear(YEAR_MAX)).toBeCloseTo(OOH_FRACTION_AT_YEAR_MAX, 5);
    });

    it('baseline ramp reaches only the YEAR_MAX fraction, not full OOH', () => {
        const job = {
            projectedGrowth: 18,
            yearlyForecast: undefined,
        } as Job;
        expect(getCurrentYearGrowth(job, YEAR_MIN).value).toBeCloseTo(0, 5);
        expect(getCurrentYearGrowth(job, YEAR_MAX).value).toBeCloseTo(oohEnvelopeCap(18), 5);
        expect(Math.abs(getCurrentYearGrowth(job, YEAR_MAX).value)).toBeLessThan(18);
    });
});
