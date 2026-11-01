import React from 'react';
import { CHART, RISK_THRESHOLDS } from '../config/constants';
import { partitionRoleTasks, isHybridTask, emptyColumnNote } from '../utils/taskPartition';
import { compareWithKelley, scoredOnLabel, type BlsRoleScore, type BlsTaskScore } from '../utils/blsScores';
import { IconAlertTriangle, IconInfo, IconShield } from './ui/Icons';

/**
 * Published AI scores on the panel of a scored BLS occupation (OccupationPanel).
 * Same look as JobDetailPanel's tiles and task cards, with the published
 * numbers only: no Analyze, no Defend / Build, no Roadmap or Scenario, so
 * nothing here can call Claude.
 */

const riskTone = (v: number) =>
    v > CHART.RADIAL_GAUGE.COLOR_HIGH ? 'text-red-500' : v > CHART.RADIAL_GAUGE.COLOR_LOW ? 'text-amber-500' : 'text-emerald-500';

export const RiskTile: React.FC<{ score: BlsRoleScore }> = ({ score }) => {
    const v = score.automationCostIndex;
    return (
        <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06] flex items-center gap-3 relative min-w-0" data-testid="bls-risk">
            <div className="relative w-11 h-11 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96" aria-hidden="true">
                    <circle cx="48" cy="48" r="38" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-white/[0.06]" />
                    <circle
                        cx="48" cy="48" r="38" stroke="currentColor" strokeWidth="10" fill="transparent"
                        strokeDasharray={2 * Math.PI * 38}
                        strokeDashoffset={2 * Math.PI * 38 * (1 - v)}
                        strokeLinecap="round"
                        className={riskTone(v)}
                    />
                </svg>
            </div>
            <div className="min-w-0">
                <div className={`text-lg font-bold tabular-nums leading-tight ${v > CHART.RADIAL_GAUGE.COLOR_HIGH ? 'text-red-400' : 'text-white'}`}>
                    {(v * 100).toFixed(0)}%
                </div>
                <div className="relative group/gauge flex items-center gap-1">
                    <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Automation Risk</p>
                    <IconInfo size={10} className="text-gray-500 shrink-0" />
                    <div className="absolute top-full left-0 mt-2 w-56 p-2 bg-gray-900 border border-gray-700 rounded-lg text-[9px] text-gray-300 opacity-0 group-hover/gauge:opacity-100 pointer-events-none transition-opacity z-10 leading-tight">
                        The average of the risk scores shown on each of this role&rsquo;s tasks below. It is not a count of tasks at risk, so it can sit in the middle even when no single task is mostly automated.
                    </div>
                </div>
            </div>
        </div>
    );
};

export const HumanTile: React.FC<{ score: BlsRoleScore }> = ({ score }) => (
    <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06] flex flex-col justify-center min-w-0" data-testid="bls-human">
        <div className="text-lg font-bold tabular-nums leading-tight text-emerald-400">
            {(parseFloat(score.humanCriticality.toFixed(2)) * 100).toFixed(0)}%
        </div>
        <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Human Criticality</p>
        <p className="text-[10px] text-gray-600 leading-tight">Average need for human judgment</p>
    </div>
);

/** Where the role would sit among the 50 published Kelley roles, which stay as they are. */
export const KelleyComparisonLine: React.FC<{ score: BlsRoleScore }> = ({ score }) => {
    const c = compareWithKelley(score);
    if (!c) return null;
    return (
        <p className="col-span-2 md:col-span-4 text-[11px] text-gray-300 leading-snug" data-testid="bls-rank">
            <span className="text-gray-500">Compared with the {c.total} Kelley roles: </span>
            its Automation Risk is higher than {c.riskHigherThan} of them, and its need for human judgment is higher than{' '}
            {c.humanHigherThan} of them (Human Resilience would be <span className="font-semibold text-gray-100">{c.resilienceLabel}</span>).
            {' '}<span className="text-gray-500">This role is not one of the {c.total}, so their own ranks do not change.</span>
        </p>
    );
};

export const ScoreProvenanceLine: React.FC<{ score: BlsRoleScore }> = ({ score }) => (
    <p className="col-span-2 md:col-span-4 text-[10px] text-gray-500 leading-snug" data-testid="bls-provenance">
        Scored by {score.model} on {scoredOnLabel(score.scoredAt)}, from {score.tasks.length} O*NET tasks
        {score.onetCodes.length > 0 && ` (${score.onetCodes.join(', ')})`}. Published with the app: the same figures for every visitor, with no live AI call.
    </p>
);

