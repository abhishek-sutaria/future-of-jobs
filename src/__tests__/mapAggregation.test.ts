/**
 * Unit tests for src/utils/mapAggregation.ts
 *
 * Key invariants verified:
 * 1. Titles sharing a SOC code are NOT double-counted in state employment totals.
 * 2. Employment is summed from the FIRST job that provides locations for a SOC;
 *    duplicate titles add no additional employment.
 * 3. States with no data for the active selection are absent from stateData.
 * 4. maxEmployment matches the highest state total in the result.
 */

import { describe, it, expect } from 'vitest';
import { aggregateByState } from '../utils/mapAggregation';
import type { Job } from '../types';

// Minimal Job stub — only the fields required by the Job type.
function makeJob(title: string, locations: Array<{ name: string; lat: number; lng: number; employment: number; lq: number }>, id = title): Job {
    return {
        id,
        title,
        cluster: 'Tech',
        employment: 100000,
        automationCostIndex: 0.5,
        projectedGrowth: 5,
        salaryVolatilityLabel: 'Medium',
        humanResilienceLabel: 'Medium',
        confidenceScore: 1,
        dataSources: [],
        isAlias: false,
        tasks: [],
        locations: locations as Job['locations'],
    };
}

// Marketing Manager and Brand Manager both map to SOC 11-2021 (via MAP_TITLE_TO_SOC).
// When both are active, California employment should be counted ONCE, not twice.
describe('SOC-level de-duplication', () => {
    it('Marketing Manager + Brand Manager (both → 11-2021) count California once', () => {
        const marketingMgr = makeJob('Marketing Manager', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 59830, lq: 1.21 },
            { name: 'New York', lat: 40.71, lng: -74.01, employment: 30000, lq: 1.05 },
        ]);

        const brandMgr = makeJob('Brand Manager', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 59830, lq: 1.21 },
            { name: 'New York', lat: 40.71, lng: -74.01, employment: 30000, lq: 1.05 },
        ]);

        const { stateData } = aggregateByState([marketingMgr, brandMgr]);

        // California: should be 59,830 (once), NOT 119,660 (twice)
        expect(stateData['California']?.totalEmployment).toBe(59830);
        // New York: should be 30,000 (once)
        expect(stateData['New York']?.totalEmployment).toBe(30000);
    });

    it('both alias titles appear under the same SOC bySoc entry', () => {
        const marketingMgr = makeJob('Marketing Manager', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 59830, lq: 1.21 },
        ]);
        const brandMgr = makeJob('Brand Manager', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 59830, lq: 1.21 },
        ]);

        const { stateData } = aggregateByState([marketingMgr, brandMgr]);

        const ca = stateData['California'];
        expect(ca).toBeDefined();
        // Only one bySoc entry for the SOC, containing both titles
        expect(ca?.bySoc).toHaveLength(1);
        expect(ca?.bySoc[0].titles).toContain('Marketing Manager');
        expect(ca?.bySoc[0].titles).toContain('Brand Manager');
    });
});

// Wholesale & Retail Buyer and Purchasing Agent both map to 13-1020.
//
// BLS retired the detailed codes 13-1022/13-1023 and now publishes only the
// combined broad code 13-1020 "Buyers and Purchasing Agents" (verified against
// OEWS May 2025). Both titles therefore share one published estimate, and the
// de-dup rule must stop that estimate being counted twice on the map.
describe('Wholesale & Retail Buyer + Purchasing Agent (both → 13-1020)', () => {
    it('Texas employment counted once', () => {
        const buyer = makeJob('Wholesale & Retail Buyer', [
            { name: 'Texas', lat: 31.97, lng: -99.9, employment: 44030, lq: 0.95 },
        ]);
        const agent = makeJob('Purchasing Agent', [
            { name: 'Texas', lat: 31.97, lng: -99.9, employment: 44030, lq: 0.95 },
        ]);

        const { stateData } = aggregateByState([buyer, agent]);
        expect(stateData['Texas']?.totalEmployment).toBe(44030);
        expect(stateData['Texas']?.bySoc).toHaveLength(1);
    });
});

// Risk Specialist (13-2099) and Financial Risk Analyst (13-2054) are DISTINCT.
//
// These previously both mapped to 13-2099 "Financial Specialists, All Other",
// a residual catch-all. O*NET lists "Financial Risk Analyst" as an explicit
// Alternate Title of 13-2054.00 "Financial Risk Specialists", which BLS
// publishes at the detailed level, so they are no longer aliases and their
// employment must sum rather than de-dupe.
describe('Risk Specialist (13-2099) vs Financial Risk Analyst (13-2054)', () => {
    it('are separate SOC codes and sum independently', () => {
        const riskSpec = makeJob('Risk Specialist', [
            { name: 'Texas', lat: 31.97, lng: -99.9, employment: 8000, lq: 0.95 },
        ]);
        const finRisk = makeJob('Financial Risk Analyst', [
            { name: 'Texas', lat: 31.97, lng: -99.9, employment: 5000, lq: 0.9 },
        ]);

        const { stateData } = aggregateByState([riskSpec, finRisk]);
        expect(stateData['Texas']?.totalEmployment).toBe(13000);
        expect(stateData['Texas']?.bySoc).toHaveLength(2);
    });
});

// Two jobs with DIFFERENT SOC codes should sum normally.
describe('Different SOC codes sum independently', () => {
    it('Software Developer (15-1252) + Financial Analyst (13-2051) sum in California', () => {
        const swDev = makeJob('Software Developer', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 304390, lq: 1.38 },
        ]);
        const finAnalyst = makeJob('Financial Analyst', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 30000, lq: 1.10 },
        ]);

        const { stateData } = aggregateByState([swDev, finAnalyst]);
        expect(stateData['California']?.totalEmployment).toBe(304390 + 30000);
    });
});

// maxEmployment should be the highest total across all states.
describe('maxEmployment calculation', () => {
    it('returns the highest state total', () => {
        const job = makeJob('Software Developer', [
            { name: 'California', lat: 36.78, lng: -119.42, employment: 300000, lq: 1.38 },
            { name: 'Texas', lat: 31.97, lng: -99.9, employment: 100000, lq: 0.75 },
        ]);

        const { maxEmployment } = aggregateByState([job]);
        expect(maxEmployment).toBe(300000);
    });
});

// Empty active jobs → empty stateData.
describe('edge cases', () => {
    it('returns empty stateData for empty job list', () => {
        const { stateData, maxEmployment } = aggregateByState([]);
        expect(Object.keys(stateData)).toHaveLength(0);
        expect(maxEmployment).toBe(1); // falls back to 1 to avoid division-by-zero
    });

    it('skips jobs with no locations', () => {
        const job = makeJob('Software Developer', []);
        const { stateData } = aggregateByState([job]);
        expect(Object.keys(stateData)).toHaveLength(0);
    });

    it('LQ is preserved correctly in bySoc', () => {
        const job = makeJob('Software Developer', [
            { name: 'Virginia', lat: 37.43, lng: -78.66, employment: 50000, lq: 2.15 },
        ]);
        const { stateData } = aggregateByState([job]);
        expect(stateData['Virginia']?.bySoc[0].lq).toBe(2.15);
    });
});
