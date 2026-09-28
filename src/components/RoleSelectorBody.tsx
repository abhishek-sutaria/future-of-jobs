import { useState } from 'react';
import { useStore } from '../store';
import { FALLBACK_COLORS } from '../config/theme';

/**
 * Desktop sidebar body: search/actions/count + a flex-1 scrolling list.
 * Mobile Filter roles sheet uses RoleFilterSheet, which keeps the chrome
 * outside Modal's scroller so selected rows cannot bleed over search.
 */
export default function RoleSelectorBody() {
    const jobs = useStore((state) => state.jobs);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const toggleRoleOnMap = useStore((state) => state.toggleRoleOnMap);
    const selectAllRoles = useStore((state) => state.selectAllRoles);
    const clearAllRoles = useStore((state) => state.clearAllRoles);

    const [searchQuery, setSearchQuery] = useState('');

    const filteredJobs = jobs.filter(job =>
        job.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const ROLE_COLORS = FALLBACK_COLORS;

    return (
        <>
            <RoleFilterChrome
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedCount={selectedRoleIds.size}
                totalCount={jobs.length}
                onSelectAll={selectAllRoles}
                onClearAll={clearAllRoles}
            />

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {filteredJobs.map((job, index) => (
                    <RoleFilterRow
                        key={job.id}
                        title={job.title}
                        selected={selectedRoleIds.has(job.id)}
                        color={ROLE_COLORS[index % ROLE_COLORS.length]}
                        onToggle={() => toggleRoleOnMap(job.id)}
                    />
                ))}
            </div>
        </>
    );
}

export function RoleFilterChrome({
    searchQuery,
    onSearchChange,
    selectedCount,
    totalCount,
    onSelectAll,
    onClearAll,
}: {
    searchQuery: string;
    onSearchChange: (q: string) => void;
    selectedCount: number;
    totalCount: number;
    onSelectAll: () => void;
    onClearAll: () => void;
}) {
    return (
        <>
            <div className="p-4 border-b border-gray-700/50">
                <input
                    type="text"
                    placeholder="Search roles..."
                    aria-label="Search roles"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
            </div>

            <div className="p-4 border-b border-gray-700/50 flex gap-2">
                <button
                    onClick={onSelectAll}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    Select All
                </button>
                <button
                    onClick={onClearAll}
                    className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    Clear All
                </button>
            </div>

            {/* Selected Count. Zero selected does not mean nothing is shown —
                MapView.tsx renders every role when the set is empty — so the
                zero-state copy says that explicitly rather than reading like
                the map is blank. */}
            <div className="px-4 py-2 bg-gray-800/50">
                <p className="text-gray-400 text-xs">
                    {selectedCount === 0 ? (
                        <>Showing <span className="text-blue-400 font-bold">all {totalCount}</span> roles</>
                    ) : (
                        <><span className="text-blue-400 font-bold">{selectedCount}</span> of {totalCount} roles selected</>
                    )}
                </p>
            </div>
        </>
    );
}

export function RoleFilterRow({
    title,
    selected,
    color,
    onToggle,
}: {
    title: string;
    selected: boolean;
    color: string;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={onToggle}
            className={`
                w-full block text-left
                p-3 rounded-lg border transition-all cursor-pointer
                ${selected
                    ? 'bg-blue-500/10 border-blue-500/50 shadow-lg shadow-blue-500/20'
                    : 'bg-gray-800/50 border-gray-700/30 hover:border-gray-600'
                }
            `}
        >
            <div className="flex items-center gap-3">
                <div aria-hidden="true" className={`
                    w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0
                    ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}
                `}>
                    {selected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </div>

                <div
                    aria-hidden="true"
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                />

                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${selected ? 'text-white' : 'text-gray-300'}`}>
                        {title}
                    </p>
                </div>
            </div>
        </button>
    );
}
