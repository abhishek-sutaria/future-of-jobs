/**
 * Guards the provenance badges on the job detail panel.
 *
 * These exist because of a bug class scripts/audit.mjs already warned about
 * for OES: the chips match `job.dataSources` by exact string, so a literal in
 * config/constants.ts that drifts from the literal in data.ts silently drops a
 * badge with nothing failing. ONET drifted exactly that way and shipped
 * broken — `ONET: 'ONET'` against data that says 'O*NET-30.1' — which also
 * silently disabled CONFIDENCE.ONET_BONUS, because the '*' makes
 * `'O*NET-30.1'.includes('ONET')` false. Nothing caught either one.
 */

import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import { DATA_SOURCES } from '../config/constants';
import { jobSourceProvenanceChips, panelSourceList, provenanceLabel } from '../utils/provenance';

describe('Source literals stay in sync with the data', () => {
    it('every DATA_SOURCES literal that data.ts uses appears verbatim in data.ts', () => {
        const used = new Set(initialJobs.flatMap((j) => j.dataSources ?? []));
        for (const literal of [DATA_SOURCES.BLS_OES, DATA_SOURCES.BLS_OOH, DATA_SOURCES.ONET]) {
            expect(used.has(literal)).toBe(true);
        }
    });

    it('every job declares its O*NET provenance, because every job has O*NET tasks', () => {
        for (const job of initialJobs) {
            expect(job.tasks.length).toBeGreaterThan(0);
            expect(job.dataSources).toContain(DATA_SOURCES.ONET);
        }
    });

    it('the ONET confidence bonus condition actually matches (store.ts)', () => {
        // store.ts awards CONFIDENCE.ONET_BONUS on exactly this predicate.
        for (const job of initialJobs) {
            expect(job.dataSources.includes(DATA_SOURCES.ONET)).toBe(true);
        }
    });
});

describe('Panel provenance chips', () => {
    it('renders an O*NET chip for every job', () => {
        for (const job of initialJobs) {
            expect(jobSourceProvenanceChips(job).map((c) => c.key)).toContain('onet');
        }
    });

    it('never renders State OES — that provenance belongs to the map view', () => {
        for (const job of initialJobs) {
            const chips = jobSourceProvenanceChips(job);
            expect(chips.map((c) => c.key)).not.toContain('st');
            expect(chips.map((c) => c.label)).not.toContain('State OES');
        }
    });

    it('distinguishes proxy-sourced O*NET tasks from an exact O*NET match', () => {
        const alias = initialJobs.find((j) => j.isAlias);
        const exact = initialJobs.find((j) => !j.isAlias);
        expect(alias).toBeDefined();
        expect(exact).toBeDefined();

        const chipFor = (job: typeof initialJobs[number]) =>
            jobSourceProvenanceChips(job).find((c) => c.key === 'onet')!;

        expect(chipFor(alias!).provenance).toBe('ONET_PROXY');
        expect(chipFor(exact!).provenance).toBe('ONET');
        // Same badge label either way; only the explanation differs.
        expect(chipFor(alias!).label).toBe(chipFor(exact!).label);
        expect(provenanceLabel('ONET_PROXY')).not.toBe(provenanceLabel('ONET'));
        expect(provenanceLabel('ONET_PROXY')).toMatch(/closest matching occupation/i);
    });

    it('keeps the footer source line consistent with the chips', () => {
        for (const job of initialJobs) {
            expect(panelSourceList(job)).not.toContain(DATA_SOURCES.BLS_STATE);
        }
        expect(panelSourceList({ ...initialJobs[0], dataSources: [] })).toEqual(['Modeled']);
    });
});

describe('Badge explanations', () => {
    it('describes the AI forecast as a prediction, not a guess', () => {
        const label = provenanceLabel('CLAUDE_FORECAST');
        expect(label).toMatch(/prediction/i);
        expect(label).not.toMatch(/guess/i);
        // It must keep naming the BLS anchor it is built on.
        expect(label).toMatch(/BLS OOH/);
    });

    it('no badge explanation calls any figure a guess', () => {
        const chips = initialJobs.flatMap((j) => jobSourceProvenanceChips(j));
        for (const chip of chips) {
            expect(provenanceLabel(chip.provenance)).not.toMatch(/guess/i);
        }
    });
});
