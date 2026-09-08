import React from 'react';
import type { ScenarioResult } from '../../utils/analysis';

/**
 * Presentational only: takes a stored payload and renders it. Shared by
 * ScenarioModal (live generation) and the dashboard's saved-report viewer, so
 * the two can't drift the way the dashboard's old inline copies did.
 */
export const ScenarioReport: React.FC<{ result: ScenarioResult }> = ({ result }) => (
    <div className="space-y-6">
        <div data-print-card className="border-l-2 border-purple-500/50 pl-4 py-1">
            <p className="text-gray-200 leading-relaxed italic print:text-black">"{result.story}"</p>
        </div>

        {result.keyChanges?.length > 0 && (
            <div className="space-y-3">
                <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider print:text-black">Key Shifts</h4>
                <div className="space-y-2">
                    {result.keyChanges.map((change, i) => (
                        <div key={i} data-print-card className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                            <span className="text-purple-400 font-bold text-sm tabular-nums w-6 print:text-black">{String(i + 1).padStart(2, '0')}</span>
                            <span className="text-gray-300 text-sm print:text-black">{change}</span>
                        </div>
                    ))}
                </div>
            </div>
        )}
    </div>
);
