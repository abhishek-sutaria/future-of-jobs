import React, { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { IS_DEMO_MODE } from '../utils/analysis';
import { clearScoreCache } from '../utils/taskScoring';
import { IconZap, IconGlobe, IconMap, IconSearch, IconInfo, IconKey } from './ui/Icons';
import { Z } from '../config/layers';
import { YEAR_MIN, YEAR_MAX, UI } from '../config/constants';
import type { Job } from '../types';

interface HeaderProps {
    economyData: { value: string; period: string; color: string } | null;
    loadingEconomy: boolean;
    onOpenSkillsModal: () => void;
    onStartTour: () => void;
}

export const Header: React.FC<HeaderProps> = ({ economyData, loadingEconomy, onOpenSkillsModal, onStartTour }) => {
    const mapView = useStore((state) => state.mapView);
    const setMapView = useStore((state) => state.setMapView);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    const isScoring = useStore((state) => state.isScoring);
    const hasAIScores = useStore((state) => state.hasAIScores);
    const scoreAllJobsWithAI = useStore((state) => state.scoreAllJobsWithAI);
    const openClaudeKeyModal = useStore((state) => state.openClaudeKeyModal);
    const startupAnalysisState = useStore((state) => state.startupAnalysisState);
    const startupGateActive = startupAnalysisState === 'loading' || startupAnalysisState === 'done';

    return (
        <header className="absolute top-0 left-0 w-full px-5 md:px-8 py-4 md:py-5 flex flex-col md:flex-row justify-between items-start md:items-center pointer-events-none gap-4" style={{ zIndex: Z.header }}>
            <div className="flex flex-col ml-0" style={{ marginLeft: mapView === 'map' ? '21rem' : 0 }}>
                <h1 className="text-lg md:text-xl font-semibold text-white tracking-wide flex items-center gap-2.5">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300 font-bold">AI</span>
                    <span className="text-white/80 font-light">&</span>
                    <span>Future of Work</span>
                </h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <p className="text-[10px] md:text-xs text-gray-500 font-medium tracking-widest uppercase">
                            Workforce Intel {YEAR_MIN}–{YEAR_MAX}
                        </p>
                    </div>

                    {IS_DEMO_MODE && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-bold uppercase tracking-wider pointer-events-auto">
                            Demo Mode
                        </span>
                    )}

                    {!IS_DEMO_MODE && !startupGateActive && isScoring && (
                        <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400 font-semibold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            Scoring tasks with AI...
                        </span>
                    )}

                    {!IS_DEMO_MODE && !startupGateActive && !isScoring && hasAIScores && (
                        <span
                            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider pointer-events-auto cursor-pointer hover:bg-emerald-500/20 transition-colors"
                            title="Click to re-score tasks with fresh Claude data"
                            onClick={() => { clearScoreCache(); scoreAllJobsWithAI(); }}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            AI Scores Live
                        </span>
                    )}

                    {(economyData || loadingEconomy) && (
                        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] pointer-events-auto" title="Live Data from Bureau of Labor Statistics">
                            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">US Unemployment</span>
                            {loadingEconomy ? (
                                <span className="text-[10px] text-gray-400 animate-pulse">Loading...</span>
                            ) : (
                                <>
                                    <span className={`text-xs font-mono font-bold ${economyData?.color}`}>{economyData?.value}</span>
                                    <span className="text-[9px] text-gray-600">({economyData?.period})</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 md:gap-3 pointer-events-auto min-w-0 max-w-full flex-wrap md:flex-nowrap justify-end">
                <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto max-w-[100vw] md:max-w-none py-0.5 [scrollbar-width:thin] shrink min-w-0">
                    <button
                        data-tour="tour-skills"
                        onClick={onOpenSkillsModal}
                        className="hidden md:flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] hover:bg-cyan-500/15 text-cyan-400 text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px]"
                    >
                        <IconZap size={14} /> My Skills
                    </button>
                    {!IS_DEMO_MODE && (
                        <button
                            type="button"
                            onClick={openClaudeKeyModal}
                            title="Claude API key — change or switch default vs. your key"
                            className="hidden md:flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] hover:bg-cyan-500/15 text-cyan-400 text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px]"
                        >
                            <IconKey size={14} /> Claude API
                        </button>
                    )}

                    <button
                        data-tour="tour-toggle"
                        onClick={() => setMapView(mapView === 'map' ? 'globe' : 'map')}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] hover:bg-blue-500/15 text-blue-400 text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px]"
                    >
                        {mapView === 'map' ? <IconGlobe size={14} /> : <IconMap size={14} />}
                        {mapView === 'map' ? 'Globe' : 'Map'}
                    </button>

                    <button
                        onClick={onStartTour}
                        title="Take a guided tour"
                        className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-gray-500 hover:text-white transition-colors min-h-[44px] min-w-[44px]"
                    >
                        <IconInfo size={15} />
                    </button>
                </div>

                <div data-tour="tour-search">
                    <SearchBar onSelectJob={(job) => setSelectedJob(job)} />
                </div>
            </div>
        </header>
    );
};

const SearchBar: React.FC<{ onSelectJob: (job: Job) => void }> = ({ onSelectJob }) => {
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<Job[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const handleChange = useCallback((val: string) => {
        setQuery(val);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (val.length > 1) {
                const jobs = useStore.getState().jobs;
                const filtered = jobs.filter(j => j.title.toLowerCase().includes(val.toLowerCase()));
                setMatches(filtered);
                setIsOpen(true);
            } else {
                setIsOpen(false);
                setMatches([]);
            }
        }, UI.SEARCH_DEBOUNCE_MS);
    }, []);

    const handleSelect = useCallback((job: Job) => {
        onSelectJob(job);
        setQuery('');
        setIsOpen(false);
        setMatches([]);
    }, [onSelectJob]);

    return (
        <div className="relative w-full md:w-[280px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <IconSearch size={14} className="text-gray-500" />
            </div>
            <input
                type="text"
                placeholder="Search jobs..."
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                onFocus={() => { if (query.length > 1) setIsOpen(true); }}
                onBlur={() => setTimeout(() => setIsOpen(false), UI.SEARCH_DEBOUNCE_MS)}
                aria-label="Search jobs"
                className="block w-full pl-9 pr-3 py-2.5 border border-white/[0.06] rounded-lg bg-white/[0.03] text-gray-300 placeholder-gray-600 focus:outline-none focus:bg-white/[0.06] focus:border-white/15 focus:ring-1 focus:ring-white/10 text-sm transition-all min-h-[44px]"
            />
            {isOpen && matches.length > 0 && (
                <div className="absolute mt-2 w-full bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl max-h-[300px] overflow-y-auto text-sm custom-scrollbar" style={{ zIndex: Z.sidebar }}>
                    {matches.map(j => (
                        <div
                            key={j.id}
                            className="px-3 py-3 hover:bg-white/[0.06] cursor-pointer flex justify-between items-center transition-colors border-b border-white/[0.04] last:border-0"
                            onMouseDown={() => handleSelect(j)}
                        >
                            <span className="font-medium text-gray-200 text-sm">{j.title}</span>
                            <span className="text-[10px] uppercase tracking-wider text-gray-500 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">{j.cluster}</span>
                        </div>
                    ))}
                </div>
            )}
            {isOpen && query.length > 1 && matches.length === 0 && (
                <div className="absolute mt-2 w-full bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3 text-gray-500 text-xs text-center" style={{ zIndex: Z.sidebar }}>
                    No jobs found
                </div>
            )}
        </div>
    );
};
