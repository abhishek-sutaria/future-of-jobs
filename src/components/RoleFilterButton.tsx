import React from 'react';
import { useStore } from '../store';
import { Z } from '../config/layers';
import { IconLayers } from './ui/Icons';

interface RoleFilterButtonProps {
    onClick: () => void;
}

/**
 * Mobile-only trigger for RoleFilterSheet, replacing the desktop sidebar in
 * 2D map view. Badges the selection count — essential, since 0 selected
 * means "showing all 50 roles" (MapView.tsx), not "showing nothing", so the
 * badge is the only signal a filter is actually applied.
 *
 * Placement: the entire bottom band on a 390px phone is already occupied —
 * MapView's own legend and its "Sources: Methodology & Data" button (both
 * bottom-left) already overlap EACH OTHER there, a pre-existing bug that was
 * simply invisible until removing the sidebar overlay exposed it. Rather
 * than fight for a few remaining pixels in an already-broken corner, this
 * anchors top-right in the large empty band between the header (bottom
 * ~152px on mobile) and the legend (top ~575px) — well clear of both, and
 * clear of the "Reset view" button that can appear near the top when the
 * map is zoomed (top-32 in MapView.tsx).
 */
export const RoleFilterButton: React.FC<RoleFilterButtonProps> = ({ onClick }) => {
    const count = useStore((state) => state.selectedRoleIds.size);

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Filter roles"
            className="absolute top-48 right-4 flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-black/30 transition-colors"
            style={{ zIndex: Z.sidebar }}
        >
            <IconLayers size={16} />
            {count > 0 ? `Roles · ${count}` : 'Roles'}
        </button>
    );
};
