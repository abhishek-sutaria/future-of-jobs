import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import {
    IconUpload,
    IconAlertTriangle,
    IconSparkles,
    IconTarget,
    IconTrendingUp,
    IconChevronDown,
    IconCheck,
    IconArrowRight,
    IconRocket,
} from './ui/Icons';
import { Skeleton } from './ui/Skeleton';
import { toast } from './ui/Toast';
import { useResumeInput } from '../hooks/useResumeInput';
import { getClaudeUserFriendlyMessage, type StartupIdeasResult, type StartupIdea } from '../utils/analysis';

interface StartupIdeasModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const RECOMMENDATION_STYLES: Record<string, string> = {
    pursue: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    test: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    avoid: 'bg-red-500/10 text-red-300 border-red-500/30',
};

function recommendationClass(rec: string): string {
    return RECOMMENDATION_STYLES[rec.trim().toLowerCase()] || 'bg-white/[0.05] text-gray-300 border-white/10';
}

const ScoreBar: React.FC<{ label: string; score: number; color: string }> = ({ label, score, color }) => (
    <div className="flex-1 min-w-[80px]">
        <div className="flex justify-between items-baseline mb-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
            <span className="text-xs font-bold text-white tabular-nums">{score}/10</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%` }} />
        </div>
    </div>
);

const Chips: React.FC<{ items: string[]; className: string }> = ({ items, className }) => (
    <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
            <span key={i} className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${className}`}>
                {item}
            </span>
        ))}
    </div>
);

const DetailRow: React.FC<{ label: string; value?: string }> = ({ label, value }) =>
    value ? (
        <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
            <p className="text-sm text-gray-300 leading-relaxed">{value}</p>
        </div>
    ) : null;

