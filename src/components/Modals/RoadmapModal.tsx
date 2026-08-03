import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { IconAlertTriangle, IconTarget, IconBook, IconCheck, IconArrowRight, IconAward } from '../ui/Icons';
import { Skeleton, SkeletonText } from '../ui/Skeleton';
import type { Job } from '../../types';
import { getClaudeUserFriendlyMessage, type RoadmapResult } from '../../utils/analysis';
import { UI } from '../../config/constants';
import { PHASE_COLORS } from '../../config/theme';

interface RoadmapModalProps {
    job: Job;
    riskTask: { name: string; aiCapabilityScore: number };
    targetTask: { name: string; humanCriticalityScore: number };
    onClose: () => void;
}

export default function RoadmapModal({ job, riskTask, targetTask, onClose }: RoadmapModalProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [roadmapData, setRoadmapData] = useState<RoadmapResult | null>(null);
    const [roadmapError, setRoadmapError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        const fetchRoadmap = async () => {
            setRoadmapError(null);
            setRoadmapData(null);
            try {
                const { generateRoadmap } = await import('../../utils/analysis');
                const result = await generateRoadmap(job.title, riskTask.name, targetTask.name);
                if (mounted) setRoadmapData(result);
            } catch (err) {
                console.error(err);
                if (mounted) setRoadmapError(getClaudeUserFriendlyMessage(err));
            } finally {
                if (mounted) setIsLoading(false);
            }
        };
        fetchRoadmap();
        return () => { mounted = false; };
    }, [job.title, riskTask.name, targetTask.name]);

    // PHASE_COLORS imported from config/theme

    return (
        <Modal isOpen={true} onClose={onClose} title="Career Transformation Roadmap" size="lg" layer="top">
            <p className="text-gray-400 text-sm mb-6">
                For: <span className="text-white font-medium">{job.title}</span>
            </p>

            {/* Problem -> Solution Flow */}
            <div className="flex flex-col md:flex-row gap-4 items-stretch mb-8">
                <div className="flex-1 bg-red-500/[0.04] border border-red-500/15 rounded-xl p-5">
                    <h3 className="text-red-400 font-semibold text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                        <IconAlertTriangle size={14} /> Vulnerability
                    </h3>
                    <p className="text-white text-sm font-medium leading-relaxed mb-3">{riskTask.name}</p>
                    <div className="flex justify-between items-end pt-3 border-t border-white/[0.04]">
                        <span className="text-[10px] text-gray-500 uppercase">Automation Risk</span>
                        <span className="text-xl font-bold text-red-400 tabular-nums">{(riskTask.aiCapabilityScore * 100).toFixed(0)}%</span>
                    </div>
                </div>

                <div className="flex items-center justify-center text-white">
                    <IconArrowRight size={20} className="rotate-90 md:rotate-0" />
                </div>

                <div className="flex-1 bg-emerald-500/[0.04] border border-emerald-500/15 rounded-xl p-5">
                    <h3 className="text-emerald-400 font-semibold text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                        <IconTarget size={14} /> Mitigation Strategy
                    </h3>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                        {targetTask.name.split(' ').length > UI.LONG_TEXT_WORD_THRESHOLD ? (
                            <p className="text-white text-sm font-medium leading-relaxed">{targetTask.name}</p>
                        ) : (
                            targetTask.name.split(/,| and /).map((chunk, i) => (
                                <span key={i} className="inline-block px-2.5 py-1 bg-emerald-500/10 text-emerald-300 rounded-md text-xs font-medium border border-emerald-500/20">
                                    {chunk.trim()}
                                </span>
                            ))
                        )}
                    </div>
                    <div className="flex justify-between items-end pt-3 border-t border-white/[0.04]">
                        <span className="text-[10px] text-gray-500 uppercase">Human Criticality</span>
                        <span className="text-xl font-bold text-emerald-400 tabular-nums">{(targetTask.humanCriticalityScore * 100).toFixed(0)}%</span>
                    </div>
                </div>
            </div>

            {/* Learning Path */}
            <div className="mb-8">
                <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                    <IconBook size={16} className="text-cyan-400" /> 6-Month Learning Path
                </h3>

                {isLoading ? (
                    <div className="space-y-4 py-4" role="status" aria-busy="true">
                        <div className="flex justify-center mb-4">
                            <div className="w-8 h-8 border-2 border-cyan-500/40 border-t-cyan-400 rounded-full animate-spin"></div>
                        </div>
                        <p className="text-center text-gray-400 text-xs mb-4">Generating personalized curriculum...</p>
                        {[1, 2, 3].map(i => (
                            <div key={i} className="space-y-2">
                                <Skeleton className="h-5 w-40" />
                                <SkeletonText lines={3} />
                            </div>
                        ))}
                    </div>
                ) : roadmapError ? (
                    <div className="py-6 px-2 text-center rounded-xl bg-red-500/[0.04] border border-red-500/15">
                        <p className="text-red-400 text-sm leading-relaxed">{roadmapError}</p>
                    </div>
                ) : roadmapData ? (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        {roadmapData.phases.map((phase, idx) => (
                            <div key={idx} className={`border-l-2 ${PHASE_COLORS[idx] || 'border-gray-500'} pl-4`}>
                                <h4 className="text-white font-medium text-sm mb-2">{phase.title}</h4>
                                <ul className="text-gray-300 text-sm space-y-1.5">
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
                ) : (
                    <div className="flex flex-col items-center py-8 text-center bg-red-500/[0.04] border border-red-500/15 rounded-xl">
                        <IconAlertTriangle size={28} className="text-red-400 mb-2" />
                        <h4 className="text-red-400 font-semibold text-sm mb-1">Service Unavailable</h4>
                        <p className="text-gray-400 text-xs max-w-sm">Could not generate a roadmap. Check your Claude setup or try again.</p>
                    </div>
                )}
            </div>

            {/* Resources */}
            {roadmapData && roadmapData.resources?.length > 0 && (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-6">
                    <h3 className="text-blue-400 font-semibold text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                        <IconBook size={14} /> Recommended Resources
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {roadmapData.resources.map((resource, i) => (
                            <div key={i}>
                                <p className="text-gray-400 font-medium mb-1 text-xs">{resource.category}</p>
                                <ul className="space-y-1">
                                    {resource.items.map((item, j) => (
                                        <li key={j} className="text-gray-300 text-sm flex items-start gap-1.5">
                                            <span className="text-blue-500 mt-1 shrink-0 text-xs">›</span>
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Success Metrics */}
            {roadmapData && roadmapData.successMetrics?.length > 0 && (
                <div className="bg-amber-500/[0.03] border border-amber-500/15 rounded-xl p-5">
                    <h3 className="text-amber-400 font-semibold text-xs uppercase tracking-wider mb-1 flex items-center gap-2">
                        <IconAward size={14} /> Success Milestones
                    </h3>
                    <p className="text-[10px] text-gray-500 mb-3">Role-specific targets for this transition</p>
                    <ul className="text-gray-300 text-sm space-y-2">
                        {roadmapData.successMetrics.map((item, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <IconCheck size={14} className="text-amber-400 mt-0.5 shrink-0" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Modal>
    );
}
