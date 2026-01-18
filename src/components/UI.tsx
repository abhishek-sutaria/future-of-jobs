import React, { useState } from 'react';
import { useStore } from '../store';
import { TaskCompositionChart } from './charts/TaskCompositionChart';
import { ImpactMatrixChart } from './charts/ImpactMatrixChart';
import { IntroModal } from './IntroModal';
import { SkillsModal } from './SkillsModal';
import { MethodologyModal } from './MethodologyModal';
import { UpskillModal } from './UpskillModal';

export const UI: React.FC = () => {
    const year = useStore((state) => state.year);
    const setYear = useStore((state) => state.setYear);
    const selectedJob = useStore((state) => state.selectedJob);
    const setSelectedJob = useStore((state) => state.setSelectedJob);
    // const jobs = useStore((state) => state.jobs);
    const [showLegend, setShowLegend] = useState(false);
    const [showSkillsModal, setShowSkillsModal] = useState(false);
    const [showMethodologyModal, setShowMethodologyModal] = useState(false);

    // Upskill Modal State
    const [upskillTarget, setUpskillTarget] = useState<{ jobId: string, taskName: string } | null>(null);

    return (
        <>
            <IntroModal />
            <MethodologyModal isOpen={showMethodologyModal} onClose={() => setShowMethodologyModal(false)} />

            {upskillTarget && (
                <UpskillModal
                    isOpen={!!upskillTarget}
                    onClose={() => setUpskillTarget(null)}
                    jobId={upskillTarget.jobId}
                    taskName={upskillTarget.taskName}
                />
            )}

            {/* Top Navigation Bar - Glassmorphism */}
            <header className="absolute top-0 left-0 w-full px-4 md:px-8 py-4 md:py-5 z-20 flex flex-col md:flex-row justify-between items-start md:items-center pointer-events-none gap-4">
                {/* Branding Left */}
                <div className="flex flex-col">
                    <h1 className="text-xl md:text-3xl font-bold text-white tracking-wider flex items-center gap-2 md:gap-3 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">AI</span>
                        & FUTURE OF WORK
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e] animate-pulse"></div>
                        <p className="text-[10px] md:text-xs text-gray-400 font-medium tracking-[0.2em] uppercase">
                            Strategic Workforce Intelligence • 2025-2030
                        </p>
                    </div>
                </div>

                {/* Search Bar & Global Status */}
                {/* Search Bar & Global Status */}
                <div className="flex items-center gap-6 pointer-events-auto w-full md:w-auto relative z-50">

                    {/* Resume / Skills Button */}
                    <button
                        onClick={() => setShowSkillsModal(true)}
                        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-wider transition-all"
                    >
                        <span>⚡</span> My Skills
                    </button>

                    {/* Search Input */}
                    <div className="relative group w-full md:w-64">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <svg className="h-4 w-4 text-gray-400 group-focus-within:text-cyan-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Search jobs..."
                            className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-lg leading-5 bg-gray-900/50 text-gray-300 placeholder-gray-500 focus:outline-none focus:bg-gray-900/80 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 sm:text-sm backdrop-blur-md transition-all shadow-inner"
                            onChange={(e) => {
                                const val = e.target.value;
                                const list = document.getElementById('search-results-list');

                                // Simple local logic for now, could be state but this keeps it fast without re-renders for the whole UI
                                if (val.length > 1) {
                                    const matches = useStore.getState().jobs.filter(j => j.title.toLowerCase().includes(val.toLowerCase()));
                                    if (list) {
                                        if (matches.length > 0) {
                                            list.innerHTML = matches.map(j => `
                                                <div class="p-3 hover:bg-white/10 cursor-pointer flex justify-between items-center group transition-colors border-b border-white/5 last:border-0" data-id="${j.id}">
                                                    <span class="font-medium text-gray-200 group-hover:text-white transition-colors">${j.title}</span>
                                                    <span class="text-[10px] uppercase tracking-wider text-gray-500 px-1.5 py-0.5 rounded border border-white/5 bg-white/5">${j.cluster}</span>
                                                </div>
                                            `).join('');
                                            list.classList.remove('hidden');
                                        } else {
                                            list.innerHTML = `<div class="p-3 text-gray-500 text-xs italic text-center">No jobs found</div>`;
                                            list.classList.remove('hidden');
                                        }
                                    }
                                } else {
                                    list?.classList.add('hidden');
                                }
                            }}
                            onFocus={(e) => {
                                if (e.target.value.length > 1) {
                                    document.getElementById('search-results-list')?.classList.remove('hidden');
                                }
                            }}
                            onBlur={() => setTimeout(() => document.getElementById('search-results-list')?.classList.add('hidden'), 200)}
                        />
                        {/* Search Results Dropdown */}
                        <div
                            id="search-results-list"
                            className="hidden absolute mt-2 w-full bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] max-h-[300px] overflow-y-auto z-50 text-sm text-gray-300 ring-1 ring-white/5"
                            onClick={(e) => {
                                const target = (e.target as HTMLElement).closest('[data-id]');
                                if (target) {
                                    const id = target.getAttribute('data-id');
                                    if (id) {
                                        const job = useStore.getState().jobs.find(j => j.id === id);
                                        if (job) {
                                            setSelectedJob(job);
                                            // Clear input
                                            const input = document.querySelector('input[type="text"]') as HTMLInputElement;
                                            if (input) input.value = '';
                                        }
                                        document.getElementById('search-results-list')?.classList.add('hidden');
                                    }
                                }
                            }}
                        ></div>
                    </div>

                    <div className="hidden md:block text-right pointer-events-none">
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Global Status</p>
                        <p className="text-xs text-cyan-400 font-mono">ONLINE // TRACKING</p>
                    </div>
                </div>
            </header>

            {/* Selected Job Overlay - Command Center Dashboard */}
            {selectedJob && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[200] p-2 md:p-8">
                    <div className="bg-gray-900/95 backdrop-blur-2xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)] rounded-2xl md:rounded-3xl w-full max-w-6xl h-full md:h-[90vh] flex flex-col pointer-events-auto overflow-hidden ring-1 ring-white/5">

                        {/* 1. Dashboard Header */}
                        <div className="flex-none p-4 md:p-6 border-b border-white/10 bg-gradient-to-r from-gray-900 to-gray-800 flex justify-between items-start">
                            <div>
                                <div className="flex items-center gap-2 md:gap-3 mb-1">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                        {selectedJob.cluster} Cluster
                                    </span>
                                    <span className="text-xs text-gray-400 font-mono">ID: {selectedJob.id.slice(0, 8)}</span>
                                </div>
                                <h2 className="text-xl md:text-3xl font-bold text-white tracking-tight leading-tight">{selectedJob.title}</h2>
                            </div>
                            <button
                                onClick={() => setSelectedJob(null)}
                                className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all border border-white/5"
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                        </div>

                        {/* 2. Key Metrics Row (Executive Summary) - Scrollable on Mobile */}
                        <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-3 p-4 md:p-6 bg-gray-900/50 border-b border-white/5 overflow-x-auto">
                            {/* Metric 1: Automation Risk */}
                            {(() => {
                                const job = useStore.getState().jobs.find(j => j.id === selectedJob.id) || selectedJob;
                                const risk = job.automationCostIndex; // Mock use of index for risk display
                                const riskColor = risk > 0.6 ? 'text-red-400' : (risk > 0.3 ? 'text-yellow-400' : 'text-green-400');
                                return (
                                    <div className="bg-white/5 rounded-xl p-3 md:p-4 border border-white/5 min-w-[140px] group relative cursor-help">
                                        <div className='flex justify-between items-center'>
                                            <p className="text-[10px] uppercase text-gray-400 font-bold tracking-wider mb-1">Automation Risk</p>
                                            <span className="text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">ℹ️ Method</span>
                                        </div>
                                        <div className={`text-xl md:text-2xl font-bold ${riskColor}`}>
                                            {(risk * 100).toFixed(0)}%
                                        </div>
                                        <div className="w-full h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                                            <div className="h-full bg-current opacity-80" style={{ width: `${risk * 100}%` }}></div>
                                        </div>
                                        {/* Tooltip hint handled by global methodology modal */}
                                    </div>
                                )
                            })()}

                            {/* Metric 2: 2030 Employment */}
                            <div className="bg-white/5 rounded-xl p-3 md:p-4 border border-white/5 min-w-[140px]">
                                <p className="text-[10px] uppercase text-gray-400 font-bold tracking-wider mb-1">Proj. Employment</p>
                                <div className="text-xl md:text-2xl font-bold text-white">
                                    {(selectedJob.employment * 1.05).toLocaleString()}
                                </div>
                                <p className={`text-xs mt-1 flex items-center gap-1 ${selectedJob.projectedGrowth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    <span>{selectedJob.projectedGrowth >= 0 ? '▲' : '▼'}</span> {Math.abs(selectedJob.projectedGrowth)}% Growth
                                </p>
                            </div>

                            {/* Metric 3: Human Resilience */}
                            <div className="bg-white/5 rounded-xl p-3 md:p-4 border border-white/5 min-w-[140px]">
                                <p className="text-[10px] uppercase text-gray-400 font-bold tracking-wider mb-1">Human Resilience</p>
                                <div className={`text-xl md:text-2xl font-bold ${selectedJob.humanResilienceLabel === 'Critical' || selectedJob.humanResilienceLabel === 'Very High' ? 'text-green-400' : selectedJob.humanResilienceLabel === 'High' ? 'text-cyan-400' : 'text-yellow-400'}`}>
                                    {selectedJob.humanResilienceLabel}
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">Social Intel Priority</p>
                            </div>

                            {/* Metric 4: Salary Impact */}
                            <div className="bg-white/5 rounded-xl p-3 md:p-4 border border-white/5 min-w-[140px]">
                                <p className="text-[10px] uppercase text-gray-400 font-bold tracking-wider mb-1">Salary Volatility</p>
                                <div className={`text-xl md:text-2xl font-bold ${selectedJob.salaryVolatilityLabel === 'High' || selectedJob.salaryVolatilityLabel === 'Very High' ? 'text-red-400' : selectedJob.salaryVolatilityLabel === 'Medium' ? 'text-yellow-400' : 'text-green-400'}`}>
                                    {selectedJob.salaryVolatilityLabel}
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">Dependent on upskilling</p>
                            </div>
                        </div>

                        {/* 3. Main Content Grid - Stack on mobile, grid on desktop */}
                        <div className="flex-1 overflow-hidden flex flex-col lg:grid lg:grid-cols-12 overflow-y-auto lg:overflow-y-hidden">

                            {/* Left Col: Visual Insights (Charts) - Span 5 */}
                            <div className="lg:col-span-5 p-4 md:p-6 space-y-6 md:overflow-y-auto lg:border-r border-white/5 shrink-0">
                                {/* Chart 1: Composition */}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-baseline">
                                        <h3 className="text-sm font-bold text-white">Task Composition Forecast</h3>
                                        <span className="text-xs text-gray-500">{year.toFixed(1)}</span>
                                    </div>
                                    <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                                        <TaskCompositionChart tasks={selectedJob.tasks} year={year} />
                                    </div>
                                    <p className="text-xs text-gray-400 leading-relaxed px-1">
                                        Routine tasks are rapidly declining. The role is shifting towards
                                        <span className="text-cyan-400"> creative & strategic</span> responsibilities.
                                    </p>
                                </div>

                                {/* Chart 2: Matrix */}
                                <div className="space-y-2">
                                    <h3 className="text-sm font-bold text-white">AI vs. Human Impact Matrix</h3>
                                    <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                                        <ImpactMatrixChart tasks={selectedJob.tasks} year={year} />
                                    </div>
                                </div>
                            </div>

                            {/* Right Col: Detailed Task List - Span 7 */}
                            <div className="lg:col-span-7 bg-gray-800/20 flex flex-col h-full overflow-hidden shrink-0 min-h-[400px]">
                                <div className="p-4 border-b border-t lg:border-t-0 border-white/5 bg-white/5 flex justify-between items-center sticky top-0 bg-gray-900/90 backdrop-blur z-10">
                                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Skill Durability Scorecard</h3>
                                    <span className="text-xs text-gray-400">{selectedJob.tasks.length} Capabilities</span>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                    {selectedJob.tasks.map((task, i) => {
                                        const isSafe = task.humanCriticalityScore > 0.6;
                                        const isRisk = task.aiCapabilityScore > 0.7 && !isSafe;

                                        return (
                                            <div key={i} className="group relative bg-white/5 hover:bg-white/10 rounded-lg p-3 border border-white/5 hover:border-white/20 transition-all">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-6 h-6 rounded flex items-center justify-center text-xs ${isSafe ? 'bg-green-500/20 text-green-400' : isRisk ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                            {isSafe ? '🛡️' : isRisk ? '⚠️' : '⚡'}
                                                        </div>
                                                        <span className="text-sm font-medium text-gray-200">{task.name}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => setUpskillTarget({ jobId: selectedJob.id, taskName: task.name })}
                                                        className="opacity-0 group-hover:opacity-100 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold uppercase rounded transition-opacity"
                                                    >
                                                        Upskill
                                                    </button>
                                                </div>

                                                {/* Micro Charts */}
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                                                            <span>Automation Risk</span>
                                                            <span>{(task.aiCapabilityScore * 100).toFixed(0)}%</span>
                                                        </div>
                                                        <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                                                            <div className="h-full bg-red-400" style={{ width: `${task.aiCapabilityScore * 100}%` }}></div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                                                            <span>Human Value</span>
                                                            <span>{(task.humanCriticalityScore * 100).toFixed(0)}%</span>
                                                        </div>
                                                        <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                                                            <div className="h-full bg-green-400" style={{ width: `${task.humanCriticalityScore * 100}%` }}></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            )}

            {/* Glassmorphism Timeline Slider */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 w-[90%] max-w-2xl pointer-events-auto z-10">
                <div className="bg-gray-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-6 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                    <div className="flex justify-between items-center mb-4 text-sm font-medium tracking-widest">
                        <span className="text-gray-400">2025</span>
                        <span className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] text-xl">Year: {year.toFixed(1)}</span>
                        <span className="text-gray-400">2030</span>
                    </div>

                    <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                        {/* Neon Progress Bar */}
                        <div
                            className="absolute top-0 left-0 h-full bg-cyan-500 shadow-[0_0_15px_#06b6d4]"
                            style={{ width: `${((year - 2025) / 5) * 100}%` }}
                        />
                    </div>

                    <input
                        type="range"
                        min="2025"
                        max="2030"
                        step="0.1"
                        value={year}
                        onChange={(e) => setYear(parseFloat(e.target.value))}
                        className="absolute inset-x-6 top-14 opacity-0 cursor-pointer h-8 w-full"
                    />

                    <style>{`
                        input[type=range] {
                            top: 3.5rem; 
                            left: 0;
                            padding: 0 1.5rem;
                        }
                     `}</style>
                </div>
            </div>

            {/* Collapsible Mobile Legend */}
            <div className={`absolute bottom-32 right-4 md:right-8 pointer-events-auto z-10 transition-all duration-300 ${showLegend ? 'w-48' : 'w-10 md:w-48'}`}>
                <button
                    onClick={() => setShowLegend(!showLegend)}
                    className="md:hidden w-10 h-10 rounded-full bg-black/60 backdrop-blur border border-white/10 text-white flex items-center justify-center mb-2 shadow-lg"
                >
                    {showLegend ? '✕' : 'ℹ️'}
                </button>

                <div className={`${showLegend ? 'block' : 'hidden md:block'} bg-black/40 backdrop-blur-md rounded-xl p-4 md:p-5 border border-white/5 shadow-2xl`}>
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 border-b border-white/5 pb-2">Risk Impact</h4>
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                            <span className="text-xs text-gray-300 font-medium">High Automation Risk</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="w-2 h-2 rounded-full bg-yellow-500/80 shadow-[0_0_8px_rgba(234,179,8,0.4)]"></span>
                            <span className="text-xs text-gray-400">Transitioning</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="w-2 h-2 rounded-full bg-green-500/80 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
                            <span className="text-xs text-gray-300 font-medium">Augmented & Safe</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Citations / Academic Rigor Footer */}
            <div className="absolute bottom-4 right-4 md:right-8 z-10 pointer-events-none md:pointer-events-auto flex justify-end">
                <button
                    onClick={() => setShowMethodologyModal(true)}
                    className="bg-black/20 backdrop-blur-sm border border-white/5 rounded-full px-4 py-1.5 flex items-center gap-3 text-[10px] text-gray-500 hover:text-white hover:bg-black/50 hover:border-cyan-500/30 transition-all cursor-pointer group"
                >
                    <span className="uppercase tracking-wider font-bold opacity-70">Sources:</span>
                    <span className="group-hover:text-cyan-400 transition-colors">See Methodology & Data (GDPval, Iceberg, BLS)</span>
                </button>
            </div>

            <SkillsModal isOpen={showSkillsModal} onClose={() => setShowSkillsModal(false)} />
        </>
    );
};
