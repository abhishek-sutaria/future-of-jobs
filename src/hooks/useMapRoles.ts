import React from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { isOnStage } from '../utils/worldLevel';
import { INDEX_CONTINENTS } from '../utils/occupationIndex';
import { getRoleEntries } from '../utils/roles';
import { stateRowsFor } from '../utils/stateMapData';
import type { GeoLocation } from '../utils/mapAggregation';
import type { Job } from '../types';

/** One job on the state map: a Kelley title or a BLS occupation (scored or not). */
export interface MapRole {
    /** The Kelley job id ("job-15") or "soc:<SOC>", the ids the role filter and task view use. */
    id: string;
    title: string;
    soc: string;
    kind: 'kelley' | 'bls';
    /** The Kelley Job, for a Kelley title. */
    job?: Job;
}

export interface MapRolesInScope {
    /** Every job in the open field, family or (at the world) all fields, in SOC order. */
    roles: MapRole[];
    /** Fields in scope whose state rows are still loading. */
    loading: boolean;
    /** Fields in scope whose state rows could not be loaded. */
    failed: string[];
}

/**
 * The jobs the state map offers: every job on stage, Kelley or not, scored or
 * not (utils/roles: a Kelley code is listed by its Kelley titles only). The
 * list comes from the bundled index; each field's BLS state rows load lazily
 * (worldStore.loadStateMap), so the map re-renders as they arrive.
 */
export function useMapRolesInScope(enabled = true): MapRolesInScope {
    const jobs = useStore((s) => s.jobs);
    const focusedFamily = useWorldStore((s) => s.focusedFamily);
    const focusedContinent = useWorldStore((s) => s.focusedContinent);
    const loaded = useWorldStore((s) => s.stateMapFields);
    const errors = useWorldStore((s) => s.stateMapErrors);
    const loadStateMap = useWorldStore((s) => s.loadStateMap);

    const codes = React.useMemo(
        () => INDEX_CONTINENTS.map((c) => c.code).filter((code) => isOnStage({ focusedFamily, focusedContinent }, code)),
        [focusedFamily, focusedContinent],
    );

    React.useEffect(() => {
        if (!enabled) return;
        for (const code of codes) if (!loaded[code] && !errors[code]) void loadStateMap(code);
    }, [enabled, codes, loaded, errors, loadStateMap]);

    const roles = React.useMemo(() => {
        const inScope = new Set(codes);
        const byId = new Map(jobs.map((j) => [j.id, j]));
        return getRoleEntries(jobs)
            .filter((e) => inScope.has(e.continent))
            .map((e): MapRole => ({
                id: e.key,
                title: e.title,
                soc: e.soc,
                kind: e.kind,
                ...(e.jobId ? { job: byId.get(e.jobId) } : {}),
            }));
    }, [jobs, codes]);

    return {
        roles,
        loading: codes.some((c) => !loaded[c] && !errors[c]),
        failed: codes.filter((c) => errors[c]),
    };
}

/**
 * A map role's published state rows: a Kelley title's from geo_real.json (the
 * store's job.locations, as the map has always read them; its field's chunk
 * holds the same rows, stateMap.test.ts), any other job's from its field's
 * chunk. Undefined until loaded; empty when BLS publishes no state data for
 * the job.
 */
export function mapRoleRows(role: MapRole): readonly GeoLocation[] | undefined {
    if (role.kind === 'kelley' && role.job?.locations) return role.job.locations;
    return stateRowsFor(role.soc);
}
