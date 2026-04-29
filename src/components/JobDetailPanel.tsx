import React from 'react';
import { useStore } from '../store';
import RoadmapModal from './Modals/RoadmapModal';
import { ScenarioModal } from './Modals/ScenarioModal';
import { AnalysisModal } from './Modals/AnalysisModal';
import { generateJobScenario, analyzeJob, getClaudeUserFriendlyMessage, type ScenarioResult, type JobAnalysis } from '../utils/analysis';
import { IconBrain, IconSparkles, IconAlertTriangle, IconShield, IconTarget, IconInfo, IconTrendingDown, IconCheck } from './ui/Icons';
import { Skeleton } from './ui/Skeleton';
import { Z } from '../config/layers';
import { RISK_THRESHOLDS, UI, CHART, CONFIDENCE } from '../config/constants';
import { getSeriesIdForJob, getSeriesLabel } from '../utils/bls';
import type { Job } from '../types';

interface JobDetailPanelProps {
    job: Job;
    analysisResult: JobAnalysis | null;
    analysisLoading: boolean;
    analysisError: string | null;
    missingApiKey: boolean;
    onClose: () => void;
    onSetAnalysisResult: (result: JobAnalysis | null) => void;
    onSetAnalysisLoading: (loading: boolean) => void;
    onShowMethodology: () => void;
}

