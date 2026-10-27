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
            'The map is one landscape split into 22 fields: the BLS major occupation groups, from Arts & Media to Healthcare and Construction. A field\'s area is its share of all U.S. workers in 2025 (BLS Employment Projections, self-employed included). The fields are grouped by the five official BLS job families, outlined on the map: area is workers, while positions within a family follow BLS code order, so where a field sits and its shape are only layout. Each peak is one occupation, and its height is its number of jobs from BLS Employment Projections. Zoomed into a field, heights are rescaled within that field (its largest occupation is full height), so compare them within the field.',
        tip: 'Click a field, or pick it from the Fields list, to zoom in on its occupations. The largest are labelled; hover or tap any other peak for its name.',
        color: 'cyan',
    },
    {
        emoji: '⏱️',
        title: 'AI Timeline Slider',
        description:
            'Drag the slider from 2025 → 2035 to watch each occupation\'s BLS Employment Projections job count year by year. Height moves in a straight line between the official 2025 and 2035 employment levels — no AI forecast on the landscape.',
        tip: 'Compare Registered Nurses with Retail Salespersons at 2035. Notice which peak grows and which shrinks, then open both to compare.',
        color: 'purple',
    },
    {
        emoji: '🎓',
        title: 'Fields & Kelley Roles',
        description:
            'AI scores currently cover the 50 Kelley business roles. Turn on Kelley roles to highlight just those 50, with their risk colours, as the map showed them before. Every other occupation is drawn in slate: its AI scores are coming soon, and nothing is shown in their place.',
        tip: 'Search any job title in the header: all 830 BLS occupations are there, from Actors to Electricians.',
        color: 'orange',
    },
    {
        emoji: '📋',
        title: 'Job Detail Panel',
        description:
            'Click any peak to open its panel: what the job involves (O*NET), how many people do it (BLS Employment Projections, 2025, self-employed included), median pay (BLS OEWS, payroll employees only), the BLS 2025–35 growth outlook, and its day-to-day O*NET tasks. For the 50 Kelley roles the panel also shows Automation Risk, Human Criticality and Human Resilience, with a risk score on every task. Automation Risk is the plain average of those task scores, so you can check it yourself.',
        tip: 'Two worker counts are normal: pay comes from payroll employees only, while "workers" counts everyone, self-employed included. Scores measure GenAI capability, not guaranteed adoption.',
        color: 'blue',
    },
    {
        emoji: '🧩',
        title: 'Tasks View',
        description:
            'Open Tasks in the header to see each Kelley role broken into AI-capable vs human-needed work (the other occupations join once their scores arrive). Roles are ordered by average GenAI capability today — not guaranteed adoption. Use “Same score, different jobs” pairs to make the contrast concrete.',
        tip: 'Capability labels are Claude judgments of what GenAI can handle, not a forecast that the work is already automated.',
        color: 'indigo',
    },
    {
        emoji: '🤖',
        title: 'AI Analysis',
        description:
            'Open any of the 50 Kelley roles and Claude explains its published scores right in the panel: the reasoning under each task, a strategic insight for the role, and the likely replacements and human traits it calls for. The analysis adds the explanation; it never changes the numbers. Occupations without published scores have no analysis yet.',
        tip: 'Every student sees the same published scores for a role, dated in the header badge, so you can compare notes. The analysis is where you get the why behind them.',
        color: 'red',
    },
    {
        emoji: '🔮',
        title: 'Scenario Planning',
        description:
            'On a Kelley role, the Scenario button asks "what if": what happens to this role if AI adoption accelerates, if regulation tightens, or if economic conditions shift? It generates a written strategic brief.',
        tip: 'Use this to stress-test career choices. Ask the same role under two different scenarios and compare the outlooks.',
        color: 'violet',
    },
    {
        emoji: '🗺️',
        title: 'Career Roadmap',
        description:
            'On a Kelley role, identifies the highest-risk task and builds a personalised 6-month plan to defend it — own the judgment and oversight around the automatable work — while deepening a human-critical task. Covers skills, tools, and learning resources.',
        tip: 'Open it with the Roadmap button on the role panel. Defend = supervise the high-risk task; Build = deepen the human-critical one.',
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
            'Switch from the 3D terrain to a flat 2D US map of the 50 Kelley roles (state data for other occupations is not in the app yet). State colour and circle size both encode BLS employment volume: darker and larger means more workers in that state for the selected roles. Hover a state to see the exact BLS OEWS May 2025 employment count and Location Quotient (LQ) per occupation.',
        tip: 'Select specific roles using the role filter before opening the map to compare which states are most exposed for those jobs in particular.',
        color: 'teal',
    },
    {
        emoji: '📊',
        title: 'Job Security Index',
        description:
            'The colour legend at the bottom right of the screen maps the scored roles into three bands: High Automation Risk (red), Hybrid/Augmented (amber), and Safe Human-Centric (green). Bands are relative, graded on a curve across the 50 Kelley roles. Slate peaks are occupations with no AI scores yet.',
        tip: 'A "green" role here means it is safer than most others in this dataset, not that it is completely immune to automation.',
        color: 'green',
    },
    {
        emoji: '📚',
        title: 'Data Sources',
        description:
            'Workers in each occupation and each field come from the BLS Employment Projections 2025–35, which count everyone, self-employed included; growth outlooks come from the same projections. Pay comes from the BLS Occupational Employment & Wage Statistics (OEWS, May 2025), which covers payroll employees only. Task descriptions are from O*NET 30.1. AI risk scores are Claude\'s ratings of each O*NET task for the 50 Kelley roles, published with the app as one dated set, so every student sees the same numbers; scores for the other occupations are coming soon.',
        tip: 'Click "Sources" at the bottom of the screen to read the full sourcing and calculation methodology.',
        color: 'gray',
    },
];

