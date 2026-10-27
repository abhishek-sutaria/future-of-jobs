/**
 * One list of "roles" for the whole app: the 50 Kelley roles (with their
 * published AI scores, from src/data.ts + ai_scores.json) and every other BLS
 * detailed occupation (no AI scores yet), from src/data/occupations/.
 *
 * An adapter, not a merge: Kelley jobs stay the store's Job objects, untouched.
 * A SOC that a Kelley title maps to is represented by that title only, so a
 * Kelley role and its BLS occupation never appear twice. Kelley titles that
 * share a SOC (Marketing / Brand Manager, BI Analyst / Data Scientist, Buyer /
 * Purchasing Agent) stay as their own titles, as they always have.
 */

import type { Job } from '../types';
import { MAP_TITLE_TO_SOC } from './onet';
import { OCCUPATION_INDEX, continentOf, type IndexOccupation } from './occupationIndex';

export type RoleKind = 'kelley' | 'bls';

export interface RoleEntry {
    /** Stable id: the Kelley job id ("job-36"), or "soc:<SOC>" for a BLS occupation. */
    key: string;
    kind: RoleKind;
    /** Kelley title, or the official BLS title. */
    title: string;
    soc: string;
    /** Two-digit SOC major code of the role's continent. */
    continent: string;
    /** Official BLS OEWS title for the SOC (a search alias for Kelley titles). */
    blsTitle: string;
    /**
     * Peak path, BLS EP employment in persons. Kelley titles that share a SOC
     * carry their equal share, exactly as the 3D view has always split them.
     */
    ep2025: number | null;
    ep2035: number | null;
    /** BLS EP percent change 2025–35. */
    epPercentChange: number | null;
    /** True only for a Kelley role whose published task scores are loaded. */
    scored: boolean;
    jobId?: string;
}

export const blsRoleKey = (soc: string): string => `soc:${soc}`;

export const isJobScored = (job: Job): boolean =>
    job.tasks.some((t) => t.aiCapabilityScore > 0 || t.humanCriticalityScore > 0);

/** Every role, in SOC order (the order regions and peaks are laid out in). */
export function buildRoleEntries(jobs: readonly Job[]): RoleEntry[] {
    const kelleyBySoc = new Map<string, Job[]>();
    for (const job of jobs) {
        const soc = MAP_TITLE_TO_SOC[job.title];
        if (!soc) throw new Error(`Kelley role "${job.title}" has no SOC in MAP_TITLE_TO_SOC`);
        const list = kelleyBySoc.get(soc);
        if (list) list.push(job);
        else kelleyBySoc.set(soc, [job]);
    }

    const out: RoleEntry[] = [];
    const placed = new Set<string>();
    for (const occ of OCCUPATION_INDEX.occupations) {
        const kelley = kelleyBySoc.get(occ.soc);
        if (!kelley) {
            out.push(blsEntry(occ));
            continue;
        }
        for (const job of [...kelley].sort((a, b) => a.title.localeCompare(b.title))) {
            placed.add(job.id);
            out.push({
                key: job.id,
                kind: 'kelley',
                title: job.title,
                soc: occ.soc,
                continent: continentOf(occ.soc),
                blsTitle: occ.title,
                ep2025: job.epEmployment2025 ?? null,
                ep2035: job.epEmployment2035 ?? null,
                epPercentChange: job.projectedGrowth,
                scored: isJobScored(job),
                jobId: job.id,
            });
        }
    }
    const missing = jobs.filter((j) => !placed.has(j.id));
    if (missing.length > 0) {
        throw new Error(`Kelley roles with no BLS occupation row: ${missing.map((j) => j.title).join(', ')}`);
    }
    return out;
}

function blsEntry(occ: IndexOccupation): RoleEntry {
    return {
        key: blsRoleKey(occ.soc),
        kind: 'bls',
        title: occ.title,
        soc: occ.soc,
        continent: continentOf(occ.soc),
        blsTitle: occ.title,
        ep2025: occ.epEmployment2025,
        ep2035: occ.epEmployment2035,
        epPercentChange: occ.epPercentChange,
        scored: false,
    };
}

const normalize = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9-]+/g, ' ').trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Title search over every role, in tiers, larger EP 2025 employment first
 * within each tier:
 *   0  the exact title ("actors", "registered nurses")
 *   1  whole-word match anywhere in the title ("nurse" in Registered Nurses)
 *   2  partial match inside a word ("nurse" in Nursery)
 *   3  the official BLS title, for Kelley titles ("management analysts")
 *   4  SOC code prefix
 * Words match singular or plural, so "nurse" finds "Nurses" as a whole word.
 * Start-of-title matches are not ranked above other whole-word matches: that
 * would put Nurse Practitioners, Anesthetists and Midwives above Registered
 * Nurses, the occupation most students mean.
 */
export function searchRoles(entries: readonly RoleEntry[], query: string, limit = 40): RoleEntry[] {
    const q = normalize(query);
    if (q.length < 2) return [];
    const plural = `${escapeRe(q)}(?:s|es)?`;
    const exact = new RegExp(`^${plural}$`);
    const word = new RegExp(`(?:^| )${plural}(?: |$)`);
    const scored: { entry: RoleEntry; rank: number }[] = [];
    for (const entry of entries) {
        const title = normalize(entry.title);
        const bls = normalize(entry.blsTitle);
        let rank: number;
        if (exact.test(title) || exact.test(`${title}s`)) rank = 0;
        else if (word.test(title)) rank = 1;
        else if (title.includes(q)) rank = 2;
        else if (bls.includes(q)) rank = 3;
        else if (entry.soc.startsWith(query.trim())) rank = 4;
        else continue;
        scored.push({ entry, rank });
    }
    scored.sort((a, b) => a.rank - b.rank || (b.entry.ep2025 ?? 0) - (a.entry.ep2025 ?? 0) || a.entry.title.localeCompare(b.entry.title));
    return scored.slice(0, limit).map((s) => s.entry);
}

const entriesCache = new WeakMap<readonly Job[], RoleEntry[]>();

/** buildRoleEntries, cached per jobs array (the store replaces the array on every update). */
export function getRoleEntries(jobs: readonly Job[]): RoleEntry[] {
    let entries = entriesCache.get(jobs);
    if (!entries) {
        entries = buildRoleEntries(jobs);
        entriesCache.set(jobs, entries);
    }
    return entries;
}

/** How many Kelley titles sit in each continent. */
export function kelleyCountByContinent(jobs: readonly Job[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const job of jobs) {
        const soc = MAP_TITLE_TO_SOC[job.title];
        if (soc) counts.set(continentOf(soc), (counts.get(continentOf(soc)) ?? 0) + 1);
    }
    return counts;
}
