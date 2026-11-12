import { useStore } from '../store';
import { useScoredRolesInScope } from './useScoredRoles';
import { useMapRolesInScope } from './useMapRoles';

/**
 * The roles the side list offers in the current view. The task view lists every
 * scored role on stage (Kelley or not). The state map lists every job on stage,
 * Kelley or not, scored or not: BLS OEWS May 2025 state data covers all 830
 * (docs/state-map.md; the 5 it publishes no state data for say so on the map).
 */
export function useFilterRoles(): { id: string; title: string }[] {
    const mapView = useStore((s) => s.mapView);
    const { roles } = useScoredRolesInScope(mapView === 'tasks');
    const { roles: mapRoles } = useMapRolesInScope(mapView === 'map');
    return mapView === 'tasks' ? roles : mapRoles;
}
