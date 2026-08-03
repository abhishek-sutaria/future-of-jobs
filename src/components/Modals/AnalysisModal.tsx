import React from 'react';
import { Modal } from '../ui/Modal';
import { IconBrain } from '../ui/Icons';
import { Skeleton, SkeletonText } from '../ui/Skeleton';
import type { JobAnalysis } from '../../utils/analysis';
import { getTaskCategory } from '../../data';

import type { Job } from '../../types';

interface AnalysisModalProps {
    isOpen: boolean;
    isLoading: boolean;
    job: Job;
    result: JobAnalysis | null;
    errorMessage?: string | null;
    onClose: () => void;
}

export const AnalysisModal: React.FC<AnalysisModalProps> = ({ isOpen, isLoading, job, result, errorMessage, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Live Job Analysis: ${job.title}`} size="lg" layer="top">
            <div className="flex items-center gap-2 mb-6">
                <IconBrain size={14} className="text-blue-400" />
                <span className="text-blue-300 text-xs uppercase tracking-wider font-semibold bg-blue-500/10 px-2 py-1 rounded">Claude</span>
                <span className="text-gray-500 text-xs">Analyzing {result?.tasks?.length || '...'} tasks</span>
            </div>

            {isLoading ? (
                <div className="space-y-6 py-10" role="status" aria-busy="true">
                    <div className="flex justify-center">
                        <div className="w-12 h-12 border-2 border-blue-500/40 border-t-blue-400 rounded-full animate-spin"></div>
                    </div>
                    <div className="text-center space-y-1">
                        <p className="text-blue-300 font-medium">Deconstructing Role...</p>
                        <p className="text-gray-500 text-xs">Evaluating Automation Potential vs. Human Criticality</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Skeleton className="h-20 rounded-xl" />
                        <Skeleton className="h-20 rounded-xl" />
                    </div>
                    <SkeletonText lines={4} />
                </div>
            ) : errorMessage ? (
                <div className="text-center py-10 space-y-2 px-2">
                    <p className="text-red-400 text-sm leading-relaxed">{errorMessage}</p>
                </div>
            ) : result ? (() => {
                // Average of Claude's live task scores — same definition as panel Automation Risk
                // (mean AI capability). Closing this modal writes these scores back to the role.
                const liveAiAvg = result.tasks.reduce((sum, task) => sum + task.ai_exposure_score, 0) / (result.tasks.length || 1);
                const liveHumanAvg = result.tasks.reduce((sum, task) => sum + task.human_criticality_score, 0) / (result.tasks.length || 1);
                const aiDisplay = Math.round(liveAiAvg * 100);
                const humanDisplay = Math.round(liveHumanAvg * 100);

                return (
                    <div className="space-y-6 animate-in fade-in duration-300">
                        <p className="text-[11px] text-gray-500 leading-relaxed">
                            Scores are cached per role after the first Analyze (and Claude is pinned to temperature 0), so re-opening Analyze for the same job returns the same numbers. Closing this window also updates the role panel so both stay consistent.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 flex items-center gap-4">
                                <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 font-bold text-lg shrink-0">
                                    {aiDisplay}%
                                </div>
                                <div>
                                    <h4 className="text-gray-300 text-sm font-semibold uppercase tracking-wider">AI Automation Score</h4>
                                    <p className="text-gray-500 text-xs mt-0.5">Average AI capability across tasks</p>
                                </div>
                            </div>
                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 flex items-center gap-4">
                                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg shrink-0">
                                    {humanDisplay}%
                                </div>
                                <div>
                                    <h4 className="text-gray-300 text-sm font-semibold uppercase tracking-wider">Human Criticality</h4>
                                    <p className="text-gray-500 text-xs mt-0.5">Average need for human judgment</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-blue-500/[0.04] border border-blue-500/15 rounded-xl p-5">
                            <h4 className="text-blue-400 text-xs font-semibold uppercase tracking-wider mb-2">Strategic Insight</h4>
                            <p className="text-gray-200 text-sm leading-relaxed italic">"{result.strategic_insight}"</p>
                        </div>

                        <div className="space-y-3">
                            <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider border-b border-white/[0.06] pb-2">Task-by-Task Breakdown</h4>
                            <p className="text-[11px] text-gray-500">
                                Red AI badges mark tasks classified as Automatable (high AI capability and low human criticality) — the same rule the role panel uses for Automation Risk tasks.
                            </p>
                            <div className="space-y-2">
                                {result.tasks.map((task, i) => {
                                    const taskAiDisplay = Math.round(task.ai_exposure_score * 100);
                                    const taskHumanDisplay = Math.round(task.human_criticality_score * 100);
                                    const category = getTaskCategory({
                                        aiCapabilityScore: task.ai_exposure_score,
                                        humanCriticalityScore: task.human_criticality_score,
                                    });
                                    const isAutomatable = category === 'Automatable';
                                    const isHumanCritical = category === 'Human-Critical';

                                    return (
                                        <div key={i} className="p-4 bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] rounded-lg transition-colors">
                                            <div className="flex justify-between items-start gap-4">
                                                <p className="text-gray-200 font-medium text-sm flex-1">{task.task_text}</p>
                                                <div className="flex gap-2 shrink-0">
                                                    <span className={`px-2 py-1 rounded text-[10px] font-semibold uppercase border ${isAutomatable ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-white/[0.04] text-gray-500 border-white/[0.08]'}`}>
                                                        AI {taskAiDisplay}%
                                                    </span>
                                                    <span className={`px-2 py-1 rounded text-[10px] font-semibold uppercase border ${isHumanCritical ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.04] text-gray-500 border-white/[0.08]'}`}>
                                                        Human {taskHumanDisplay}%
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-2 pl-2 border-l-2 border-white/[0.06] italic">{task.reasoning}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })() : (
                <div className="text-center py-10">
                    <p className="text-red-400 text-sm">Analysis failed. Check the message above or your Claude setup.</p>
                </div>
            )}
        </Modal>
    );
};
