import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { RoleFilterChrome, RoleFilterRow } from './RoleSelectorBody';
import { useStore } from '../store';
import { FALLBACK_COLORS } from '../config/theme';

interface RoleFilterSheetProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Mobile-only stand-in for the desktop RoleSelector sidebar (a fixed 320px
 * overlay that covers 82% of a phone screen and traps the user — see
 * RoleFilterButton and UI.tsx for how this is mounted).
 *
 * Search / Select All / count sit in Modal's non-scrolling `chrome` slot.
 * Only the role rows scroll. The old sticky-inside-scroller approach let a
 * selected row (blue border + glow) paint over the search field when the
 * list was scrolled — the "bleeding" on phones.
 */
export const RoleFilterSheet: React.FC<RoleFilterSheetProps> = ({ isOpen, onClose }) => {
    const jobs = useStore((state) => state.jobs);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const toggleRoleOnMap = useStore((state) => state.toggleRoleOnMap);
    const selectAllRoles = useStore((state) => state.selectAllRoles);
    const clearAllRoles = useStore((state) => state.clearAllRoles);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredJobs = jobs.filter(job =>
        job.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Filter roles"
            size="sm"
            layer="overlay"
            chrome={
                <RoleFilterChrome
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    selectedCount={selectedRoleIds.size}
                    totalCount={jobs.length}
                    onSelectAll={selectAllRoles}
                    onClearAll={clearAllRoles}
                />
            }
        >
            <div className="p-4 space-y-2">
                {filteredJobs.map((job, index) => (
                    <RoleFilterRow
                        key={job.id}
                        title={job.title}
                        selected={selectedRoleIds.has(job.id)}
                        color={FALLBACK_COLORS[index % FALLBACK_COLORS.length]}
                        onToggle={() => toggleRoleOnMap(job.id)}
                    />
                ))}
            </div>
        </Modal>
    );
};
