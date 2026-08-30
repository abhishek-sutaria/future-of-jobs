import React from 'react';
import { IconTrash } from '../ui/Icons';
import { Empty } from '../ui/EmptyState';
import { RISK_BAND_COLORS } from '../../config/theme';
import type { EnrichedRow } from '../../utils/dashboardSelectors';

const RISK_LABEL: Record<string, string> = { safe: 'Safe', hybrid: 'Hybrid', high: 'High risk' };

const RiskBadge: React.FC<{ row: EnrichedRow }> = ({ row }) => {
    if (row.automationCostIndex === null || row.riskBand === null) {
        return <span className="text-[10px] text-gray-600 italic">—</span>;
    }
    const color = RISK_BAND_COLORS[row.riskBand];
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold tabular-nums border"
            style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            {(row.automationCostIndex * 100).toFixed(0)}% · {RISK_LABEL[row.riskBand]}
        </span>
    );
};

const GrowthCell: React.FC<{ value: number | null }> = ({ value }) => {
    if (value === null) return <span className="text-gray-600">—</span>;
    const positive = value >= 0;
    return (
        <span className={`tabular-nums ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {positive ? '+' : ''}{value.toFixed(0)}%
        </span>
    );
};

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ActivityTableProps {
    rows: EnrichedRow[];
    variant: 'saved' | 'viewed';
    onOpenJob: (jobId: string, jobTitle: string) => void;
    onRemove?: (jobId: string, jobTitle: string) => void;
    emptyMessage: string;
}

export const ActivityTable: React.FC<ActivityTableProps> = ({ rows, variant, onOpenJob, onRemove, emptyMessage }) => {
    if (rows.length === 0) return <Empty>{emptyMessage}</Empty>;

    return (
        <div className="overflow-x-auto custom-scrollbar rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider border-b border-white/[0.06]">
                        <th className="text-left px-3 py-2.5">Role</th>
                        <th className="text-left px-3 py-2.5 hidden md:table-cell">Cluster</th>
                        <th className="text-left px-3 py-2.5">Risk</th>
                        <th className="text-left px-3 py-2.5 hidden sm:table-cell">Growth</th>
                        <th className="text-left px-3 py-2.5">{variant === 'saved' ? 'Saved' : 'Last viewed'}</th>
                        {variant === 'saved' && <th className="w-10" />}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.jobId} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors">
                            <td className="px-3 py-2.5">
                                <button
                                    onClick={() => onOpenJob(row.jobId, row.jobTitle)}
                                    className="text-gray-200 hover:text-white font-medium text-left"
                                >
                                    {row.jobTitle}
                                </button>
                                {!row.job && <span className="ml-2 text-[10px] text-gray-600 italic">no longer available</span>}
                            </td>
                            <td className="px-3 py-2.5 hidden md:table-cell text-gray-400 text-xs">{row.cluster ?? '—'}</td>
                            <td className="px-3 py-2.5"><RiskBadge row={row} /></td>
                            <td className="px-3 py-2.5 hidden sm:table-cell text-xs"><GrowthCell value={row.projectedGrowth} /></td>
                            <td className="px-3 py-2.5 text-gray-500 text-xs tabular-nums">
                                {formatDate(row.createdAt ?? row.lastViewedAt ?? '')}
                                {typeof row.viewCount === 'number' && row.viewCount > 1 && (
                                    <span className="ml-1.5 text-gray-600">×{row.viewCount}</span>
                                )}
                            </td>
                            {variant === 'saved' && (
                                <td className="px-2 py-2.5">
                                    <button
                                        onClick={() => onRemove?.(row.jobId, row.jobTitle)}
                                        aria-label={`Remove ${row.jobTitle}`}
                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    >
                                        <IconTrash size={13} />
                                    </button>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
