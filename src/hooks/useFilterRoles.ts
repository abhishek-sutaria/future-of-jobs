import { useStore } from '../store';
import { useScoredRolesInScope } from './useScoredRoles';

/**
 * The roles the side list offers in the current view. The task view lists every
 * scored role on stage (Kelley or not). The state map lists the 50 Kelley roles
 * only: BLS state employment in the repo (geo_real.json, OEWS May 2025) covers
 * their 47 occupations, and no other occupation is drawn on it.
 */
export function useFilterRoles(): { id: string; title: string }[] {
    const mapView = useStore((s) => s.mapView);
    const jobs = useStore((s) => s.jobs);
    const { roles } = useScoredRolesInScope(mapView === 'tasks');
    return mapView === 'tasks' ? roles : jobs;
}
