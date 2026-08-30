import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconSearch, IconChevronDown, IconArrowUpDown } from '../ui/Icons';
import { CLUSTER_ORDER, type FunctionalCluster } from '../../config/clusters';
import type { RiskBand } from '../../config/theme';
import type { DashboardFilters, SortKey, SortDirection } from '../../utils/dashboardSelectors';
import { UI } from '../../config/constants';

const RISK_BANDS: { value: RiskBand; label: string; color: string }[] = [
    { value: 'safe', label: 'Safe / Human-Centric', color: 'text-emerald-400' },
    { value: 'hybrid', label: 'Hybrid / Augmented', color: 'text-amber-400' },
    { value: 'high', label: 'High Automation Risk', color: 'text-red-400' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'title', label: 'Title' },
    { value: 'risk', label: 'Automation risk' },
    { value: 'growth', label: 'Projected growth' },
];

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
}

interface FilterBarProps {
    filters: DashboardFilters;
    onFiltersChange: (filters: DashboardFilters) => void;
    sortKey: SortKey;
    sortDir: SortDirection;
    onSortChange: (key: SortKey, dir: SortDirection) => void;
    /** Which sort keys make sense for the current tab — Saved offers "Date
     * saved", Explored doesn't have a "views" sort here since it's a
     * dedicated column; kept simple by passing the same options everywhere
     * except an explicit views option for the Explored tab. */
    extraSortOptions?: { value: SortKey; label: string }[];
    visibleCount: number;
    totalCount: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
    filters, onFiltersChange, sortKey, sortDir, onSortChange, extraSortOptions, visibleCount, totalCount,
}) => {
    const [queryInput, setQueryInput] = useState(filters.query);
    const [clusterOpen, setClusterOpen] = useState(false);
    const [riskOpen, setRiskOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Mirrors the debounced-search convention already used by Header.tsx's
    // SearchBar (UI.SEARCH_DEBOUNCE_MS), rather than inventing a new pattern.
    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onFiltersChange({ ...filters, query: queryInput });
        }, UI.SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(debounceRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryInput]);

    const toggleCluster = useCallback((c: FunctionalCluster) => {
        onFiltersChange({ ...filters, clusters: toggleInSet(filters.clusters, c) });
    }, [filters, onFiltersChange]);

    const toggleRisk = useCallback((r: RiskBand) => {
        onFiltersChange({ ...filters, riskBands: toggleInSet(filters.riskBands, r) });
    }, [filters, onFiltersChange]);

    const sortOptions = extraSortOptions ? [...SORT_OPTIONS, ...extraSortOptions] : SORT_OPTIONS;

    return (
        <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
                <IconSearch size={14} className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500" />
                <input
                    type="text"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    placeholder="Search by title…"
                    aria-label="Search"
                    className="dark-field block w-full pl-9 pr-3 py-2.5 border border-white/[0.06] rounded-lg text-sm placeholder-gray-600 focus:outline-none focus:border-white/15 transition-all min-h-[44px]"
                />
            </div>

            <div className="relative">
                <button
                    onClick={() => { setClusterOpen((v) => !v); setRiskOpen(false); }}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px] ${
                        filters.clusters.size > 0
                            ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                            : 'border-white/[0.08] bg-white/[0.03] text-gray-300 hover:bg-white/10'
                    }`}
                >
                    Cluster{filters.clusters.size > 0 ? ` (${filters.clusters.size})` : ''}
                    <IconChevronDown size={12} />
                </button>
                {clusterOpen && (
                    <div className="absolute z-10 mt-2 w-56 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 max-h-64 overflow-y-auto custom-scrollbar">
                        {CLUSTER_ORDER.map((c) => (
                            <label key={c} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] cursor-pointer text-xs text-gray-300">
                                <input type="checkbox" checked={filters.clusters.has(c)} onChange={() => toggleCluster(c)} className="accent-cyan-500" />
                                {c}
                            </label>
                        ))}
                    </div>
                )}
            </div>

            <div className="relative">
                <button
                    onClick={() => { setRiskOpen((v) => !v); setClusterOpen(false); }}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px] ${
                        filters.riskBands.size > 0
                            ? 'border-red-500/30 bg-red-500/10 text-red-300'
                            : 'border-white/[0.08] bg-white/[0.03] text-gray-300 hover:bg-white/10'
                    }`}
                >
                    Risk{filters.riskBands.size > 0 ? ` (${filters.riskBands.size})` : ''}
                    <IconChevronDown size={12} />
                </button>
                {riskOpen && (
                    <div className="absolute z-10 mt-2 w-56 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2">
                        {RISK_BANDS.map((r) => (
                            <label key={r.value} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] cursor-pointer text-xs">
                                <input type="checkbox" checked={filters.riskBands.has(r.value)} onChange={() => toggleRisk(r.value)} className="accent-cyan-500" />
                                <span className={r.color}>{r.label}</span>
                            </label>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-1.5">
                <IconArrowUpDown size={13} className="text-gray-500" />
                <select
                    value={sortKey}
                    onChange={(e) => onSortChange(e.target.value as SortKey, sortDir)}
                    className="dark-field px-2.5 py-2.5 rounded-lg border border-white/[0.06] text-xs min-h-[44px]"
                    aria-label="Sort by"
                >
                    {sortOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
                <button
                    onClick={() => onSortChange(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
                    title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                    className="w-11 h-11 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-gray-400 hover:text-white transition-colors"
                >
                    {sortDir === 'asc' ? '↑' : '↓'}
                </button>
            </div>

            <span className="text-xs text-gray-500 tabular-nums shrink-0 ml-auto">
                {visibleCount} of {totalCount}
            </span>
        </div>
    );
};