const IdeaCard: React.FC<{ idea: StartupIdea; rank: number }> = ({ idea, rank }) => {
    const [expanded, setExpanded] = useState(rank === 1);
    return (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/[0.03] transition-colors"
                aria-expanded={expanded}
            >
                <span className="shrink-0 w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold flex items-center justify-center mt-0.5">
                    {rank}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-white">{idea.name}</h4>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${recommendationClass(idea.recommendation)}`}>
                            {idea.recommendation}
                        </span>
                    </div>
                    {idea.summary && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{idea.summary}</p>}
                    <div className="flex flex-wrap gap-3 mt-3">
                        <ScoreBar label="Fit" score={idea.resumeFitScore} color="bg-emerald-400" />
                        <ScoreBar label="Revenue" score={idea.revenuePotentialScore} color="bg-cyan-400" />
                        <ScoreBar label="Difficulty" score={idea.difficultyScore} color="bg-amber-400" />
                    </div>
                </div>
                <IconChevronDown
                    size={18}
                    className={`text-gray-500 shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-1 space-y-4 border-t border-white/[0.06] animate-in fade-in duration-200">
                    <div className="grid md:grid-cols-2 gap-4 pt-3">
                        <DetailRow label="Customer" value={idea.customer} />
                        <DetailRow label="Painful problem" value={idea.problem} />
                        <DetailRow label="Why now" value={idea.whyNow} />
                        <DetailRow label="Why AI" value={idea.whyAI} />
                    </div>

                    <div className="p-3 rounded-lg bg-cyan-500/[0.04] border border-cyan-500/15">
                        <DetailRow label="Why you're a fit" value={idea.whyYou} />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        {idea.applicableSkills.length > 0 && (
                            <div>
                                <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1.5">Skills that apply</p>
                                <Chips items={idea.applicableSkills} className="bg-emerald-500/[0.06] text-emerald-300 border-emerald-500/20" />
                            </div>
                        )}
                        {idea.skillsNeeded.length > 0 && (
                            <div>
                                <p className="text-[10px] text-amber-400 uppercase tracking-wider mb-1.5">Skills still needed</p>
                                <Chips items={idea.skillsNeeded} className="bg-amber-500/[0.06] text-amber-300 border-amber-500/20" />
                            </div>
                        )}
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <DetailRow label="MVP plan" value={idea.mvpPlan} />
                        <DetailRow label="First paying customer" value={idea.firstCustomerPath} />
                        <DetailRow label="Pricing model" value={idea.pricingModel} />
                        <DetailRow label="Validate in 7-14 days" value={idea.validation} />
                        <DetailRow label="Path to $10k MRR" value={idea.pathTo10kMrr} />
                        <DetailRow label="Path to $1M+" value={idea.pathToScale} />
                    </div>

                    {idea.risks.length > 0 && (
                        <div>
                            <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1.5">Main risks</p>
                            <ul className="space-y-1">
                                {idea.risks.map((risk, i) => (
                                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                                        <span className="text-red-500 mt-0.5 shrink-0 text-xs font-bold">!</span> {risk}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const StartupIdeasModal: React.FC<StartupIdeasModalProps> = ({ isOpen, onClose }) => {
    const { resumeText, setResumeText, handleFileUpload, isParsing } = useResumeInput();
    const [result, setResult] = useState<StartupIdeasResult | null>(null);
    const [step, setStep] = useState<'input' | 'analyzing' | 'result' | 'error'>('input');
    const [errorMessage, setErrorMessage] = useState('');

    const handleGenerate = async () => {
        if (!resumeText.trim()) return;
        setStep('analyzing');
        setErrorMessage('');
        try {
            const { generateStartupIdeas } = await import('../utils/analysis');
            const res = await generateStartupIdeas(resumeText);
            setResult(res);
            setStep('result');
            toast.success('Startup ideas ready');
        } catch (error: unknown) {
            console.error('Startup idea generation failed', error);
            setErrorMessage(getClaudeUserFriendlyMessage(error));
            setStep('error');
            toast.error('Could not generate ideas');
        }
    };

    const handleClose = () => {
        setResumeText('');
        setResult(null);
        setErrorMessage('');
        setStep('input');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Startup Ideas" size="lg" layer="overlay">
            {step === 'input' && (
                <div className="space-y-4">
                    <p className="text-gray-400 text-sm">
                        Upload your resume or paste your experience to get a <strong className="text-white">personalized startup opportunity dashboard</strong> — tailored ideas, resume-fit scores, and a 90-day action plan, powered by AI.
                    </p>

                    <div className="relative group border border-white/[0.08] hover:border-violet-500/30 bg-white/[0.02] hover:bg-white/[0.04] rounded-xl p-8 text-center transition-all cursor-pointer overflow-hidden">
                        <input
                            type="file"
                            accept=".txt,.md,.json,.pdf"
                            onChange={handleFileUpload}
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                            aria-label="Upload resume file"
                        />
                        <div className="pointer-events-none flex flex-col items-center relative z-0">
                            <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4 group-hover:border-violet-500/30 transition-all">
                                <IconUpload size={24} className="text-gray-400 group-hover:text-violet-400 transition-colors" />
                            </div>
                            <h3 className="text-sm font-semibold text-white mb-1">{isParsing ? 'Reading file…' : 'Upload your Resume'}</h3>
                            <p className="text-xs text-gray-500 mb-3">Drag & drop or click to browse</p>
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">PDF</span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-white/[0.04] text-gray-500 border border-white/[0.08]">TXT / MD</span>
                            </div>
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/[0.06]"></div></div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-gray-900 px-3 text-gray-500">Or paste text</span>
                        </div>
                    </div>

                    <textarea
                        className="w-full h-32 bg-white/[0.03] border border-white/[0.08] rounded-lg p-3 text-white focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 outline-none transition-all placeholder-gray-600 text-sm resize-none"
                        placeholder="Paste your CV, work history, or a summary of your skills and experience..."
                        value={resumeText}
                        onChange={(e) => setResumeText(e.target.value)}
                    />

                    <button
                        onClick={handleGenerate}
                        disabled={!resumeText.trim()}
                        className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wider text-sm flex items-center justify-center gap-2"
                    >
                        <IconSparkles size={16} /> Generate Startup Ideas
                    </button>
                </div>
            )}

            {step === 'analyzing' && (
                <div className="flex flex-col items-center justify-center text-center space-y-6 py-12" role="status" aria-busy="true">
                    <div className="w-10 h-10 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin"></div>
                    <div>
                        <p className="text-white font-medium mb-1">Building your startup dashboard</p>
                        <p className="text-gray-500 text-xs">Analyzing your resume and scanning market opportunities…</p>
                    </div>
                    <div className="w-full max-w-xs space-y-3">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-4/5" />
                        <Skeleton className="h-3 w-3/5" />
                    </div>
                </div>
            )}

            {step === 'result' && result && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    {/* Founder profile */}
                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                        <h3 className="text-xs font-semibold text-violet-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <IconTarget size={14} /> Founder Profile
                        </h3>
                        {result.founderProfile.summary && (
                            <p className="text-gray-200 text-sm leading-relaxed mb-3">{result.founderProfile.summary}</p>
                        )}
                        <div className="grid md:grid-cols-2 gap-3">
                            {result.founderProfile.coreSkills.length > 0 && (
                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Core skills</p>
                                    <Chips items={result.founderProfile.coreSkills} className="bg-white/[0.05] text-gray-200 border-white/10" />
                                </div>
                            )}
                            {result.founderProfile.unfairAdvantages.length > 0 && (
                                <div>
                                    <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1.5">Unfair advantages</p>
                                    <Chips items={result.founderProfile.unfairAdvantages} className="bg-emerald-500/[0.06] text-emerald-300 border-emerald-500/20" />
                                </div>
                            )}
                            {result.founderProfile.domains.length > 0 && (
                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Domains</p>
                                    <Chips items={result.founderProfile.domains} className="bg-white/[0.05] text-gray-200 border-white/10" />
                                </div>
                            )}
                            {result.founderProfile.gaps.length > 0 && (
                                <div>
                                    <p className="text-[10px] text-amber-400 uppercase tracking-wider mb-1.5">Gaps to watch</p>
                                    <Chips items={result.founderProfile.gaps} className="bg-amber-500/[0.06] text-amber-300 border-amber-500/20" />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Comparison table */}
                    {result.ideas.length > 1 && (
                        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                            <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
                                <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Idea Comparison</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                                            <th className="text-left font-medium px-4 py-2">#</th>
                                            <th className="text-left font-medium px-4 py-2">Idea</th>
                                            <th className="text-center font-medium px-3 py-2">Fit</th>
                                            <th className="text-center font-medium px-3 py-2">Revenue</th>
                                            <th className="text-center font-medium px-3 py-2">Difficulty</th>
                                            <th className="text-center font-medium px-4 py-2">Call</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.ideas.map((idea, i) => (
                                            <tr key={i} className="border-t border-white/[0.05]">
                                                <td className="px-4 py-2.5 text-gray-500 tabular-nums">{i + 1}</td>
                                                <td className="px-4 py-2.5 text-gray-200 font-medium">{idea.name}</td>
                                                <td className="px-3 py-2.5 text-center text-emerald-300 tabular-nums">{idea.resumeFitScore}</td>
                                                <td className="px-3 py-2.5 text-center text-cyan-300 tabular-nums">{idea.revenuePotentialScore}</td>
                                                <td className="px-3 py-2.5 text-center text-amber-300 tabular-nums">{idea.difficultyScore}</td>
                                                <td className="px-4 py-2.5 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${recommendationClass(idea.recommendation)}`}>
                                                        {idea.recommendation}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Ranked ideas */}
                    <div className="space-y-3">
                        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                            <IconTrendingUp size={14} className="text-cyan-400" /> Ranked Startup Ideas
                        </h3>
                        {result.ideas.map((idea, i) => (
                            <IdeaCard key={i} idea={idea} rank={i + 1} />
                        ))}
                    </div>

                    {/* Top 3 execution plans */}
                    {result.topThree.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                <IconRocket size={14} className="text-violet-400" /> Top 3 · Execution Plans
                            </h3>
                            {result.topThree.map((plan, i) => (
                                <div key={i} className="p-4 rounded-xl bg-violet-500/[0.04] border border-violet-500/15 space-y-3">
                                    <h4 className="text-sm font-semibold text-white">{plan.name}</h4>
                                    <div className="grid md:grid-cols-2 gap-3">
                                        <DetailRow label="48-hour validation" value={plan.validation48h} />
                                        <DetailRow label="7-day MVP" value={plan.mvp7day} />
                                        <DetailRow label="30-day launch" value={plan.launch30day} />
                                        <DetailRow label="90-day revenue" value={plan.revenue90day} />
                                    </div>
                                    {plan.techStack.length > 0 && (
                                        <div>
                                            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Recommended stack</p>
                                            <Chips items={plan.techStack} className="bg-white/[0.05] text-gray-200 border-white/10" />
                                        </div>
                                    )}
                                    {plan.firstCustomers.length > 0 && (
                                        <div>
                                            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">First customers to target</p>
                                            <ul className="space-y-1">
                                                {plan.firstCustomers.map((c, j) => (
                                                    <li key={j} className="text-sm text-gray-300 flex items-start gap-2">
                                                        <IconArrowRight size={13} className="text-violet-400 mt-1 shrink-0" /> {c}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {plan.outreachScript && (
                                        <div>
                                            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Outreach script</p>
                                            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line bg-black/20 border border-white/[0.06] rounded-lg p-3">{plan.outreachScript}</p>
                                        </div>
                                    )}
                                    <DetailRow label="Kill criteria" value={plan.killCriteria} />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Start here */}
                    {result.startHere && (
                        <div className="p-5 bg-cyan-500/[0.04] border border-cyan-500/15 rounded-xl">
                            <h3 className="text-cyan-300 font-semibold uppercase tracking-wider text-xs mb-2 flex items-center gap-2">
                                <IconCheck size={14} /> Start Here
                            </h3>
                            <p className="text-gray-200 text-sm leading-relaxed">{result.startHere}</p>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={() => setStep('input')}
                            className="flex-1 py-3 border border-white/[0.08] hover:bg-white/[0.04] rounded-lg text-sm font-medium text-gray-400 transition-colors"
                        >
                            New Analysis
                        </button>
                        <button
                            onClick={handleClose}
                            className="flex-1 py-3 border border-white/[0.08] hover:bg-white/[0.04] rounded-lg text-sm font-medium text-gray-400 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {step === 'error' && (
                <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
                    <IconAlertTriangle size={40} className="text-red-400" />
                    <h3 className="text-lg font-semibold text-white">Could Not Generate Ideas</h3>
                    <p className="text-gray-400 text-sm max-w-xs">{errorMessage}</p>
                    {/quota|rate limit/i.test(errorMessage) && (
                        <div className="p-3 bg-white/[0.03] rounded-lg border border-amber-500/20 text-xs text-amber-200 text-left max-w-sm">
                            <strong>Tip:</strong> The free AI quota may be exhausted. Wait a minute and retry, or add your own API key.
                        </div>
                    )}
                    <button
                        onClick={() => setStep('input')}
                        className="mt-2 px-6 py-2.5 border border-white/[0.1] hover:bg-white/[0.06] rounded-lg text-sm text-white transition-colors"
                    >
                        Retry
                    </button>
                </div>
            )}
        </Modal>
    );
};
