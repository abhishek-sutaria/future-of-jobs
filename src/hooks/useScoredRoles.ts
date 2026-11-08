import React from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { isOnStage } from '../utils/worldLevel';
import { SOC_FAMILIES } from '../config/socFamilies';
import { continentOf, INDEX_CONTINENTS } from '../utils/occupationIndex';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { blsScoreFor } from '../utils/blsScores';
import { blsRoleJob } from '../utils/blsRoleJob';
import { roleScaleFor } from '../utils/allRoleScale';
import { isJobScored } from '../utils/roles';
import type { Job } from '../types';

export interface ScoredRolesInScope {
    /** Every scored role in the open field, family or (at the world) the whole map: Kelley titles and BLS occupations. */
    roles: Job[];
    /** True while some field in scope is still loading its scores. */
    loading: boolean;
    /** "Healthcare", "the Service family" or "all fields". */
    scopeLabel: string;
}

/**
 * The scored roles on stage, as role-panel Jobs, for the task view and its
 * role list: the 50 Kelley titles from the store plus every scored BLS
 * occupation (utils/blsRoleJob), on the one all-roles scale. Fields load
 * lazily with their scores (worldStore.loadContinent), so a world-level task
 * view loads every field once.
 */
export function useScoredRolesInScope(enabled = true): ScoredRolesInScope {
    const jobs = useStore((s) => s.jobs);
    const focusedFamily = useWorldStore((s) => s.focusedFamily);
    const focusedContinent = useWorldStore((s) => s.focusedContinent);
    const files = useWorldStore((s) => s.continentFiles);
    const loadContinent = useWorldStore((s) => s.loadContinent);

    const codes = React.useMemo(
        () => INDEX_CONTINENTS.map((c) => c.code).filter((code) => isOnStage({ focusedFamily, focusedContinent }, code)),
        [focusedFamily, focusedContinent],
    );

    React.useEffect(() => {
        if (!enabled) return;
        for (const code of codes) if (!files[code]) void loadContinent(code);
    }, [enabled, codes, files, loadContinent]);

    return React.useMemo(() => {
        const inScope = new Set(codes);
        const scale = roleScaleFor(jobs);
        const roles: Job[] = jobs.filter((j) => {
            const soc = MAP_TITLE_TO_SOC[j.title];
            return soc && inScope.has(continentOf(soc)) && isJobScored(j);
        });
        for (const code of codes) {
            const file = files[code];
            if (!file) continue;
            for (const occ of Object.values(file.occupations)) {
                const score = blsScoreFor(occ.soc);
                if (score) roles.push(blsRoleJob(occ, score, scale));
            }
        }
        const scopeLabel = focusedContinent
            ? CONTINENT_DISPLAY_NAMES[focusedContinent]
            : focusedFamily != null
                ? `the ${SOC_FAMILIES.find((f) => f.id === focusedFamily)?.shortName ?? ''} family`
                : 'all fields';
        return { roles, loading: codes.some((c) => !files[c]), scopeLabel };
    }, [jobs, codes, files, focusedContinent, focusedFamily]);
}
