import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useIsMobile } from '../hooks/useIsMobile';
import { RISK_THRESHOLDS, MAP_SIDEBAR } from '../config/constants';
import { RISK_BAND_COLORS } from '../config/theme';
import { IconLayers, IconAlertTriangle } from './ui/Icons';
import type { Job } from '../types';

/**
 * Task split view — the third view alongside the 3D terrain and the 2D map.
 *
 * The terrain answers "how exposed is this role"; this answers "which parts of
 * the role". Every role is a bundle of its O*NET tasks, and each task carries
 * its own published AI rating, so the same numbers that drive the terrain also
 * draw these bars — nothing here is a separate dataset.
 *
 * Colour follows the app's existing meaning rather than inventing a second
 * language: red is the automation side (RISK_BAND_COLORS.high), green is the
 * side that still needs a person (RISK_BAND_COLORS.safe).
 */

const AI = RISK_BAND_COLORS.high;
const HUMAN = RISK_BAND_COLORS.safe;

/**
 * The role's published risk score, read straight off the job rather than
 * recomputed. The store derives it once (store.ts: parseFloat(avg.toFixed(2)))
 * and the role panel's gauge renders that same field, so taking it from here
 * means this view cannot drift from the role page even if the formula changes.
 */
const publishedRisk = (job: Job) => job.automationCostIndex;

const meanAi = publishedRisk;

const spreadAi = (job: Job) => {
    if (!job.tasks.length) return 0;
    const m = meanAi(job);
    return Math.sqrt(job.tasks.reduce((s, t) => s + (t.aiCapabilityScore - m) ** 2, 0) / job.tasks.length);
};

