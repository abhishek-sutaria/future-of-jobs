/**
 * The role adapter (utils/roles): one list covering the 50 Kelley roles and
 * every other BLS occupation, with no occupation shown twice, and the search
 * over it.
 */

import { describe, it, expect } from 'vitest';
import { useStore } from '../store';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { OCCUPATION_INDEX } from '../utils/occupationIndex';
import { buildRoleEntries, searchRoles, type RoleEntry } from '../utils/roles';
import scoresJson from '../data/ai_scores.json';

const jobs = useStore.getState().jobs;
const entries = buildRoleEntries(jobs);
const kelley = entries.filter((e) => e.kind === 'kelley');
const bls = entries.filter((e) => e.kind === 'bls');

describe('role adapter', () => {
    it('lists all 50 Kelley roles and every other BLS occupation once', () => {
        expect(kelley).toHaveLength(50);
        const kelleySocs = new Set(Object.values(MAP_TITLE_TO_SOC));
        expect(kelleySocs.size).toBe(47);
        expect(bls).toHaveLength(OCCUPATION_INDEX.occupations.length - kelleySocs.size);
        expect(entries).toHaveLength(833);
        expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    });

    it('never shows a Kelley role and its BLS occupation both', () => {
        const kelleySocs = new Set(kelley.map((e) => e.soc));
        for (const e of bls) expect(kelleySocs.has(e.soc), e.title).toBe(false);
        // Every index occupation is covered: by its own entry, or by its Kelley title(s).
        const covered = new Set(entries.map((e) => e.soc));
        for (const o of OCCUPATION_INDEX.occupations) expect(covered.has(o.soc), o.soc).toBe(true);
    });

    it('keeps Kelley titles that share a SOC as their own titles', () => {
        const bySoc = (soc: string) => kelley.filter((e) => e.soc === soc).map((e) => e.title).sort();
        expect(bySoc('11-2021')).toEqual(['Brand Manager', 'Marketing Manager']);
        expect(bySoc('15-2051')).toEqual(['Business Intelligence Analyst', 'Data Scientist']);
        expect(bySoc('13-1020')).toEqual(['Purchasing Agent', 'Wholesale & Retail Buyer']);
    });

    it('points every Kelley entry at its unchanged store job, scored with the published set', () => {
        const scores = (scoresJson as unknown as { scores: Record<string, unknown> }).scores;
        for (const e of kelley) {
            const job = jobs.find((j) => j.id === e.jobId)!;
            expect(job.title).toBe(e.title);
            expect(e.scored).toBe(true);
            expect(scores[job.id], job.title).toBeTruthy();
            expect(e.ep2025).toBe(job.epEmployment2025);
            expect(e.ep2035).toBe(job.epEmployment2035);
        }
    });

    it('marks every other occupation as not scored, with its EP numbers from the index', () => {
        for (const e of bls) {
            const row = OCCUPATION_INDEX.occupations.find((o) => o.soc === e.soc)!;
            expect(e.scored).toBe(false);
            expect(e.title).toBe(row.title);
            expect(e.ep2025).toBe(row.epEmployment2025);
            expect(e.ep2035).toBe(row.epEmployment2035);
            expect(e.epPercentChange).toBe(row.epPercentChange);
        }
    });
});

describe('search', () => {
    const titles = (q: string) => searchRoles(entries, q).map((r: RoleEntry) => r.title);

    it('finds Actors, Registered Nurses and Electricians from everyday words', () => {
        expect(titles('actor')[0]).toBe('Actors');
        expect(titles('Actors')[0]).toBe('Actors');
        expect(titles('nurse')).toContain('Registered Nurses');
        expect(titles('registered nurses')[0]).toBe('Registered Nurses');
        expect(titles('electrician')[0]).toBe('Electricians');
    });

    it('finds every Kelley title, first, by its own name', () => {
        for (const job of jobs) expect(titles(job.title)[0], job.title).toBe(job.title);
    });

    it('finds a Kelley role by its official BLS title too', () => {
        expect(titles('Management Analysts')).toContain('Management Consultant');
    });

    it('finds every occupation by its exact BLS title', () => {
        for (const e of bls) expect(titles(e.title), e.title).toContain(e.title);
    });

    it('ignores one-letter queries', () => {
        expect(searchRoles(entries, 'a')).toEqual([]);
    });
});
