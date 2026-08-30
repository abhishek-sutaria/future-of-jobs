import React, { useState, useMemo, useCallback } from 'react';
import { useStore } from '../../store';
import { useUserStore } from '../../userStore';
import { Z } from '../../config/layers';
import { toast } from '../ui/Toast';
import { Section, Empty } from '../ui/EmptyState';
import { IconArrowRight } from '../ui/Icons';
import { StatTiles } from './StatTiles';
import { FilterBar } from './FilterBar';
import { ActivityTable } from './ActivityTable';
import { TrainingLog } from './TrainingLog';
import { SavedReports } from './SavedReports';
import { AccountSection } from './AccountSection';
import {
    buildJobIndex, enrichSavedRoles, enrichViewedRoles, filterRows, sortRows,
    computePortfolioStats, groupTrainingByRole, buildRiskScale,
    EMPTY_FILTERS, type DashboardFilters, type SortKey, type SortDirection,
} from '../../utils/dashboardSelectors';

type Tab = 'saved' | 'explored' | 'training' | 'reports' | 'account';

const TABS: { id: Tab; label: string }[] = [
    { id: 'saved', label: 'Saved Roles' },
    { id: 'explored', label: 'Explored' },
    { id: 'training', label: 'Training' },
    { id: 'reports', label: 'Reports' },
    { id: 'account', label: 'Account' },
];

interface SortState { key: SortKey; dir: SortDirection }
const DEFAULT_SORT: SortState = { key: 'date', dir: 'desc' };

