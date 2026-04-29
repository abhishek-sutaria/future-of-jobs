import { useState } from 'react';
import { useStore } from '../store';
import { FALLBACK_COLORS } from '../config/theme';

export default function RoleSelector() {
    const jobs = useStore((state) => state.jobs);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const toggleRoleOnMap = useStore((state) => state.toggleRoleOnMap);
    const selectAllRoles = useStore((state) => state.selectAllRoles);
    const clearAllRoles = useStore((state) => state.clearAllRoles);

    const [searchQuery, setSearchQuery] = useState('');

    // Filter jobs based on search
    const filteredJobs = jobs.filter(job =>
        job.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const ROLE_COLORS = FALLBACK_COLORS;

    return (
        <div className="w-80 bg-gradient-to-b from-gray-900 to-black border-r border-gray-700/50 flex flex-col h-screen">
            {/* Header */}
            <div className="p-6 border-b border-gray-700/50">
                <h2 className="text-white font-bold text-xl mb-2">Role Selector</h2>
                <p className="text-gray-400 text-sm">Select roles to display on map</p>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-gray-700/50">
                <input
                    type="text"
                    placeholder="Search roles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
            </div>

            {/* Quick Actions */}
            <div className="p-4 border-b border-gray-700/50 flex gap-2">
                <button
                    onClick={selectAllRoles}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    Select All
                </button>
                <button
                    onClick={clearAllRoles}
                    className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    Clear All
                </button>
            </div>

            {/* Selected Count */}
            <div className="px-4 py-2 bg-gray-800/50">
                <p className="text-gray-400 text-xs">
                    <span className="text-blue-400 font-bold">{selectedRoleIds.size}</span> of {jobs.length} roles selected
                </p>
            </div>

            {/* Role List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {filteredJobs.map((job, index) => {
                    const isSelected = selectedRoleIds.has(job.id);
                    const roleColor = ROLE_COLORS[index % ROLE_COLORS.length];

                    return (
                        <div
                            key={job.id}
                            onClick={() => toggleRoleOnMap(job.id)}
                            className={`
                                p-3 rounded-lg border transition-all cursor-pointer
                                ${isSelected
                                    ? 'bg-blue-500/10 border-blue-500/50 shadow-lg shadow-blue-500/20'
                                    : 'bg-gray-800/50 border-gray-700/30 hover:border-gray-600'
                                }
                            `}
                        >
                            <div className="flex items-center gap-3">
                                {/* Checkbox */}
                                <div className={`
                                    w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0
                                    ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}
                                `}>
                                    {isSelected && (
                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </div>

                                {/* Color indicator */}
                                <div
                                    className="w-3 h-3 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: roleColor }}
                                />

                                {/* Role name */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                                        {job.title}
                                    </p>

                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer Stats */}
            <div className="p-4 border-t border-gray-700/50 bg-gray-900/50">
                <div className="text-xs text-gray-500 space-y-1">
                    <p>Tip: Select multiple roles to compare</p>
                    <p className="text-gray-600">Click map markers for details</p>
                </div>
            </div>
        </div>
    );
}