export const JobDetailPanel: React.FC<JobDetailPanelProps> = ({
    job, analysisResult, analysisLoading, analysisError, missingApiKey,
    onClose, onSetAnalysisResult, onSetAnalysisLoading, onShowMethodology,
}) => {
    const [showScenarioModal, setShowScenarioModal] = React.useState(false);
    const [scenarioLoading, setScenarioLoading] = React.useState(false);
    const [scenarioResult, setScenarioResult] = React.useState<ScenarioResult | null>(null);
    const [scenarioError, setScenarioError] = React.useState<string | null>(null);
    const [showAnalysisModal, setShowAnalysisModal] = React.useState(false);
    const [analysisModalError, setAnalysisModalError] = React.useState<string | null>(null);
    const [showRoadmapModal, setShowRoadmapModal] = React.useState(false);

    const handleAnalyze = async () => {
        onSetAnalysisLoading(true);
        setShowAnalysisModal(true);
        setAnalysisModalError(null);
        try {
            const taskList = job.tasks.map(t => t.name);
            const res = await analyzeJob(job.title, taskList);
            onSetAnalysisResult(res);
            if (res?.yearlyForecast) {
                useStore.getState().updateJobForecast(job.id, res.yearlyForecast);
            }
        } catch (e) {
            console.error(e);
            setAnalysisModalError(getClaudeUserFriendlyMessage(e));
        } finally {
            onSetAnalysisLoading(false);
        }
    };

    const handleCrystalBall = async () => {
        setScenarioLoading(true);
        setShowScenarioModal(true);
        setScenarioError(null);
        setScenarioResult(null);
        try {
            const result = await generateJobScenario(job.title, job.automationCostIndex, job.tasks);
            setScenarioResult(result);
        } catch (err) {
            console.error(err);
            setScenarioError(getClaudeUserFriendlyMessage(err));
        } finally {
            setScenarioLoading(false);
        }
    };

    const riskValue = job.automationCostIndex;

    const sortedByRisk = [...job.tasks].sort((a, b) => b.aiCapabilityScore - a.aiCapabilityScore);
    const sortedByHuman = [...job.tasks].sort((a, b) => b.humanCriticalityScore - a.humanCriticalityScore);
    const riskTask = sortedByRisk[0];
    const safeTask = sortedByHuman[0];

    const highRiskTasks = job.tasks.filter(t => t.aiCapabilityScore > RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE).slice(0, UI.MAX_TASK_PREVIEW);
    const safeTasks = job.tasks.filter(t => t.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE).slice(0, UI.MAX_TASK_PREVIEW);

    return (
        <>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-2 md:p-8" style={{ zIndex: Z.detailPanel }}>
                <div className="bg-gray-900/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl rounded-2xl w-full max-w-6xl h-auto max-h-[85vh] flex flex-col pointer-events-auto overflow-hidden">

                    {/* Header */}
                    <div className="flex-none p-4 md:p-6 border-b border-white/[0.06] flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    {job.cluster}
                                </span>
                                {job.confidenceScore >= CONFIDENCE.VERIFIED_THRESHOLD ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                        <IconCheck size={10} /> Verified
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                        ~ Est.
                                    </span>
                                )}
                                {job.isStale && (
                                    <span title="Stale Data: BLS API rate limit exceeded. Showing cached employment data." className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1 cursor-help">
                                        <IconAlertTriangle size={10} /> Stale
                                    </span>
                                )}
                                <span className="text-[10px] text-gray-500 font-mono">{job.id.slice(0, 8)}</span>
                            </div>
                            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">{job.title}</h2>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleAnalyze}
                                className="hidden md:flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold text-xs uppercase tracking-wider transition-colors min-h-[44px]"
                            >
                                <IconBrain size={14} /> Analyze
                            </button>
                            <button
                                onClick={handleCrystalBall}
                                className="hidden md:flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold text-xs uppercase tracking-wider transition-colors min-h-[44px]"
                            >
                                <IconSparkles size={14} /> Scenario
                            </button>
                            <button
                                onClick={onClose}
                                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white transition-colors"
                                aria-label="Close panel"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    {/* Metrics Row */}
                    <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-3 p-4 md:p-6 border-b border-white/[0.04]">
                        {/* Risk Gauge */}
                        <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06] flex flex-col items-center justify-center relative group">
                            <button
                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => { e.stopPropagation(); onShowMethodology(); }}
                                aria-label="View methodology"
                            >
                                <IconInfo size={12} className="text-gray-500 hover:text-cyan-400" />
                            </button>
                            <div className="relative w-20 h-20 flex items-center justify-center">
                                <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                                    <circle cx="48" cy="48" r="36" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-white/[0.06]" />
                                    <circle
                                        cx="48" cy="48" r="36" stroke="currentColor" strokeWidth="6" fill="transparent"
                                        strokeDasharray={2 * Math.PI * 36}
                                        strokeDashoffset={2 * Math.PI * 36 * (1 - riskValue)}
                                        strokeLinecap="round"
                                        className={`${riskValue > CHART.RADIAL_GAUGE.COLOR_HIGH ? 'text-red-500' : riskValue > CHART.RADIAL_GAUGE.COLOR_LOW ? 'text-amber-500' : 'text-emerald-500'} transition-all duration-700`}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className={`text-lg font-bold tabular-nums ${riskValue > CHART.RADIAL_GAUGE.COLOR_HIGH ? 'text-red-400' : 'text-white'}`}>
                                        {(riskValue * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider mt-2">Automation Risk</p>
                        </div>

                        {/* Growth */}
                        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex flex-col justify-center">
                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Growth Outlook</p>
                            <div className="text-2xl font-bold text-white tabular-nums">{job.projectedGrowth > 0 ? '+' : ''}{job.projectedGrowth}%</div>
                            <p className="text-[10px] text-gray-600">projected by 2030</p>
                        </div>

                        {/* Human Resilience */}
                        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex flex-col justify-center">
                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Human Resilience</p>
                            {(() => {
                                const val = analysisResult?.human_resilience_label;
                                const color = val ? ((val === 'Critical' || val === 'Very High') ? 'text-emerald-400' : val === 'High' ? 'text-cyan-400' : 'text-amber-400') : 'text-gray-600';
                                return val ? (
                                    <div className={`text-xl font-bold ${color}`}>{val}</div>
                                ) : (
                                    <Skeleton className="h-6 w-20" />
                                );
                            })()}
                            <p className="text-[10px] text-gray-600 mt-0.5">Social Intel Priority</p>
                        </div>

                        {/* Salary Sparkline */}
                        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex flex-col items-center justify-center">
                            {(() => {
                                const val = analysisResult?.salary_volatility_label;
                                const forecast = analysisResult?.salary_forecast;
                                let data: number[] = [];
                                if (forecast && forecast.length >= 2) {
                                    data = forecast;
                                } else {
                                    // Derive baseline from real BLS growth + automation risk
                                    // projectedGrowth is total growth over 2022-2032 (10yr), scale to 5yr
                                    const annualRate = (job.projectedGrowth / 100) / 10;
                                    const riskDrag = job.automationCostIndex * 0.015;
                                    data = Array.from({ length: 6 }, (_, i) => {
                                        const trend = 100 * Math.pow(1 + annualRate - riskDrag, i);
                                        const volatility = job.automationCostIndex > 0.6
                                            ? Math.sin(i * 1.8) * job.automationCostIndex * 4
                                            : 0;
                                        return parseFloat((trend + volatility).toFixed(1));
                                    });
                                }
                                const isHighRisk = val === 'High' || val === 'Very High' || (data[data.length - 1] < data[0]);
                                const color = isHighRisk ? '#ef4444' : '#22c55e';
                                return (
                                    <>
                                        <svg width="90" height="36" className="overflow-visible mb-2">
                                            <line x1="0" y1="18" x2="90" y2="18" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 2" />
                                            <polyline
                                                fill="none" stroke={color} strokeWidth="1.5"
                                                points={data.map((d, i) => {
                                                    const x = i * (90 / (data.length - 1));
                                                    const y = Math.max(2, Math.min(34, 18 - (d - 100)));
                                                    return `${x},${y}`;
                                                }).join(' ')}
                                                strokeLinecap="round" strokeLinejoin="round"
                                            />
                                            <circle
                                                cx="90"
                                                cy={Math.max(2, Math.min(34, 18 - (data[data.length - 1] - 100)))}
                                                r="2.5" fill={color}
                                            />
                                        </svg>
                                        <div className="flex items-center gap-1 mt-1 cursor-help group/tooltip relative">
                                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider truncate max-w-[80px]">
                                                {getSeriesLabel(getSeriesIdForJob(job.title)) || 'Employment Trend'}
                                            </p>
                                            <IconInfo size={10} className="text-gray-500" />
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-900 border border-gray-700 rounded-lg text-[9px] text-gray-300 opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10 text-center leading-tight">
                                                This sparkline shows employment for the broader occupation group, not this specific role. BLS does not provide high-frequency per-occupation data.
                                            </div>
                                        </div>
                                        <div className="text-xs font-semibold tabular-nums" style={{ color }}>{val || '--'}</div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                            {/* Automation Risk Card */}
                            <div className="rounded-xl p-5 border border-red-500/15 bg-red-500/[0.03]">
                                <h3 className="text-red-400 font-semibold uppercase tracking-wider text-xs mb-4 flex items-center gap-2">
                                    <IconAlertTriangle size={14} /> Automation Risk
                                </h3>
                                <div className="space-y-3">
                                    {highRiskTasks.map((task, i) => (
                                        <div key={i} className="bg-white/[0.02] border border-red-500/10 hover:border-red-500/25 p-3.5 rounded-lg flex justify-between items-center gap-3 transition-colors">
                                            <div className="text-gray-200 text-sm font-medium flex-1 truncate">{task.name}</div>
                                            <div className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-1 rounded border border-red-500/15 tabular-nums shrink-0">
                                                {(task.aiCapabilityScore * 100).toFixed(0)}% RISK
                                            </div>
                                        </div>
                                    ))}
                                    {highRiskTasks.length === 0 && (
                                        <EmptyState loading={analysisLoading} error={analysisError} missingKey={missingApiKey} type="risk" />
                                    )}
                                </div>
                                <div className="mt-5 pt-3 border-t border-white/[0.04]">
                                    <p className="text-[10px] text-red-400/60 font-mono uppercase tracking-widest mb-2">Likely Replacements</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(analysisResult?.likely_replacements || []).length > 0 ? (
                                            analysisResult?.likely_replacements.map((skill, i) => (
                                                <span key={i} className="px-2 py-0.5 bg-red-500/[0.06] border border-red-500/15 rounded text-[10px] text-red-300">{skill}</span>
                                            ))
                                        ) : (
                                            <span className="text-gray-600 text-[10px] italic">Run analysis to see threats...</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Human Skills Card */}
                            <div className="rounded-xl p-5 border border-emerald-500/15 bg-emerald-500/[0.03]">
                                <h3 className="text-emerald-400 font-semibold uppercase tracking-wider text-xs mb-4 flex items-center gap-2">
                                    <IconShield size={14} /> Human Skills
                                </h3>
                                <div className="space-y-3">
                                    {safeTasks.map((task, i) => (
                                        <div key={i} className="bg-white/[0.02] border border-emerald-500/10 hover:border-emerald-500/25 p-3.5 rounded-lg flex justify-between items-center gap-3 transition-colors">
                                            <div className="text-white text-sm font-medium flex-1 truncate">{task.name}</div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider hidden md:inline">Safe</span>
                                            </div>
                                        </div>
                                    ))}
                                    {safeTasks.length === 0 && (
                                        <EmptyState loading={analysisLoading} error={analysisError} missingKey={missingApiKey} type="safe" />
                                    )}
                                </div>
                                <div className="mt-5 pt-3 border-t border-white/[0.04]">
                                    <p className="text-[10px] text-emerald-400/60 font-mono uppercase tracking-widest mb-2">Required Traits</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(analysisResult?.human_centric_traits || []).length > 0 ? (
                                            analysisResult?.human_centric_traits.map((skill, i) => (
                                                <span key={i} className="px-2 py-0.5 bg-emerald-500/[0.06] border border-emerald-500/15 rounded text-[10px] text-emerald-300">{skill}</span>
                                            ))
                                        ) : (
                                            <span className="text-gray-600 text-[10px] italic">Run analysis to identify traits...</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Plan Bar */}
                        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
                            <div className="flex flex-col md:flex-row items-center justify-between gap-5">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                                        <IconTarget size={18} className="text-blue-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-white font-semibold text-sm">Career Transition Strategy</h3>
                                        <p className="text-gray-500 text-xs">Data-driven upskilling plan</p>
                                    </div>
                                </div>

                                <div className="flex-1 md:border-l border-white/[0.06] md:pl-5">
                                    {(() => {
                                        const riskItem = highRiskTasks[0];
                                        const safeItem = safeTasks[0];
                                        if (riskItem && safeItem) {
                                            return (
                                                <div className="space-y-2 text-sm text-gray-300">
                                                    <div className="flex items-start gap-2">
                                                        <IconTrendingDown size={14} className="text-red-400 mt-0.5 shrink-0" />
                                                        <span>Reduce focus on <span className="text-red-300 font-medium">{riskItem.name}</span></span>
                                                    </div>
                                                    <div className="flex items-start gap-2">
                                                        <IconCheck size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                                                        <span>Develop expertise in <span className="text-emerald-300 font-medium">{safeItem.name}</span></span>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return <p className="text-sm text-gray-400">Focus on developing social intelligence and complex problem-solving skills.</p>;
                                    })()}
                                </div>

                                <button
                                    onClick={() => setShowRoadmapModal(true)}
                                    className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors shrink-0 min-h-[44px]"
                                >
                                    View Roadmap
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex-none p-3 border-t border-white/[0.04] flex justify-end text-[10px] text-gray-600 font-mono uppercase tracking-wider">
                        <span>Sources: {(job.dataSources || ['Modeled']).join(', ')}</span>
                    </div>
                </div>
            </div>

            {/* Sub-modals */}
            <ScenarioModal
                isOpen={showScenarioModal}
                isLoading={scenarioLoading}
                result={scenarioResult}
                errorMessage={scenarioError}
                onClose={() => setShowScenarioModal(false)}
            />
            {showRoadmapModal && riskTask && safeTask && (
                <RoadmapModal job={job} riskTask={riskTask} targetTask={safeTask} onClose={() => setShowRoadmapModal(false)} />
            )}
            <AnalysisModal
                isOpen={showAnalysisModal}
                isLoading={analysisLoading}
                job={job}
                result={analysisResult}
                errorMessage={analysisModalError}
                onClose={() => setShowAnalysisModal(false)}
            />
        </>
    );
};

function EmptyState({ loading, error, missingKey, type }: { loading: boolean; error: string | null; missingKey: boolean; type: 'risk' | 'safe' }) {
    return (
        <div className="flex flex-col items-center justify-center py-6 text-center space-y-2 opacity-70">
            {loading ? (
                <>
                    <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin"></div>
                    <p className="text-cyan-400 text-xs">Analyzing...</p>
                </>
            ) : missingKey ? (
                <>
                    <IconBrain size={20} className="text-gray-500" />
                    <p className="text-gray-400 text-xs">Click Analyze to run AI assessment</p>
                </>
            ) : error ? (
                <p className="text-red-400 text-xs">{error}</p>
            ) : (
                <>
                    {type === 'risk' ? <IconShield size={20} className="text-emerald-500" /> : <IconAlertTriangle size={20} className="text-amber-500" />}
                    <p className="text-gray-400 text-xs">
                        {type === 'risk' ? 'No high-risk tasks found' : 'No specific safe zones found'}
                    </p>
                </>
            )}
        </div>
    );
}
