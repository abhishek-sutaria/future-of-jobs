import React from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { continentOf, type OccupationEntry } from '../utils/occupationIndex';
import { blsScoreFor } from '../utils/blsScores';
import { blsRoleJob } from '../utils/blsRoleJob';
import { roleScaleFor } from '../utils/allRoleScale';
import type { Job } from '../types';

/**
 * The open BLS occupation (worldStore.selectedOccupationSoc) once its field is
 * loaded: its occupation entry, and, when it has published AI scores, the
 * role-panel Job it opens as (utils/blsRoleJob). A field's scores load with
 * its occupation file (worldStore.loadContinent), so a loaded file means its
 * scores are in too. `job` stays null for an unscored occupation, which keeps
 * the numbers-only panel and never reaches Claude.
 */
export function useOccupationRole(soc: string | null): { occupation: OccupationEntry | null; job: Job | null } {
    const code = soc ? continentOf(soc) : null;
    const file = useWorldStore((s) => (code ? s.continentFiles[code] : undefined));
    const jobs = useStore((s) => s.jobs);
    const occupation = (soc && file?.occupations[soc]) || null;
    const job = React.useMemo(() => {
        if (!occupation) return null;
        const score = blsScoreFor(occupation.soc);
        return score ? blsRoleJob(occupation, score, roleScaleFor(jobs)) : null;
    }, [occupation, jobs]);
    return { occupation, job };
}

/** The occupation entry behind a Kelley role's SOC, once its field is loaded (for the About section). */
export function useFieldOccupation(soc: string | null): OccupationEntry | null {
    const code = soc ? continentOf(soc) : null;
    const file = useWorldStore((s) => (code ? s.continentFiles[code] : undefined));
    const loadContinent = useWorldStore((s) => s.loadContinent);
    React.useEffect(() => {
        if (code && !file) void loadContinent(code);
    }, [code, file, loadContinent]);
    return (soc && file?.occupations[soc]) || null;
}
