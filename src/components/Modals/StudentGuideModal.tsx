import React from 'react';
import { Modal } from '../ui/Modal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

interface Feature {
    emoji: string;
    title: string;
    description: string;
    tip: string;
    color: string;
}

const FEATURES: Feature[] = [
    {
        emoji: '🏔️',
        title: '3D Terrain Map',
        description:
            'Each glowing peak represents one job role. Peak colour = AI automation risk (red = high risk, green = safe). Peak height depends on the mode: in Growth mode it reflects the projected employment change %; in Workers mode it reflects the implied BLS headcount at that year.',
        tip: 'Toggle the height mode with the switch on the year-slider panel. Workers mode shows which roles employ the most people right now; Growth mode shows where change is happening fastest.',
        color: 'cyan',
    },
    {
        emoji: '⏱️',
        title: 'AI Timeline Slider',
        description:
            'Drag the slider from 2025 → 2030 to simulate how AI displaces workers over time. Peaks fall faster for high-risk roles. The animation shows where the biggest structural changes are expected.',
        tip: 'Compare a Marketing Manager to a Sales Manager at 2030 — notice which peak drops faster and by how much.',
        color: 'purple',
    },
    {
        emoji: '📋',
        title: 'Job Detail Panel',
        description:
            'Click any peak to open a role\'s full profile: automation risk %, growth outlook to 2032, a list of its most human-critical tasks, and a BLS employment trend sparkline.',
        tip: 'The "Human Skills" section shows what AI cannot easily replace. These are the tasks worth developing.',
        color: 'blue',
    },
    {
        emoji: '🤖',
        title: 'AI Analysis (Analyze)',
        description:
            'Tap the Analyze button on any role. Claude AI reads the O*NET task list and scores each task individually for AI replaceability vs. human criticality — in real time, not from a pre-written database.',
        tip: 'Every score is freshly generated. The AI reasons about each specific task, so results reflect genuine capability assessment.',
        color: 'red',
    },
    {
        emoji: '🔮',
        title: 'Scenario Planning',
        description:
            'The Scenario button asks "what if" — what happens to this role if AI adoption accelerates, if regulation tightens, or if economic conditions shift? It generates a written strategic brief.',
        tip: 'Use this to stress-test career choices. Ask the same role under two different scenarios and compare the outlooks.',
        color: 'violet',
    },
    {
        emoji: '🗺️',
        title: 'Career Roadmap',
        description:
            'Identifies the highest-risk task in a role and builds a personalised 6-month upskilling plan to move away from it — covering specific skills, tools, and learning resources.',
        tip: 'Available from the Job Detail Panel after running an AI Analysis. The plan is tailored to that specific role\'s risk profile.',
        color: 'orange',
    },
    {
        emoji: '🎯',
        title: 'My Skills (CV Match)',
        description:
            'Paste your CV or a list of your skills. The app analyses which roles align with your strengths and flags where you are most exposed to automation risk.',
        tip: 'Honest input = honest output. List the skills you actually have, not the ones you wish you had.',
        color: 'emerald',
    },
    {
        emoji: '🗺️',
        title: 'US Map View',
        description:
            'Switch from the 3D terrain to a flat 2D US map. State colour and circle size both encode BLS employment volume — darker and larger means more workers in that state for the selected roles. Hover a state to see the exact BLS OEWS May 2025 employment count and Location Quotient (LQ) per occupation.',
        tip: 'Select specific roles using the role filter before opening the map to compare which states are most exposed for those jobs in particular.',
        color: 'teal',
    },
    {
        emoji: '📊',
        title: 'Job Security Index',
        description:
            'The colour legend on the right of the screen maps roles into three bands: High Automation Risk (red), Hybrid/Augmented (amber), and Safe Human-Centric (green). Bands are relative — graded on a curve across all 50 roles shown.',
        tip: 'A "green" role here means it is safer than most others in this dataset — not that it is completely immune to automation.',
        color: 'green',
    },
    {
        emoji: '📚',
        title: 'Data Sources',
        description:
            'Employment numbers come from the Bureau of Labor Statistics (BLS) Occupational Employment & Wage Statistics. Task descriptions are sourced from O*NET 30.1. AI risk scores are generated live by Anthropic Claude.',
        tip: 'Click "Methodology & Data" at the bottom of the screen to read the full sourcing and calculation methodology.',
        color: 'gray',
    },
];

