import React from 'react';
import { IconBook, IconAward, IconCheck } from '../ui/Icons';
import type { RoadmapResult } from '../../utils/analysis';
import { PHASE_COLORS } from '../../config/theme';

/** Presentational only. Shared by RoadmapModal and the dashboard viewer. */
export const RoadmapReport: React.FC<{ result: RoadmapResult }> = ({ result }) => (
    <div className="space-y-6">
        {result.phases?.length > 0 && (
            <div className="space-y-4">
                {result.phases.map((phase, idx) => (
                    <div key={idx} data-print-card className={`border-l-2 ${PHASE_COLORS[idx] || 'border-gray-500'} pl-4`}>
                        <h4 className="text-white font-medium text-sm mb-2 print:text-black">{phase.title}</h4>
                        <ul className="text-gray-300 text-sm space-y-1.5 print:text-black">
                            {phase.items.map((item, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    <span className="text-gray-600 mt-1 shrink-0">&bull;</span>
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        )}

        {result.resources?.length > 0 && (
            <div data-print-card className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                <h3 className="text-blue-400 font-semibold text-xs uppercase tracking-wider mb-3 flex items-center gap-2 print:text-black">
                    <IconBook size={14} /> Recommended Resources
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {result.resources.map((resource, i) => (
                        <div key={i}>
                            <p className="text-gray-400 font-medium mb-1 text-xs print:text-black">{resource.category}</p>
                            <ul className="space-y-1">
                                {resource.items.map((item, j) => (
                                    <li key={j} className="text-gray-300 text-sm flex items-start gap-1.5 print:text-black">
                                        <span className="text-blue-500 mt-1 shrink-0 text-xs">&rsaquo;</span>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {result.successMetrics?.length > 0 && (
            <div data-print-card className="bg-amber-500/[0.03] border border-amber-500/15 rounded-xl p-5">
                <h3 className="text-amber-400 font-semibold text-xs uppercase tracking-wider mb-1 flex items-center gap-2 print:text-black">
                    <IconAward size={14} /> Success Milestones
                </h3>
                <p className="text-[10px] text-gray-500 mb-3 print:text-black">Role-specific targets for this transition</p>
                <ul className="text-gray-300 text-sm space-y-2 print:text-black">
                    {result.successMetrics.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <IconCheck size={14} className="text-amber-400 mt-0.5 shrink-0" />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </div>
        )}
    </div>
);