const colorMap: Record<string, { border: string; badge: string; tip: string }> = {
    cyan:    { border: 'border-cyan-500/30',    badge: 'bg-cyan-500/10 text-cyan-300',    tip: 'bg-cyan-500/5 border-cyan-500/20 text-cyan-200/70' },
    purple:  { border: 'border-purple-500/30',  badge: 'bg-purple-500/10 text-purple-300', tip: 'bg-purple-500/5 border-purple-500/20 text-purple-200/70' },
    blue:    { border: 'border-blue-500/30',    badge: 'bg-blue-500/10 text-blue-300',    tip: 'bg-blue-500/5 border-blue-500/20 text-blue-200/70' },
    indigo:  { border: 'border-indigo-500/30',  badge: 'bg-indigo-500/10 text-indigo-300', tip: 'bg-indigo-500/5 border-indigo-500/20 text-indigo-200/70' },
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
                        futureofjobs.vercel.app &nbsp;·&nbsp; BLS EP &amp; OEWS, O*NET 30.1, Anthropic Claude
                    </p>
                    <a
                        href="/student-guide.pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                        📄 Download PDF
                    </a>
                </div>
            }
        >
            {/* Print-only header */}
            <div className="hidden print:block mb-6 pb-4 border-b border-gray-300">
                <h1 className="text-2xl font-bold text-gray-900">AI & Future of Work: Feature Guide</h1>
                <p className="text-gray-600 text-sm mt-1">
                    futureofjobs.vercel.app &nbsp;·&nbsp; All data: BLS EP &amp; OEWS, O*NET 30.1, Anthropic Claude
                </p>
            </div>

            {/* Intro */}
            <div className="mb-5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] print:bg-gray-50 print:border-gray-200">
                <p className="text-gray-300 text-sm leading-relaxed print:text-gray-700">
                    This guide explains every feature of the <strong className="text-white print:text-gray-900">AI & Future of Work</strong> visualisation tool.
                    It covers all 830 BLS occupations, in every field, to help you analyse how artificial intelligence is reshaping work, so you can make strategic decisions about your career or studies.
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