export const TaskSplitView: React.FC = () => {
    const jobs = useStore((s) => s.jobs);
    const selectedRoleIds = useStore((s) => s.selectedRoleIds);
    const setSelectedJob = useStore((s) => s.setSelectedJob);
    const isMobile = useIsMobile();

    // The app header is a transparent overlay, so a scroll container running the
    // full height sends rows sliding under the AI Scores badge and the
    // unemployment pill. Start the scroll area below the header instead, measured
    // rather than hard-coded: the header wraps to different heights by width.
    const [topInset, setTopInset] = useState(150);
    useEffect(() => {
        const measure = () => {
            const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
            setTopInset(Math.max(64, Math.round(header) + 14));
        };
        measure();
        const settle = setTimeout(measure, 400);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            clearTimeout(settle);
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

    // Same filter contract as MapView and the terrain: an empty set means "all".
    const scored = useMemo(() => {
        const withScores = jobs.filter((j) => j.tasks.some((t) => t.aiCapabilityScore > 0));
        return selectedRoleIds.size === 0 ? withScores : withScores.filter((j) => selectedRoleIds.has(j.id));
    }, [jobs, selectedRoleIds]);

    // Order is fixed at the default line so the bars change in place while the
    // slider moves, instead of re-sorting under the reader.
    const ordered = useMemo(
        () => [...scored].sort((a, b) => publishedRisk(a) - publishedRisk(b) || b.employment - a.employment),
        [scored],
    );

    const totals = useMemo(() => {
        let workers = 0;
        let aiWeighted = 0;
        for (const job of scored) {
            workers += job.employment;
            aiWeighted += job.employment * publishedRisk(job);
        }
        return { workers, aiPct: workers ? (aiWeighted / workers) * 100 : 0 };
    }, [scored]);

    // Two roles with the same headline but the most different task spread: the
    // case for showing tasks at all. Found in the data, not hand-picked.
    const contrast = useMemo(() => {
        let best: { a: Job; b: Job; gap: number } | null = null;
        for (let i = 0; i < scored.length; i++) {
            for (let j = i + 1; j < scored.length; j++) {
                const a = scored[i], b = scored[j];
                if (Math.round(meanAi(a) * 100) !== Math.round(meanAi(b) * 100)) continue;
                const gap = Math.abs(spreadAi(a) - spreadAi(b));
                if (!best || gap > best.gap) best = { a, b, gap };
            }
        }
        if (!best) return null;
        return spreadAi(best.a) >= spreadAi(best.b) ? [best.a, best.b] : [best.b, best.a];
    }, [scored]);

    const pct = (n: number) => Math.round(n);

    return (
        // Opaque ground, the same way MapView paints its own: without it the 3D
        // terrain and its 50 labels show straight through the text.
        <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 0%, #111b2b 0%, #0a0e17 70%)' }}
        >
          <div
            className="absolute inset-x-0 bottom-0 overflow-y-auto custom-scrollbar"
            style={{
                top: topInset,
                paddingLeft: isMobile ? undefined : MAP_SIDEBAR.CLEARANCE_PX,
                // Keeps the rows clear of the floating Sources pill, which sits
                // bottom-right in this view and would otherwise cover a role name.
                paddingRight: isMobile ? undefined : 230,
            }}
          >
            <div className="mx-auto w-full max-w-4xl px-5 md:px-8 pt-1 pb-28">

                <div className="flex flex-wrap items-center gap-2.5 mb-2">
                    <IconLayers size={16} className="text-cyan-400" />
                    <p className="text-[10px] uppercase tracking-widest text-cyan-400/90 font-semibold">
                        Task view
                    </p>
                    <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase tracking-widest">
                        Beta
                    </span>
                </div>
                <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">
                    What&rsquo;s left of the job
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed mt-2 max-w-2xl">
                    Every bar is the role&rsquo;s published automation risk, the same number its
                    role page shows: the average of its O*NET task ratings. Red is the share AI
                    can do, green is what still needs a person. Open any role to see the tasks
                    behind its number.
                </p>

                {/* Whole-group split */}
                <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
                    <IconAlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-[12px] text-amber-200/90 leading-relaxed">
                        <strong className="font-semibold text-amber-200">Experimental, still in testing.</strong>{' '}
                        This view is new and being verified role by role. Its figures come from the
                        same published set as the rest of the app, but treat it as a preview rather
                        than a finished part of the tool. The 3D map and role pages are unaffected.
                    </p>
                </div>

                <div className="mt-5 bg-gray-900/60 backdrop-blur-xl border border-cyan-400/25 rounded-2xl p-5 md:p-6 shadow-lg shadow-cyan-500/5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
                            {selectedRoleIds.size === 0 ? 'All ' : 'Filtered to '}{scored.length} role{scored.length === 1 ? '' : 's'} &middot;{' '}
                            {totals.workers.toLocaleString()} workers
                        </p>
                        <div className="flex items-center gap-4 text-[11px]">
                            <span className="flex items-center gap-1.5 text-gray-400">
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: AI }} /> AI can do
                            </span>
                            <span className="flex items-center gap-1.5 text-gray-400">
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: HUMAN }} /> Needs a person
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-0.5 h-6 mt-4">
                        <div
                            className="h-full rounded-l transition-[flex-basis] duration-300"
                            style={{ flexBasis: `${totals.aiPct}%`, background: AI }}
                        />
                        <div
                            className="h-full rounded-r transition-[flex-basis] duration-300"
                            style={{ flexBasis: `${100 - totals.aiPct}%`, background: HUMAN }}
                        />
                    </div>
                    <div className="flex justify-between mt-3">
                        <div>
                            <div className="text-2xl font-bold tabular-nums" style={{ color: AI }}>{pct(totals.aiPct)}%</div>
                            <div className="text-[11px] text-gray-500">AI can do</div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-bold tabular-nums" style={{ color: HUMAN }}>{pct(100 - totals.aiPct)}%</div>
                            <div className="text-[11px] text-gray-500">still needs a person</div>
                        </div>
                    </div>
                </div>

                {/* Role by role */}
                <div className="mt-8">
                    <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Role by role</h3>
                        <p className="text-[10px] uppercase tracking-widest text-gray-600 text-right leading-tight">
                            automation risk
                        </p>
                    </div>

                    <ul className="mt-3 space-y-1.5">
                        {ordered.map((job) => {
                            const risk = publishedRisk(job);
                            const aiPct = Math.round(risk * 100);
                            const exposed = job.tasks.filter((t) => t.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE).length;
                            return (
                                <li key={job.id}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedJob(job)}
                                        title={`${job.title} — ${job.employment.toLocaleString()} workers. Open the role.`}
                                        className="w-full grid grid-cols-[1fr_64px] md:grid-cols-[200px_1fr_64px] items-center gap-x-3 gap-y-1 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left min-h-[44px]"
                                    >
                                        <span className="text-[13px] text-gray-200 truncate">{job.title}</span>
                                        <span className="flex gap-0.5 h-3.5 col-span-2 md:col-span-1 order-last md:order-none">
                                            <span
                                                className="h-full rounded-l"
                                                style={{ flexBasis: `${aiPct}%`, background: AI }}
                                            />
                                            <span
                                                className="h-full rounded-r"
                                                style={{ flexBasis: `${100 - aiPct}%`, background: HUMAN }}
                                            />
                                        </span>
                                        <span
                                            className="text-[11px] text-right tabular-nums"
                                            title={`${exposed} of ${job.tasks.length} tasks are rated at or above ${RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE * 100}%`}
                                            style={{ color: AI }}
                                        >
                                            {aiPct}%
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* Why the average hides the job */}
                {contrast && (
                    <div className="mt-10">
                        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                            Why an average hides the job
                        </h3>
                        <p className="text-sm text-gray-400 leading-relaxed mt-2 max-w-2xl">
                            These two roles carry the same headline risk score,{' '}
                            {Math.round(meanAi(contrast[0]) * 100)}%. Their tasks look nothing alike,
                            which is the case for showing tasks rather than one number per role.
                        </p>
                        <div className="grid md:grid-cols-2 gap-5 mt-5">
                            {contrast.map((job) => (
                                <div key={job.id} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedJob(job)}
                                        className="text-left w-full flex items-center [@media(pointer:coarse)]:min-h-[44px]"
                                    >
                                        <p className="text-white font-semibold text-sm hover:text-cyan-300 transition-colors">
                                            {job.title}
                                        </p>
                                    </button>
                                    <p className="text-[11px] text-gray-500 mb-3 tabular-nums">
                                        {job.employment.toLocaleString()} workers &middot; tasks spanning{' '}
                                        {Math.round(Math.min(...job.tasks.map((t) => t.aiCapabilityScore)) * 100)}% to{' '}
                                        {Math.round(Math.max(...job.tasks.map((t) => t.aiCapabilityScore)) * 100)}%
                                    </p>
                                    <ul className="space-y-2.5">
                                        {[...job.tasks]
                                            .sort((a, b) => a.aiCapabilityScore - b.aiCapabilityScore)
                                            .map((task) => (
                                                <li key={task.name}>
                                                    <div className="flex items-baseline gap-2">
                                                        <span
                                                            className="text-[11px] font-mono tabular-nums shrink-0 w-9"
                                                            style={{ color: task.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE ? AI : HUMAN }}
                                                        >
                                                            {Math.round(task.aiCapabilityScore * 100)}%
                                                        </span>
                                                        <span className="text-[11.5px] text-gray-400 leading-snug">{task.name}</span>
                                                    </div>
                                                    <div className="h-1 rounded-full mt-1.5 ml-11" style={{
                                                        width: `${Math.round(task.aiCapabilityScore * 100)}%`,
                                                        background: task.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE ? AI : HUMAN,
                                                    }} />
                                                </li>
                                            ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <p className="mt-10 text-[11px] text-gray-600 leading-relaxed max-w-2xl">
                    Tasks from O*NET 30.1 and employment from BLS OEWS, the same sources the map uses.
                    The per-task AI ratings are Claude&rsquo;s published set, identical for every visitor.
                    The group figure is each role&rsquo;s published risk weighted by how many people work in it.
                </p>
            </div>
          </div>
        </div>
    );
};