const TaskChips: React.FC<{ task: BlsTaskScore; riskChipClass: string }> = ({ task, riskChipClass }) => {
    const isHumanCritical = task.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE;
    return (
        <div className="flex items-center gap-1.5">
            <div className={`text-[10px] font-semibold px-2 py-1 rounded border tabular-nums ${riskChipClass}`}>
                {(task.aiCapabilityScore * 100).toFixed(0)}% RISK
            </div>
            <div
                title="Need for human judgment on this task. Rated independently of the risk score."
                className={`text-[10px] font-semibold px-2 py-1 rounded border tabular-nums ${isHumanCritical ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-gray-500 bg-white/[0.04] border-white/[0.08]'}`}
            >
                {(task.humanCriticalityScore * 100).toFixed(0)}% HUMAN
            </div>
        </div>
    );
};

/** The rated tasks in JobDetailPanel's two columns, split by the same rule. */
export const RatedTasks: React.FC<{ score: BlsRoleScore }> = ({ score }) => {
    const { exposed, resistant } = partitionRoleTasks(score.tasks);
    return (
        <section data-testid="bls-rated-tasks">
            <h3 className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
                Rated tasks <span className="normal-case tracking-normal text-gray-600">· {score.tasks.length} O*NET tasks, scored by {score.model}</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-xl p-4 border border-red-500/15 bg-red-500/[0.03]">
                    <h4 className="text-red-400 font-semibold uppercase tracking-wider text-xs mb-2 flex items-center gap-2">
                        <IconAlertTriangle size={14} /> Automation Risk
                    </h4>
                    {exposed.length > 0 && (
                        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
                            Current GenAI can handle much of the following tasks (capability, not guaranteed adoption).
                        </p>
                    )}
                    <div className="space-y-3">
                        {exposed.map((task) => (
                            <div key={`${task.onetCode}-${task.taskId}`} data-testid="bls-task" className="bg-white/[0.02] border border-red-500/10 p-3.5 rounded-lg flex max-md:flex-col justify-between items-start gap-3 max-md:gap-2">
                                <div className="flex-1 min-w-0 text-gray-200 text-sm font-medium" data-testid="bls-task-name">{task.name}</div>
                                <div className="flex flex-col items-end gap-1.5 shrink-0 mt-0.5 max-md:mt-0 max-md:flex-row max-md:flex-wrap max-md:items-center">
                                    <TaskChips task={task} riskChipClass="text-red-400 bg-red-500/10 border-red-500/15" />
                                    {isHybridTask(task) && (
                                        <span
                                            title="GenAI is capable of much of this task, but human judgment still decides the outcome."
                                            className="text-[9px] font-semibold text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase tracking-wider cursor-help"
                                        >
                                            Hybrid
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {exposed.length === 0 && <p className="text-xs text-gray-400 leading-relaxed">{emptyColumnNote('exposed', false)}</p>}
                    </div>
                </div>

                <div className="rounded-xl p-4 border border-emerald-500/15 bg-emerald-500/[0.03]">
                    <h4 className="text-emerald-400 font-semibold uppercase tracking-wider text-xs mb-2 flex items-center gap-2">
                        <IconShield size={14} /> Human Skills
                    </h4>
                    {resistant.length > 0 && (
                        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
                            The following tasks are rated as resisting automation relative to others here.
                        </p>
                    )}
                    <div className="space-y-3">
                        {resistant.map((task) => (
                            <div key={`${task.onetCode}-${task.taskId}`} data-testid="bls-task" className="bg-white/[0.02] border border-emerald-500/10 p-3.5 rounded-lg flex max-md:flex-col justify-between items-start gap-3 max-md:gap-2">
                                <div className="flex-1 min-w-0 text-white text-sm font-medium" data-testid="bls-task-name">{task.name}</div>
                                <div className="flex flex-col items-end gap-1.5 shrink-0 mt-1 max-md:mt-0 max-md:flex-row max-md:flex-wrap max-md:items-center">
                                    <TaskChips task={task} riskChipClass="text-emerald-400 bg-emerald-500/10 border-emerald-500/15" />
                                </div>
                            </div>
                        ))}
                        {resistant.length === 0 && (
                            <p className="text-xs text-gray-400 leading-relaxed">{emptyColumnNote('resistant', exposed.some(isHybridTask))}</p>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
