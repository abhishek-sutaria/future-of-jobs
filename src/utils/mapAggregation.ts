/**
 * Map aggregation utilities.
 *
 * All aggregation is done at the SOC-code level, not the job-title level, so
 * that alias titles sharing a SOC (e.g. "Marketing Manager" and "Brand Manager"
 * both map to 11-2021) are counted once per state rather than twice.
 *
 * Employment values come directly from BLS OES May 2023 (TOT_EMP).
 * Location Quotient (lq) values come from BLS OES LOC_QUOTIENT.
 */

import { MAP_TITLE_TO_SOC } from './onet';
import type { Job } from '../types';

export interface GeoLocation {
    name: string;
    lat: number;
    lng: number;
    employment: number;
    lq: number;
}

export interface StateAggregate {
    /** BLS OES employment summed once per unique SOC code. */
    totalEmployment: number;
    /** Breakdown by SOC code (de-duped). */
    bySoc: Array<{
        soc: string;
        /** All job titles that share this SOC code (from the active selection). */
        titles: string[];
        employment: number;
        /** BLS Location Quotient for this occupation in this state. */
        lq: number | null;
    }>;
    /** Marker coordinates (Census centroid — display only, not BLS data). */
    coordinates: [number, number];
}

/**
 * Aggregate state employment for a list of active jobs, de-duplicating by SOC code.
 *
 * @param activeJobs - The jobs currently visible/selected.
 * @returns A map of state name → StateAggregate and the maximum employment across
 *          all states (for choropleth scale).
 */
export function aggregateByState(activeJobs: Job[]): {
    stateData: Record<string, StateAggregate>;
    maxEmployment: number;
} {
    // Group jobs by SOC code first, then collect state data once per SOC.
    // Key: socCode → { titles[], locations[] }
    const bySoc: Record<string, { titles: string[]; locations: GeoLocation[] }> = {};

    for (const job of activeJobs) {
        const soc = MAP_TITLE_TO_SOC[job.title];
        if (!soc || !job.locations) continue;

        if (!bySoc[soc]) {
            bySoc[soc] = { titles: [], locations: job.locations as GeoLocation[] };
        }
        // Collect titles; only take locations from the first job for this SOC
        // (all alias titles share the same BLS rows — taking them multiple times
        // would double-count).
        if (!bySoc[soc].titles.includes(job.title)) {
            bySoc[soc].titles.push(job.title);
        }
    }

    // Now build per-state aggregates from the de-duped SOC map.
    const stateMap: Record<string, StateAggregate> = {};

    for (const [soc, { titles, locations }] of Object.entries(bySoc)) {
        for (const loc of locations) {
            if (!stateMap[loc.name]) {
                stateMap[loc.name] = {
                    totalEmployment: 0,
                    bySoc: [],
                    coordinates: [loc.lng, loc.lat],
                };
            }
            stateMap[loc.name].totalEmployment += loc.employment;
            stateMap[loc.name].bySoc.push({
                soc,
                titles,
                employment: loc.employment,
                lq: loc.lq ?? null,
            });
        }
    }

    // Sort each state's SOC breakdown by employment descending.
    for (const agg of Object.values(stateMap)) {
        agg.bySoc.sort((a, b) => b.employment - a.employment);
    }

    const maxEmployment = Math.max(...Object.values(stateMap).map((d) => d.totalEmployment), 1);

    return { stateData: stateMap, maxEmployment };
}
