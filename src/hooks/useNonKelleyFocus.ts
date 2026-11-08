import React from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { kelleyCountByContinent } from '../utils/roles';

/**
 * The open field, when it holds no Kelley role. The state map only has data
 * for the 50 Kelley roles (BLS state employment in geo_real.json covers their
 * 47 occupations), so opening it from such a field shows KelleyOnlyNote
 * instead of a map with nothing of that field on it. The task view covers
 * every scored role and does not use this.
 */
export function useNonKelleyFocus(): string | null {
    const focused = useWorldStore((s) => s.focusedContinent);
    const jobs = useStore((s) => s.jobs);
    return React.useMemo(
        () => (focused && !kelleyCountByContinent(jobs).get(focused) ? focused : null),
        [focused, jobs],
    );
}