export const DashboardPage: React.FC = () => {
    const jobs = useStore((s) => s.jobs);
    const setSelectedJob = useStore((s) => s.setSelectedJob);
    const navigate = useStore((s) => s.navigate);

    const activity = useUserStore((s) => s.activity);
    const isLoadingActivity = useUserStore((s) => s.isLoadingActivity);
    const authStatus = useUserStore((s) => s.authStatus);
    const toggleSavedRole = useUserStore((s) => s.toggleSavedRole);

    const [tab, setTab] = useState<Tab>('saved');
    const [savedFilters, setSavedFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
    const [savedSort, setSavedSort] = useState<SortState>(DEFAULT_SORT);
    const [viewedFilters, setViewedFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
    const [viewedSort, setViewedSort] = useState<SortState>({ key: 'views', dir: 'desc' });

    const jobIndex = useMemo(() => buildJobIndex(jobs), [jobs]);
    // Built from the FULL job list, never a filtered subset — see the caveat
    // on buildRiskScale itself; a scale built from filtered rows would make a
    // role's risk colour shift as the user changes filters.
    const riskScale = useMemo(() => buildRiskScale(jobs.map((j) => j.automationCostIndex)), [jobs]);

    const stats = useMemo(
        () => computePortfolioStats(activity.savedRoles, activity.recentViews, activity.upskillCompletions, jobIndex),
        [activity.savedRoles, activity.recentViews, activity.upskillCompletions, jobIndex]
    );

    const savedRows = useMemo(() => enrichSavedRoles(activity.savedRoles, jobIndex, riskScale), [activity.savedRoles, jobIndex, riskScale]);
    const filteredSaved = useMemo(
        () => sortRows(filterRows(savedRows, savedFilters), savedSort.key, savedSort.dir),
        [savedRows, savedFilters, savedSort]
    );

    const viewedRows = useMemo(() => enrichViewedRoles(activity.recentViews, jobIndex, riskScale), [activity.recentViews, jobIndex, riskScale]);
    const filteredViewed = useMemo(
        () => sortRows(filterRows(viewedRows, viewedFilters), viewedSort.key, viewedSort.dir),
        [viewedRows, viewedFilters, viewedSort]
    );

    const trainingGroups = useMemo(() => groupTrainingByRole(activity.upskillCompletions, jobIndex), [activity.upskillCompletions, jobIndex]);

    // Callers (ActivityTable/TrainingLog/SavedReports) all call this as
    // onOpenJob(jobId, jobTitle) — TS structurally allows an implementation
    // with fewer parameters than the declared callback type, so the unused
    // title is simply dropped here rather than named-and-ignored.
    const handleOpenJob = useCallback((jobId: string) => {
        const job = jobIndex.get(jobId);
        if (!job) {
            toast.warning('That role is no longer in the dataset.');
            return;
        }
        setSelectedJob(job);
        navigate('map');
    }, [jobIndex, setSelectedJob, navigate]);

    const handleRemoveSaved = useCallback((jobId: string, jobTitle: string) => {
        void toggleSavedRole(jobId, jobTitle);
    }, [toggleSavedRole]);

    return (
        <div className="absolute inset-0 bg-gray-900 flex flex-col pointer-events-auto" style={{ zIndex: Z.page }}>
            {/* Header */}
            <div className="flex-none flex items-center justify-between px-5 md:px-8 py-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('map')}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/10 text-xs font-semibold uppercase tracking-wider text-gray-300 transition-colors"
                    >
                        <IconArrowRight size={13} className="rotate-180" /> Back to map
                    </button>
                    <h1 className="text-lg font-semibold text-white tracking-wide">Your Dashboard</h1>
                </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 md:px-8 py-6">
                <div className="max-w-5xl mx-auto space-y-6">
                    {authStatus === 'disabled' ? (
                        <div className="bg-white/[0.03] rounded-xl p-6 border border-white/[0.06] text-center">
                            <p className="text-white font-medium">Accounts aren’t set up for this build</p>
                            <p className="text-gray-400 text-sm mt-2">
                                There’s nothing to show here yet — see README “Individual user activity” to enable saving.
                            </p>
                        </div>
                    ) : (
                        <>
                            <StatTiles stats={stats} />

                            <div className="flex gap-1 border-b border-white/[0.06] overflow-x-auto">
                                {TABS.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setTab(t.id)}
                                        className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap border-b-2 transition-colors ${
                                            tab === t.id
                                                ? 'border-cyan-400 text-cyan-300'
                                                : 'border-transparent text-gray-500 hover:text-gray-300'
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {isLoadingActivity && <Empty>Loading your activity…</Empty>}

                            {!isLoadingActivity && tab === 'saved' && (
                                <Section title="Saved roles" count={activity.savedRoles.length}>
                                    {activity.savedRoles.length === 0 ? (
                                        <Empty>No saved roles yet — open a role and choose Save.</Empty>
                                    ) : (
                                        <>
                                            <FilterBar
                                                filters={savedFilters}
                                                onFiltersChange={setSavedFilters}
                                                sortKey={savedSort.key}
                                                sortDir={savedSort.dir}
                                                onSortChange={(key, dir) => setSavedSort({ key, dir })}
                                                visibleCount={filteredSaved.length}
                                                totalCount={savedRows.length}
                                            />
                                            <ActivityTable
                                                rows={filteredSaved}
                                                variant="saved"
                                                onOpenJob={handleOpenJob}
                                                onRemove={handleRemoveSaved}
                                                emptyMessage="No roles match these filters."
                                            />
                                        </>
                                    )}
                                </Section>
                            )}

                            {!isLoadingActivity && tab === 'explored' && (
                                <Section title="Recently viewed" count={activity.recentViews.length}>
                                    {activity.recentViews.length === 0 ? (
                                        <Empty>Roles you open will show up here.</Empty>
                                    ) : (
                                        <>
                                            <FilterBar
                                                filters={viewedFilters}
                                                onFiltersChange={setViewedFilters}
                                                sortKey={viewedSort.key}
                                                sortDir={viewedSort.dir}
                                                onSortChange={(key, dir) => setViewedSort({ key, dir })}
                                                extraSortOptions={[{ value: 'views', label: 'Times viewed' }]}
                                                visibleCount={filteredViewed.length}
                                                totalCount={viewedRows.length}
                                            />
                                            <ActivityTable
                                                rows={filteredViewed}
                                                variant="viewed"
                                                onOpenJob={handleOpenJob}
                                                emptyMessage="No roles match these filters."
                                            />
                                        </>
                                    )}
                                </Section>
                            )}

                            {!isLoadingActivity && tab === 'training' && (
                                <Section title="Training completed" count={activity.upskillCompletions.length}>
                                    <TrainingLog groups={trainingGroups} onOpenJob={handleOpenJob} />
                                </Section>
                            )}

                            {!isLoadingActivity && tab === 'reports' && (
                                <Section title="Saved reports" count={activity.artifacts.length}>
                                    <SavedReports artifacts={activity.artifacts} onOpenJob={handleOpenJob} />
                                </Section>
                            )}

                            {tab === 'account' && (
                                <Section title="Account">
                                    <AccountSection />
                                </Section>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
