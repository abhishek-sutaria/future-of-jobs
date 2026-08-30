/**
 * Guards the OES vintage refresh (scripts/refresh_oes_data.mjs).
 *
 * The vintage is deliberately SPLIT: national per-job employment in
 * src/data.ts (drives terrain height, the Workers stat, the "OES" badge) is a
 * separate extract from state-level employment/LQ in src/data/geo_real.json
 * (drives the 2D map) — see AGENTS.md "OES vintage is SPLIT" and each file's
 * own header comment / _meta block. These tests check each independently and
 * check the couplings between them that have no other test coverage.
 */

import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import { DATA_SOURCES } from '../config/constants';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import geoRealRaw from '../data/geo_real.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const geoReal = geoRealRaw as any;

describe('National employment vintage (src/data.ts)', () => {
    it('every job has a positive employment figure', () => {
        for (const job of initialJobs) {
            expect(job.employment, `${job.title} employment`).toBeGreaterThan(0);
        }
    });

    it('every job carries the current DATA_SOURCES.BLS_OES literal, not a stale one', () => {
        for (const job of initialJobs) {
            expect(job.dataSources, `${job.title} dataSources`).toContain(DATA_SOURCES.BLS_OES);
            const staleOes = job.dataSources.filter(
                (s) => /^BLS-OES-\d{4}$/.test(s) && s !== DATA_SOURCES.BLS_OES
            );
            expect(staleOes, `${job.title} has a stale OES vintage literal`).toHaveLength(0);
        }
    });

    it('DATA_SOURCES.BLS_OES is a well-formed "BLS-OES-<year>" literal', () => {
        expect(DATA_SOURCES.BLS_OES).toMatch(/^BLS-OES-\d{4}$/);
    });
});

describe('SOC map ↔ geo_real.json key parity (src/utils/onet.ts)', () => {
    const uniqueSocs = [...new Set(Object.values(MAP_TITLE_TO_SOC))];
    const geoSocKeys = Object.keys(geoReal).filter((k) => k !== '_meta');

    it('every SOC used by a job title has a key in geo_real.json (possibly empty)', () => {
        const missing = uniqueSocs.filter((soc) => !geoSocKeys.includes(soc));
        expect(missing, 'missing SOC keys').toHaveLength(0);
    });

    it('geo_real.json has no orphaned SOC keys unused by any job title', () => {
        const orphaned = geoSocKeys.filter((soc) => !uniqueSocs.includes(soc));
        expect(orphaned, 'orphaned SOC keys').toHaveLength(0);
    });

    it('the retired detailed codes 13-1022/13-1023 are gone, replaced by the broad code 13-1020', () => {
        expect(Object.values(MAP_TITLE_TO_SOC)).not.toContain('13-1022');
        expect(Object.values(MAP_TITLE_TO_SOC)).not.toContain('13-1023');
        expect(Object.values(MAP_TITLE_TO_SOC)).toContain('13-1020');
    });

    it('Wholesale & Retail Buyer and Purchasing Agent are aliases sharing the broad code', () => {
        expect(MAP_TITLE_TO_SOC['Wholesale & Retail Buyer']).toBe('13-1020');
        expect(MAP_TITLE_TO_SOC['Purchasing Agent']).toBe('13-1020');
    });

    it('Financial Risk Analyst no longer aliases Risk Specialist (13-2099)', () => {
        expect(MAP_TITLE_TO_SOC['Financial Risk Analyst']).toBe('13-2054');
        expect(MAP_TITLE_TO_SOC['Risk Specialist']).toBe('13-2099');
        expect(MAP_TITLE_TO_SOC['Financial Risk Analyst']).not.toBe(MAP_TITLE_TO_SOC['Risk Specialist']);
    });
});

describe('geo_real.json state-level vintage (src/data/geo_real.json)', () => {
    it('carries its own non-empty vintage string, independent of DATA_SOURCES.BLS_OES', () => {
        expect(typeof geoReal._meta?.bls_release).toBe('string');
        expect(geoReal._meta.bls_release.length).toBeGreaterThan(0);
    });

    it('every populated SOC has only positive employment and non-negative LQ rows', () => {
        for (const [soc, rows] of Object.entries(geoReal)) {
            if (soc === '_meta') continue;
            for (const row of rows as Array<{ employment: number; lq: number }>) {
                expect(row.employment, `${soc} row employment`).toBeGreaterThan(0);
                expect(row.lq, `${soc} row lq`).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('the newly-introduced SOCs (13-1020, 13-2054) have real state-level rows, not just empty placeholder keys', () => {
        // Before the state-level refresh these existed only as empty arrays
        // (key present so audit T57/T58 pass, but no rows loaded yet — see
        // git history). The full refresh must have actually populated them.
        expect(geoReal['13-1020'].length).toBeGreaterThan(0);
        expect(geoReal['13-2054'].length).toBeGreaterThan(0);
    });
});
