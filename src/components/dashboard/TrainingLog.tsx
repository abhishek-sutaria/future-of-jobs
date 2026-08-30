import React from 'react';
import { IconAward, IconCheck } from '../ui/Icons';
import { Empty } from '../ui/EmptyState';
import type { TrainingGroup } from '../../utils/dashboardSelectors';

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface TrainingLogProps {
    groups: TrainingGroup[];
    onOpenJob: (jobId: string, jobTitle: string) => void;
}

/**
 * Read-only by design: there is no inverse of store.ts's upskillTask boost —
 * the only way to undo a completion is a full re-score — so this view must
 * never imply a completion can be removed from here.
 */
export const TrainingLog: React.FC<TrainingLogProps> = ({ groups, onOpenJob }) => {
    if (groups.length === 0) {
        return <Empty>Complete an upskilling task on any role to track it here.</Empty>;
    }

    return (
        <div className="space-y-3">
            {groups.map((group) => (
                <div key={group.jobId} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                            <IconAward size={15} className="text-amber-400 shrink-0" />
                            <button
                                onClick={() => onOpenJob(group.jobId, group.jobTitle)}
                                disabled={group.jobTitle === '(role no longer available)'}
                                className="text-white font-semibold text-sm truncate hover:text-cyan-300 disabled:hover:text-white disabled:cursor-default transition-colors"
                            >
                                {group.jobTitle}
                            </button>
                            {group.cluster && (
                                <span className="text-[10px] uppercase tracking-wider text-gray-500 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] shrink-0">
                                    {group.cluster}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] text-gray-500 shrink-0">{group.completions.length} completed</span>
                    </div>
                    <ul className="space-y-1.5">
                        {group.completions.map((c) => (
                            <li key={c.taskName} className="flex items-start gap-2 text-xs text-gray-300">
                                <IconCheck size={12} className="text-emerald-400 mt-0.5 shrink-0" />
                                <span className="flex-1">{c.taskName}</span>
                                <span className="text-gray-600 tabular-nums shrink-0">{formatDate(c.completedAt)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
};
