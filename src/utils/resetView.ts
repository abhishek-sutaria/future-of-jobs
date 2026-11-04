export interface ResetViewContext {
    mapView: 'globe' | 'map' | 'tasks';
    isDefaultView: boolean;
    /** Field names are showing: a zoomed world, a family or a field. */
    zoomedToFields: boolean;
    /** A family or field is open on the 3D view. */
    onStage: boolean;
    isMobile: boolean;
}

/** Whether the header offers "Reset view". Kept pure so its one phone exception can be tested. */
export function resetViewVisible({ mapView, isDefaultView, zoomedToFields, onStage, isMobile }: ResetViewContext): boolean {
    if (mapView === 'map') return false;
    if (mapView === 'globe' && onStage && isMobile) return false;
    return !isDefaultView || (mapView === 'globe' && zoomedToFields);
}
