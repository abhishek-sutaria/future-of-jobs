import { describe, it, expect } from 'vitest';
import { useStore } from '../store';
import { YEAR_MIN, YEAR_MAX, DATA_SOURCES } from '../config/constants';
import {
    epEmploymentAtYear,
    getVisualHeightForEpEmployment,
    blsEpGrowthPathPoints,
    LINEAR_EMP_REF,
} from '../utils/terrainMath';
import blsEp from '../data/bls_ep_2025_2035.json';
import { MAP_TITLE_TO_SOC } from '../utils/onet';

describe('BLS EP landscape path', () => {
    const jobs = () => useStore.getState().jobs;

    it('every role has EP 2025 and 2035 levels attached', () => {
        for (const j of jobs()) {
            expect(j.epEmployment2025, j.title).toBeGreaterThan(0);
            expect(j.epEmployment2035, j.title).toBeGreaterThan(0);
            expect(j.dataSources).toContain(DATA_SOURCES.BLS_EP);
        }
    });

    it('interpolates linearly between EP endpoints', () => {
        const j = jobs().find((x) => x.title === 'Data Scientist')!;
        // Shared SOC split in half for terrain mass conservation.
        const mid = epEmploymentAtYear(j, 2030);
        expect(mid).toBeCloseTo(
            (j.epEmployment2025! + j.epEmployment2035!) / 2,
            0,
        );
        expect(epEmploymentAtYear(j, YEAR_MIN)).toBeCloseTo(j.epEmployment2025!, 0);
        expect(epEmploymentAtYear(j, YEAR_MAX)).toBeCloseTo(j.epEmployment2035!, 0);
    });

    it('uses linear (not log) visual height', () => {
        const half = getVisualHeightForEpEmployment(LINEAR_EMP_REF / 2);
        const full = getVisualHeightForEpEmployment(LINEAR_EMP_REF);
        const zero = getVisualHeightForEpEmployment(0);
        // Midpoint of the visual range, not log-compressed.
        expect(half).toBeCloseTo(zero + (full - zero) / 2, 5);
    });

    it('EP extract covers every mapped SOC', () => {
        const socs = new Set(Object.values(MAP_TITLE_TO_SOC));
        for (const soc of socs) {
            expect(blsEp.by_soc[soc as keyof typeof blsEp.by_soc], soc).toBeTruthy();
        }
    });

    it('role-panel growth path is a straight line from 0% to the EP decade %', () => {
        const points = blsEpGrowthPathPoints(10);
        expect(points).toHaveLength(YEAR_MAX - YEAR_MIN + 1);
        expect(points[0]).toBe(0);
        expect(points[points.length - 1]).toBe(10);
        expect(points[5]).toBeCloseTo(5, 5); // midpoint year 2030
    });
});
