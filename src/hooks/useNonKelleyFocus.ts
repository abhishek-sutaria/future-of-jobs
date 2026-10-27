import React from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { kelleyCountByContinent } from '../utils/roles';

/**
 * The zoomed region, when it holds no Kelley role. The state map and the task
 * split only have data for the 50 Kelley roles, so opening either from such a
 * region shows KelleyOnlyNote (components/KelleyOnlyNote) instead of a view with nothing of that region in it.
 */
export function useNonKelleyFocus(): string | null {
    const focused = useWorldStore((s) => s.focusedContinent);
    const jobs = useStore((s) => s.jobs);
    return React.useMemo(
        () => (focused && !kelleyCountByContinent(jobs).get(focused) ? focused : null),
        [focused, jobs],
    );
}
