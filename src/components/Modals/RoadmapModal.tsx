import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { IconAlertTriangle, IconTarget, IconBook, IconArrowRight } from '../ui/Icons';
import { Skeleton, SkeletonText } from '../ui/Skeleton';
import type { Job } from '../../types';
import { getClaudeUserFriendlyMessage, type RoadmapResult } from '../../utils/analysis';
import { UI } from '../../config/constants';
import { loadRoadmap, saveRoadmap } from '../../lib/userData';
import { RoadmapReport } from '../reports/RoadmapReport';

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
            setIsLoading(true);
            try {
                // A saved roadmap for this exact (job, riskTask, targetTask) transition
                // restores instantly with no Claude call — previously this modal
                // re-generated on every single open, including reopening the same
                // transition (see src/lib/userData.ts roadmapCacheKey).
                const saved = await loadRoadmap(job.id, riskTask.name, targetTask.name);
                if (saved) {
                    if (mounted) setRoadmapData(saved);
                    return;
                }
                const { generateRoadmap } = await import('../../utils/analysis');
                const result = await generateRoadmap(job.title, riskTask.name, targetTask.name);
                if (mounted) setRoadmapData(result);
                void saveRoadmap(job.id, job.title, riskTask.name, targetTask.name, result);
            } catch (err) {
                console.error(err);
                if (mounted) setRoadmapError(getClaudeUserFriendlyMessage(err));
            } finally {
                if (mounted) setIsLoading(false);
            }
        };
        fetchRoadmap();
        return () => { mounted = false; };
    }, [job.id, job.title, riskTask.name, targetTask.name]);

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
                    <div className="animate-in fade-in duration-300">
                        <RoadmapReport result={roadmapData} />
                    </div>
                ) : (
                    <div className="flex flex-col items-center py-8 text-center bg-red-500/[0.04] border border-red-500/15 rounded-xl">
                        <IconAlertTriangle size={28} className="text-red-400 mb-2" />
                        <h4 className="text-red-400 font-semibold text-sm mb-1">Service Unavailable</h4>
                        <p className="text-gray-400 text-xs max-w-sm">Could not generate a roadmap. Check your Claude setup or try again.</p>
                    </div>
                )}
            </div>

        </Modal>
    );
}
