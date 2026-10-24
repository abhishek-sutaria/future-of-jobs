import React from 'react';
import { useWorldStore } from '../worldStore';
import { Z } from '../config/layers';
import { DATA_SOURCES, YEAR_MAX, YEAR_MIN } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { continentOf, INDEX_CONTINENT_BY_CODE, type OccupationEntry } from '../utils/occupationIndex';
import { blsEpGrowthPathPoints } from '../utils/terrainMath';
import { AI_SOON_TITLE, formatCount, formatGrowth, NO_TASKS_NOTE, WORKERS_NOTE } from '../utils/roleFormat';
import { payBaseNote } from '../utils/wages';
import { PayLine } from './RolePay';
import { ProvenanceBadge } from './ProvenanceBadge';
import { CloseButton } from './ui/CloseButton';
import { IconInfo, IconSparkles } from './ui/Icons';

/**
 * Role panel for a BLS occupation that has no AI scores yet (every occupation
 * outside the 50 Kelley roles). Same shell as JobDetailPanel, but only
 * published BLS / O*NET values: no score tiles, no Analyze, no Roadmap or
 * Scenario, and no Claude call of any kind.
 */
export const OccupationPanel: React.FC<{ soc: string; onClose: () => void }> = ({ soc, onClose }) => {
    const code = continentOf(soc);
    const file = useWorldStore((s) => s.continentFiles[code]);
    const error = useWorldStore((s) => s.continentErrors[code]);
    const loadContinent = useWorldStore((s) => s.loadContinent);

    React.useEffect(() => {
        if (!file) void loadContinent(code);
    }, [file, code, loadContinent]);

    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const occupation = file?.occupations[soc];

    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-2 md:p-8" style={{ zIndex: Z.detailPanel }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={onClose} aria-hidden="true" />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={occupation?.title ?? 'Occupation'}
                className="relative bg-gray-900/95 backdrop-blur-xl border border-cyan-400/20 shadow-2xl rounded-2xl w-full max-w-5xl h-auto max-h-[92vh] flex flex-col pointer-events-auto overflow-hidden"
            >
                {occupation ? (
                    <OccupationBody occupation={occupation} onClose={onClose} />
                ) : (
                    <div className="flex items-start justify-between gap-4 p-6">
                        <p className="text-sm text-gray-400" role="status">
                            {error ?? 'Loading this occupation…'}
                        </p>
                        <div className="flex items-center gap-2">
                            {error && (
                                <button
                                    type="button"
                                    onClick={() => void loadContinent(code)}
                                    className="px-3 py-2 min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold uppercase tracking-wider"
                                >
                                    Try again
                                </button>
                            )}
                            <CloseButton onClick={onClose} label="Close panel" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const OccupationBody: React.FC<{ occupation: OccupationEntry; onClose: () => void }> = ({ occupation: o, onClose }) => {
    const [showWorkersNote, setShowWorkersNote] = React.useState(false);
    const [showPayNote, setShowPayNote] = React.useState(false);
    const continent = INDEX_CONTINENT_BY_CODE.get(continentOf(o.soc));
    const ep = o.ep;
    const baseNote = payBaseNote(o.employment);

    return (
        <>
            <div className="flex-none px-4 py-3 md:px-6 md:py-4 border-b border-white/[0.06] flex justify-between items-start gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span
                            className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            title={continent?.title}
                        >
                            {CONTINENT_DISPLAY_NAMES[continentOf(o.soc)]}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">BLS {o.soc}</span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">{o.title}</h2>
                    <div className="flex items-start gap-1.5">
                        <PayLine entry={o} baseNote={baseNote} />
                        <button
                            type="button"
                            onClick={() => setShowPayNote((v) => !v)}
                            aria-expanded={showPayNote}
                            aria-label="Where the pay figure comes from"
                            title={baseNote}
                            className="mt-1 w-7 h-7 [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:h-9 -my-1 flex items-center justify-center rounded text-gray-500 hover:text-cyan-300"
                        >
                            <IconInfo size={12} />
                        </button>
                    </div>
                    {showPayNote && <p className="text-[11px] text-gray-400 mt-1">{baseNote}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2" aria-label="Data sources for this occupation">
                        {ep && <ProvenanceBadge label="EP" provenance="BLS_EP" />}
                        <ProvenanceBadge label="Pay" provenance="BLS_OES_WAGES" />
                        {o.description && <ProvenanceBadge label="O*NET" provenance="ONET" />}
                    </div>
                </div>
                <CloseButton onClick={onClose} label="Close panel" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 px-4 md:px-6 py-3 border-b border-white/[0.04]">
                    {/* Workers: BLS EP 2025, all workers including self-employed */}
                    <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06] min-w-0">
                        {ep ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setShowWorkersNote((v) => !v)}
                                    aria-expanded={showWorkersNote}
                                    title={WORKERS_NOTE}
                                    className="text-left flex items-baseline gap-1.5"
                                >
                                    <span className="text-lg max-md:text-base font-bold tabular-nums leading-tight text-white" data-testid="workers">
                                        {formatCount(ep.employment2025)} workers
                                    </span>
                                    <IconInfo size={11} className="text-gray-500 shrink-0" />
                                </button>
                                <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Workers, {YEAR_MIN}</p>
                                {showWorkersNote && <p className="text-[11px] text-gray-400 mt-1 leading-snug">{WORKERS_NOTE}</p>}
                            </>
                        ) : (
                            <p className="text-xs text-gray-500" title={o.nullReasons.ep}>BLS publishes no {YEAR_MIN} projection for this occupation.</p>
                        )}
                    </div>

                    {/* Growth: BLS EP percent change 2025–35, with its straight-line path */}
                    <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06] flex items-center gap-3 min-w-0">
                        {ep ? <GrowthTile pct={ep.percentChange} employment2035={ep.employment2035} /> : (
                            <p className="text-xs text-gray-500">No BLS projection.</p>
                        )}
                    </div>

                    {/* No AI scores yet: an honest state, never a placeholder number */}
                    <div className="col-span-2 md:col-span-1 rounded-xl px-3 py-2 border border-dashed border-slate-500/40 bg-slate-500/[0.05] min-w-0" data-testid="ai-soon">
                        <div className="flex items-center gap-1.5 text-slate-200 text-sm font-semibold">
                            <IconSparkles size={13} className="text-slate-400" /> {AI_SOON_TITLE}
                        </div>
                        <p className="text-[11px] text-gray-400 leading-snug mt-0.5">
                            AI ratings cover the 50 Kelley business roles for now. This occupation&rsquo;s tasks are not rated yet.
                        </p>
                    </div>
                </div>

                <div className="px-4 py-4 md:px-6 space-y-4">
                    {o.description && (
                        <section>
                            <h3 className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">What they do</h3>
                            <p className="text-sm text-gray-300 leading-relaxed" data-testid="description">{o.description}</p>
                        </section>
                    )}

                    <section>
                        <h3 className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
                            Day-to-day tasks <span className="normal-case tracking-normal text-gray-600">· O*NET 30.1</span>
                        </h3>
                        {o.tasks.length > 0 ? (
                            <ul className="space-y-1.5" data-testid="task-list">
                                {o.tasks.map((t) => (
                                    <li key={`${t.onetCode}-${t.id}`} className="flex items-start gap-2 text-sm text-gray-300 leading-snug">
                                        <span className="mt-1.5 w-1 h-1 rounded-full bg-cyan-400/70 shrink-0" aria-hidden="true" />
                                        <span className="min-w-0">
                                            <span data-testid="task-text">{t.text}</span>
                                            {t.type === 'Supplemental' && (
                                                <span className="ml-1.5 text-[9px] uppercase tracking-wider text-gray-500">Supplemental</span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-gray-400" data-testid="no-tasks">{NO_TASKS_NOTE}</p>
                        )}
                    </section>
                </div>
            </div>

            <div
                className="flex-none p-3 border-t border-white/[0.04] flex justify-end text-[10px] text-gray-600 font-mono uppercase tracking-wider"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
                <span>
                    Sources: {[ep && DATA_SOURCES.BLS_EP, DATA_SOURCES.BLS_OES_WAGES, o.description && DATA_SOURCES.ONET].filter(Boolean).join(', ')}
                </span>
            </div>
        </>
    );
};

const GrowthTile: React.FC<{ pct: number; employment2035: number }> = ({ pct, employment2035 }) => {
    const points = blsEpGrowthPathPoints(pct);
    const color = pct < 0 ? '#ef4444' : pct > 0 ? '#22c55e' : '#94a3b8';
    const lo = Math.min(0, ...points);
    const span = Math.max(0, ...points) - lo || 1;
    const y = (v: number) => 22 - ((v - lo) / span) * 20;
    return (
        <>
            <div className="min-w-0">
                <div className="text-lg font-bold tabular-nums leading-tight" style={{ color }} data-testid="growth">{formatGrowth(pct)}</div>
                <p className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Growth Outlook</p>
                <p className="text-[10px] text-gray-600">
                    BLS outlook, {YEAR_MIN}–{String(YEAR_MAX).slice(2)} · <span className="tabular-nums">{formatCount(employment2035)}</span> in {YEAR_MAX}
                </p>
            </div>
            <svg width="56" height="24" className="overflow-visible shrink-0 ml-auto max-md:hidden" aria-hidden="true">
                <line x1="0" y1={y(0)} x2="56" y2={y(0)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 2" />
                <polyline
                    fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    points={points.map((v, i) => `${i * (56 / (points.length - 1))},${y(v)}`).join(' ')}
                />
                <circle cx="56" cy={y(pct)} r="2.5" fill={color} />
            </svg>
        </>
    );
};
