import React from 'react';
import { useStore } from '../store';
import RoadmapModal from './Modals/RoadmapModal';
import { ScenarioModal } from './Modals/ScenarioModal';
import { AnalysisModal } from './Modals/AnalysisModal';
import { UpskillModal } from './UpskillModal';
import type { UpskillMode } from '../utils/analysis';
import { generateJobScenario, analyzeJob, getClaudeUserFriendlyMessage, type ScenarioResult, type JobAnalysis } from '../utils/analysis';
import { IconBrain, IconSparkles, IconAlertTriangle, IconShield, IconTarget, IconInfo, IconTrendingDown, IconCheck, IconBookmark, IconAward } from './ui/Icons';
import { Z } from '../config/layers';
import { UI, CHART, RESILIENCE_LABELS } from '../config/constants';
import { partitionRoleTasks, isHybridTask, pickRoadmapPair, emptyColumnNote } from '../utils/taskPartition';
import { forecastPathPoints } from '../utils/terrainMath';
import { jobSourceProvenanceChips, panelSourceList } from '../utils/provenance';
import { ProvenanceBadge } from './ProvenanceBadge';
import { useUserStore } from '../userStore';
import { loadScenario, saveScenario } from '../lib/userData';
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

const RESILIENCE_COLOR: Record<string, string> = {
    [RESILIENCE_LABELS.TOP]: 'text-emerald-400',
    [RESILIENCE_LABELS.MID]: 'text-cyan-400',
    [RESILIENCE_LABELS.BOTTOM]: 'text-amber-400',
};

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
    // Carries the mode and the task's real exposure, because both are sent to
    // the model as fact — see UpskillMode in utils/analysis.
    const [upskillTarget, setUpskillTarget] = React.useState<{ name: string; mode: UpskillMode; riskPercent: number } | null>(null);

    // Which of THIS job's tasks the signed-in user has already trained on —
    // drives the "Trained" badge vs the Defend/Build button below. Select the
    // raw array (stable reference unless it actually changes) and derive the
    // Set with useMemo — building a new Set directly inside the selector
    // returns a new object every call, which Zustand's default reference
    // check sees as "always changed" and sends React into an infinite render
    // loop (confirmed: crashed the panel via ErrorBoundary in testing).
    const upskillCompletions = useUserStore((s) => s.activity.upskillCompletions);
    const completedTaskNames = React.useMemo(
        () => new Set(upskillCompletions.filter((u) => u.jobId === job.id).map((u) => u.taskName)),
        [upskillCompletions, job.id]
    );

    const sourceChips = React.useMemo(() => jobSourceProvenanceChips(job), [job]);

    // Match every other modal in the app (ui/Modal, RescoreConfirmModal):
    // Escape closes it. Skipped while a nested modal (Scenario/Analysis/
    // Roadmap/Upskill) is open so Escape closes that top layer first, not
    // this panel out from under it.
    const hasNestedModalOpen = showScenarioModal || showAnalysisModal || showRoadmapModal || upskillTarget !== null;
    React.useEffect(() => {
        if (hasNestedModalOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [hasNestedModalOpen, onClose]);

    const handleAnalyze = async () => {
        onSetAnalysisLoading(true);
        setShowAnalysisModal(true);
        setAnalysisModalError(null);
        try {
            const taskList = job.tasks.map(t => t.name);
            const res = await analyzeJob(job.id, job.title, taskList, {
                employment: job.employment,
                projectedGrowth: job.projectedGrowth,
            });
            onSetAnalysisResult(res);
        } catch (e) {
            console.error(e);
            setAnalysisModalError(getClaudeUserFriendlyMessage(e));
        } finally {
            onSetAnalysisLoading(false);
        }
    };

    const handleCrystalBall = async () => {
        setShowScenarioModal(true);
        setScenarioError(null);
        setScenarioResult(null);

        // A saved scenario restores instantly with no Claude call — this is a
        // ~1KB artifact that previously had zero caching and was re-billed on
        // every single open (see src/lib/userData.ts scenarioCacheKey).
        const saved = await loadScenario(job.id);
        if (saved) {
            setScenarioResult(saved);
            return;
        }

        setScenarioLoading(true);
        try {
            const result = await generateJobScenario(job.title, job.automationCostIndex, job.tasks);
            setScenarioResult(result);
            void saveScenario(job.id, job.title, result);
        } catch (err) {
            console.error(err);
            setScenarioError(getClaudeUserFriendlyMessage(err));
        } finally {
            setScenarioLoading(false);
        }
    };

    const isRoleSaved = useUserStore((state) => state.isRoleSaved(job.id));
    const toggleSavedRole = useUserStore((state) => state.toggleSavedRole);
    const authStatus = useUserStore((state) => state.authStatus);

    const blsSource = useStore((state) => state.blsSource);
    const blsFetchedAt = useStore((state) => state.blsFetchedAt);

    const formatAge = (ms: number): string => {
        const hours = Math.floor(ms / (60 * 60 * 1000));
        if (hours < 1) return '<1h';
        if (hours < 48) return `${hours}h`;
        return `${Math.floor(hours / 24)}d`;
    };
    const blsAge = blsFetchedAt !== null ? formatAge(Date.now() - blsFetchedAt) : null;

    const riskValue = job.automationCostIndex;

    const { riskTask, safeTask } = pickRoadmapPair(job.tasks);

    // The gauge is the mean of these same per-task scores, and every task shows
    // its score in one of the two columns (see utils/taskPartition).
    const { exposed, resistant } = React.useMemo(
        () => partitionRoleTasks(job.tasks, (t) => completedTaskNames.has(t.name)),
        [job.tasks, completedTaskNames],
    );
    const highRiskTasks = exposed.slice(0, UI.MAX_TASK_PREVIEW);
    const safeTasks = resistant.slice(0, UI.MAX_TASK_PREVIEW);

    return (
        <>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-2 md:p-8" style={{ zIndex: Z.detailPanel }}>
                {/* Backdrop — dims and blurs the terrain/header/legend behind the
                    panel so focus stays on the report, matching ui/Modal's own
                    backdrop convention. Click-through closes, same as every
                    other modal in the app. */}
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
                    onClick={onClose}
                    aria-hidden="true"
                />
                <div className="relative bg-gray-900/95 backdrop-blur-xl border border-cyan-400/20 shadow-2xl rounded-2xl w-full max-w-6xl h-auto max-h-[85vh] flex flex-col pointer-events-auto overflow-hidden">

                    {/* Header */}
                    <div className="flex-none p-4 md:p-6 border-b border-white/[0.06] flex justify-between items-start gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    {job.cluster}
                                </span>
                                {job.isStale ? (
                                    <span title="Live BLS fetch unavailable (daily quota resets at midnight ET). Showing bundled BLS OES estimates from the build." className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1 cursor-help">
                                        <IconAlertTriangle size={10} /> Bundled data
                                    </span>
                                ) : blsSource === 'cache' && blsAge ? (
                                    <span title={`Cached BLS employment data from ${blsAge} ago. Refreshes automatically after 24h (BLS daily quota resets at midnight ET).`} className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 cursor-help">
                                        <IconInfo size={10} /> BLS data {blsAge}
                                    </span>
                                ) : null}
                                <span className="hidden md:inline text-[10px] text-gray-500 font-mono">{job.id.slice(0, 8)}</span>
                            </div>
                            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">{job.title}</h2>
                            <div className="flex flex-wrap gap-1.5 mt-2" aria-label="Data sources for this role">
                                {sourceChips.map((c) => (
                                    <ProvenanceBadge key={c.key} label={c.label} provenance={c.provenance} />
                                ))}
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1.5">
                                Tap any badge for a simple explanation.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            {authStatus !== 'disabled' && (
                                <button
                                    onClick={() => void toggleSavedRole(job.id, job.title)}
                                    title={isRoleSaved ? 'Remove from saved roles' : 'Save this role to your activity'}
                                    aria-pressed={isRoleSaved}
                                    className={`hidden md:flex items-center justify-center w-11 h-11 rounded-lg transition-colors ${
                                        isRoleSaved
                                            ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                                            : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-white'
                                    }`}
                                >
                                    <IconBookmark size={16} {...(isRoleSaved ? { fill: 'currentColor' } : {})} />
                                </button>
                            )}
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
                                className="w-11 h-11 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-white transition-colors"
                                aria-label="Close panel"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    {/* On a phone the metrics grid alone is ~300px and, being flex-none,
                        it pushed the action row and footer outside the panel box (where
                        overflow-hidden clipped them). This wrapper makes the metrics scroll
                        with the content on phones; `md:contents` removes the wrapper from
                        layout at md and up, so the desktop panel is byte-for-byte unchanged. */}
                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar md:contents">
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
                            <div className="relative group/gauge flex items-center gap-1 mt-2">
                                <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Automation Risk</p>
                                <IconInfo size={10} className="text-gray-500" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 bg-gray-900 border border-gray-700 rounded-lg text-[9px] text-gray-300 opacity-0 group-hover/gauge:opacity-100 pointer-events-none transition-opacity z-10 text-center leading-tight">
                                    The average of the risk scores shown on each of this role&rsquo;s tasks below. It is not a count of tasks at risk, so it can sit in the middle even when no single task is mostly automated.
                                </div>
                            </div>
                        </div>

                        {/* Growth */}
                        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex flex-col justify-center">
                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Growth Outlook</p>
                            <div className="text-2xl font-bold text-white tabular-nums">{job.projectedGrowth > 0 ? '+' : ''}{job.projectedGrowth}%</div>
                            <p className="text-[10px] text-gray-600">BLS outlook, 2024–34</p>
                        </div>

                        {/* Human Resilience */}
                        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex flex-col justify-center">
                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider mb-1">Human Resilience</p>
                            {/* Published percentile label (store.ts applyPercentileLabels), the same
                                one the 3D view colours by. A live Analyze run no longer overrides it. */}
                            <div
                                title="How this role's average need for human judgment ranks among all 50 roles: top quarter Future-Proof, middle half High, bottom quarter At Risk."
                                className={`text-xl font-bold cursor-help ${RESILIENCE_COLOR[job.humanResilienceLabel] ?? 'text-gray-600'}`}
                            >
                                {job.humanResilienceLabel}
                            </div>
                            <p className="text-[10px] text-gray-600 mt-0.5">Rank among all 50 roles</p>
                        </div>

                        {/* Projected employment path */}
                        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex flex-col items-center justify-center">
                            {(() => {
                                const points = forecastPathPoints(job.yearlyForecast);
                                if (!points) return <div className="text-xl font-bold text-gray-600">—</div>;
                                const end = points[points.length - 1];
                                const color = end < 0 ? '#ef4444' : '#22c55e';
                                const lo = Math.min(0, ...points);
                                const span = Math.max(0, ...points) - lo || 1;
                                const y = (v: number) => 32 - ((v - lo) / span) * 28;
                                return (
                                    <>
                                        <svg width="90" height="36" className="overflow-visible mb-2" aria-hidden="true">
                                            <line x1="0" y1={y(0)} x2="90" y2={y(0)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 2" />
                                            <polyline
                                                fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                                                points={points.map((v, i) => `${i * (90 / (points.length - 1))},${y(v)}`).join(' ')}
                                            />
                                            <circle cx="90" cy={y(end)} r="2.5" fill={color} />
                                        </svg>
                                        <div className="flex items-center gap-1 mt-1 cursor-help group/tooltip relative">
                                            <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider text-center max-w-[110px] leading-tight">Projected jobs 2025–30</p>
                                            <IconInfo size={10} className="text-gray-500" />
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2 bg-gray-900 border border-gray-700 rounded-lg text-[9px] text-gray-300 opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-10 text-center leading-tight">
                                                This role&rsquo;s year-by-year employment forecast: an AI prediction anchored to the BLS 2024&ndash;34 outlook, the same one the 3D view plots in Growth mode. It is not a BLS data series.
                                            </div>
                                        </div>
                                        <div className="text-xs font-semibold tabular-nums" style={{ color }}>{end > 0 ? '+' : ''}{end.toFixed(1)}% by 2030</div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                            {/* Automation Risk Card */}
                            <div className="rounded-xl p-5 border border-red-500/15 bg-red-500/[0.03]">
                                <h3 className="text-red-400 font-semibold uppercase tracking-wider text-xs mb-2 flex items-center gap-2">
                                    <IconAlertTriangle size={14} /> Automation Risk
                                </h3>
                                {highRiskTasks.length > 0 && (
                                    <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
                                        AI is automating much of the following tasks. Defending one means moving into the
                                        judgment around it: reviewing the output and owning the calls it can't.
                                    </p>
                                )}
                                <div className="space-y-3">
                                    {highRiskTasks.map((task) => {
                                        const trained = completedTaskNames.has(task.name);
                                        return (
                                            <div key={task.name} className="bg-white/[0.02] border border-red-500/10 hover:border-red-500/25 p-3.5 rounded-lg flex justify-between items-start gap-3 transition-colors">
                                                <div className="text-gray-200 text-sm font-medium flex-1">{task.name}</div>
                                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                                    <div className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-1 rounded border border-red-500/15 tabular-nums mt-0.5">
                                                        {(task.aiCapabilityScore * 100).toFixed(0)}% RISK
                                                    </div>
                                                    {isHybridTask(task) && (
                                                        <span
                                                            title="AI can do much of this task, but human judgment still decides the outcome. This is where defending it pays off most."
                                                            className="text-[9px] font-semibold text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-wider cursor-help"
                                                        >
                                                            Hybrid
                                                        </span>
                                                    )}
                                                    {trained ? (
                                                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                                                            <IconAward size={11} /> Trained
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => setUpskillTarget({ name: task.name, mode: 'defend', riskPercent: task.aiCapabilityScore * 100 })}
                                                            title="Move from performing this task to owning the judgment around it"
                                                            className="inline-flex items-center max-md:min-h-[44px] text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 uppercase tracking-wider underline decoration-cyan-400/30 hover:decoration-cyan-300 underline-offset-2 transition-colors"
                                                        >
                                                            Defend this task
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
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
                                <h3 className="text-emerald-400 font-semibold uppercase tracking-wider text-xs mb-2 flex items-center gap-2">
                                    <IconShield size={14} /> Human Skills
                                </h3>
                                {safeTasks.length > 0 && (
                                    <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
                                        The following tasks resist automation. This is where deepening your skill compounds.
                                    </p>
                                )}
                                <div className="space-y-3">
                                    {safeTasks.map((task) => {
                                        const trained = completedTaskNames.has(task.name);
                                        return (
                                            <div key={task.name} className="bg-white/[0.02] border border-emerald-500/10 hover:border-emerald-500/25 p-3.5 rounded-lg flex justify-between items-start gap-3 transition-colors">
                                                <div className="text-white text-sm font-medium flex-1">{task.name}</div>
                                                <div className="flex flex-col items-end gap-1.5 shrink-0 mt-1">
                                                    <div className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/15 tabular-nums">
                                                        {(task.aiCapabilityScore * 100).toFixed(0)}% RISK
                                                    </div>
                                                    {trained ? (
                                                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                                                            <IconAward size={11} /> Trained
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => setUpskillTarget({ name: task.name, mode: 'build', riskPercent: task.aiCapabilityScore * 100 })}
                                                            title="Deepen this into a durable advantage"
                                                            className="inline-flex items-center max-md:min-h-[44px] text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 uppercase tracking-wider underline decoration-emerald-400/30 hover:decoration-emerald-300 underline-offset-2 transition-colors"
                                                        >
                                                            Build on this
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {safeTasks.length === 0 && (
                                        <EmptyState loading={analysisLoading} error={analysisError} missingKey={missingApiKey} type="safe" hasHybrid={exposed.some(isHybridTask)} />
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
                                                        <span>Shift <span className="text-red-300 font-medium">{riskItem.name}</span> toward oversight rather than execution</span>
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
                    </div>

                    {/* Mobile action row. Analyze, Scenario and save live in the panel
                        header, which is `hidden md:flex` — on a phone the two headline AI
                        features were unreachable. Same handlers; no desktop class touched. */}
                    <div className="flex-none md:hidden flex items-center gap-2 p-3 border-t border-white/[0.04]">
                        <button
                            onClick={handleAnalyze}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] bg-blue-600 active:bg-blue-500 text-white rounded-lg font-semibold text-xs uppercase tracking-wider transition-colors"
                        >
                            <IconBrain size={14} /> Analyze
                        </button>
                        <button
                            onClick={handleCrystalBall}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] bg-purple-600 active:bg-purple-500 text-white rounded-lg font-semibold text-xs uppercase tracking-wider transition-colors"
                        >
                            <IconSparkles size={14} /> Scenario
                        </button>
                        {authStatus !== 'disabled' && (
                            <button
                                onClick={() => void toggleSavedRole(job.id, job.title)}
                                aria-pressed={isRoleSaved}
                                aria-label={isRoleSaved ? 'Remove from saved roles' : 'Save this role to your activity'}
                                className={`flex items-center justify-center w-11 h-11 shrink-0 rounded-lg transition-colors ${
                                    isRoleSaved
                                        ? 'bg-indigo-500/20 text-indigo-300'
                                        : 'bg-white/[0.04] text-gray-400'
                                }`}
                            >
                                <IconBookmark size={16} {...(isRoleSaved ? { fill: 'currentColor' } : {})} />
                            </button>
                        )}
                    </div>

                    {/* Footer */}
                    <div
                        className="flex-none p-3 border-t border-white/[0.04] flex justify-end text-[10px] text-gray-600 font-mono uppercase tracking-wider"
                        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                    >
                        <span>Sources: {panelSourceList(job).join(', ')}</span>
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
            {upskillTarget && (
                <UpskillModal
                    isOpen={true}
                    onClose={() => setUpskillTarget(null)}
                    jobId={job.id}
                    taskName={upskillTarget.name}
                    mode={upskillTarget.mode}
                    aiRiskPercent={upskillTarget.riskPercent}
                />
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

function EmptyState({ loading, error, missingKey, type, hasHybrid = false }: { loading: boolean; error: string | null; missingKey: boolean; type: 'risk' | 'safe'; hasHybrid?: boolean }) {
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
                    <p className="text-gray-400 text-xs max-w-[16rem] leading-relaxed">
                        {emptyColumnNote(type === 'risk' ? 'exposed' : 'resistant', hasHybrid)}
                    </p>
                </>
            )}
        </div>
    );
}