const colorMap: Record<string, { border: string; badge: string; tip: string }> = {
    cyan:    { border: 'border-cyan-500/30',    badge: 'bg-cyan-500/10 text-cyan-300',    tip: 'bg-cyan-500/5 border-cyan-500/20 text-cyan-200/70' },
    purple:  { border: 'border-purple-500/30',  badge: 'bg-purple-500/10 text-purple-300', tip: 'bg-purple-500/5 border-purple-500/20 text-purple-200/70' },
    blue:    { border: 'border-blue-500/30',    badge: 'bg-blue-500/10 text-blue-300',    tip: 'bg-blue-500/5 border-blue-500/20 text-blue-200/70' },
    red:     { border: 'border-red-500/30',     badge: 'bg-red-500/10 text-red-300',      tip: 'bg-red-500/5 border-red-500/20 text-red-200/70' },
    violet:  { border: 'border-violet-500/30',  badge: 'bg-violet-500/10 text-violet-300', tip: 'bg-violet-500/5 border-violet-500/20 text-violet-200/70' },
    orange:  { border: 'border-orange-500/30',  badge: 'bg-orange-500/10 text-orange-300', tip: 'bg-orange-500/5 border-orange-500/20 text-orange-200/70' },
    emerald: { border: 'border-emerald-500/30', badge: 'bg-emerald-500/10 text-emerald-300', tip: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-200/70' },
    teal:    { border: 'border-teal-500/30',    badge: 'bg-teal-500/10 text-teal-300',    tip: 'bg-teal-500/5 border-teal-500/20 text-teal-200/70' },
    green:   { border: 'border-green-500/30',   badge: 'bg-green-500/10 text-green-300',  tip: 'bg-green-500/5 border-green-500/20 text-green-200/70' },
    gray:    { border: 'border-white/10',       badge: 'bg-white/5 text-gray-300',        tip: 'bg-white/[0.03] border-white/10 text-gray-400' },
};

export const StudentGuideModal: React.FC<Props> = ({ isOpen, onClose }) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Student Feature Guide"
            size="lg"
            layer="top"
            footer={
                <div className="flex items-center justify-between gap-4">
                    <p className="text-gray-500 text-[11px]">
                        futureofjobs.vercel.app &nbsp;·&nbsp; BLS OES, O*NET 30.1, Anthropic Claude
                    </p>
                    <div className="flex gap-2">
                        <a
                            href="/student-guide.pdf"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition-colors"
                        >
                            📄 Download PDF
                        </a>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white/[0.06] hover:bg-white/10 text-gray-300 text-sm font-semibold rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            }
        >
            {/* Print-only header */}
            <div className="hidden print:block mb-6 pb-4 border-b border-gray-300">
                <h1 className="text-2xl font-bold text-gray-900">AI & Future of Work — Feature Guide</h1>
                <p className="text-gray-600 text-sm mt-1">
                    futureofjobs.vercel.app &nbsp;·&nbsp; All data: BLS, O*NET 30.1, Anthropic Claude
                </p>
            </div>

            {/* Intro */}
            <div className="mb-5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] print:bg-gray-50 print:border-gray-200">
                <p className="text-gray-300 text-sm leading-relaxed print:text-gray-700">
                    This guide explains every feature of the <strong className="text-white print:text-gray-900">AI & Future of Work</strong> visualisation tool.
                    Each feature is designed to help you analyse how artificial intelligence is reshaping specific job roles — so you can make strategic decisions about your career or studies.
                </p>
            </div>

            {/* Feature grid */}
            <div className="space-y-3 print:space-y-4">
                {FEATURES.map((f, i) => {
                    const c = colorMap[f.color];
                    return (
                        <div
                            key={i}
                            data-print-card
                            className={`rounded-xl border ${c.border} bg-white/[0.02] p-4 print:border-gray-200 print:bg-white print:rounded-lg print:p-3`}
                        >
                            <div className="flex items-start gap-3">
                                {/* Number + emoji */}
                                <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-lg ${c.badge} print:bg-gray-100 print:text-gray-700`}>
                                    {f.emoji}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className={`text-[10px] font-bold uppercase tracking-widest ${c.badge} px-1.5 py-0.5 rounded print:bg-gray-200 print:text-gray-600`}>
                                            {String(i + 1).padStart(2, '0')}
                                        </span>
                                        <h3 className="text-white font-semibold text-sm print:text-gray-900">{f.title}</h3>
                                    </div>

                                    <p className="text-gray-400 text-sm leading-relaxed mb-2.5 print:text-gray-700">
                                        {f.description}
                                    </p>

                                    {/* Student tip */}
                                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${c.tip} print:bg-amber-50 print:border-amber-200`}>
                                        <span className="text-xs print:hidden">💡</span>
                                        <span className="text-[11px] leading-relaxed print:text-amber-800">
                                            <strong className="print:text-amber-900">Student tip: </strong>{f.tip}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

        </Modal>
    );
};
