import React, { useState } from 'react';
import { useStore } from '../store';

const KELLEY_COURSES: Record<string, { code: string, name: string }> = {
    'python': { code: 'BUS-K201', name: 'The Computer in Business' },
    'analysis': { code: 'BUS-K303', name: 'Technology & Business Analysis' },
    'strategy': { code: 'BUS-J375', name: 'Strategic Management' },
    'leadership': { code: 'BUS-Z302', name: 'Managing Behavior in Organizations' },
    'finance': { code: 'BUS-F370', name: 'I-Core Finance' },
    'marketing': { code: 'BUS-M370', name: 'I-Core Marketing' },
    'ai': { code: 'BUS-S400', name: 'Special Topics in Applied Biz Tech' },
};

interface SkillsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SkillsModal: React.FC<SkillsModalProps> = ({ isOpen, onClose }) => {
    const [skillInput, setSkillInput] = useState('');
    const [analysisResult, setAnalysisResult] = useState<{ score: number, feedback: string, recommendation?: { code: string, name: string } } | null>(null);
    const [step, setStep] = useState<'input' | 'analyzing' | 'recommendation' | 'result'>('input');

    const handleAnalyze = () => {
        setStep('analyzing');

        // Mock Analysis Logic
        setTimeout(() => {
            analyzeSkills(skillInput);
        }, 1500);
    };

    const analyzeSkills = (input: string) => {
        const lower = input.toLowerCase();
        const skills = input.split(',').map(s => s.trim());
        const hasStrategy = lower.includes('strategy') || lower.includes('planning');
        const hasTech = lower.includes('python') || lower.includes('sql') || lower.includes('data');
        const hasLeadership = lower.includes('leadership') || lower.includes('management');

        let score = 60;
        let feedback = "";

        if (skills.length < 2) {
            score = 45;
            feedback = "Resume indicates high exposure to automation. Skills are primarily routine/transactional.";
        } else if (hasStrategy && hasLeadership) {
            score = 88;
            feedback = "Strong resilience! Your focus on strategy and leadership buffers against automation.";
        } else if (hasTech) {
            score = 72;
            feedback = "Good technical base, but needs more strategic differentiation.";
        } else {
            score = 60;
            feedback = "Moderate risk. Consider adding high-value human-centric skills.";
        }

        // FIND KELLEY RECOMMENDATION
        let recommendation = null;
        if (!hasStrategy) recommendation = KELLEY_COURSES['strategy'];
        else if (!hasTech) recommendation = KELLEY_COURSES['python'];
        else if (!hasLeadership) recommendation = KELLEY_COURSES['leadership'];
        else recommendation = KELLEY_COURSES['ai']; // Default adv topic

        setAnalysisResult({ score, feedback, recommendation });
        setStep('recommendation');
    };

    const handleAcceptRecommendation = () => {
        if (analysisResult) {
            // BOOST SCORE
            setAnalysisResult({
                ...analysisResult,
                score: Math.min(100, analysisResult.score + 15),
                feedback: `${analysisResult.feedback} (+15 pts for Planned Coursework)`
            });
            setStep('result');
        }
    };

    const handleClose = () => {
        setSkillInput('');
        setAnalysisResult(null);
        setStep('input');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-gray-800/50">
                    <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
                        <span className="text-cyan-400">⚡</span> Resume Health Check
                    </h2>
                    <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
                </div>

                {/* Content Container */}
                <div className="p-6 flex-1 overflow-y-auto">

                    {/* STEP 1: INPUT */}
                    {step === 'input' && (
                        <div className="space-y-4">
                            <p className="text-gray-300 text-sm">
                                Paste your resume skills section or type key skills below to test your "Automation Resilience Score".
                            </p>
                            <textarea
                                className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none resize-none placeholder-gray-600 text-sm"
                                placeholder="e.g., Data Entry, Excel, Python, Strategic Planning, Negotiation..."
                                value={skillInput}
                                onChange={(e) => setSkillInput(e.target.value)}
                            />
                            <button
                                onClick={handleAnalyze}
                                disabled={!skillInput.trim()}
                                className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-lg font-bold text-white uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(8,145,178,0.3)]"
                            >
                                Run Resilience Check
                            </button>
                        </div>
                    )}

                    {/* STEP 2: ANALYZING */}
                    {step === 'analyzing' && (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
                            <p className="text-cyan-400 animate-pulse font-mono uppercase tracking-widest text-xs">Analyzing Market Fit...</p>
                        </div>
                    )}

                    {/* STEP 3: RECOMMENDATION (The "Upskill" Loop) */}
                    {step === 'recommendation' && analysisResult && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                <h3 className="text-yellow-400 font-bold uppercase tracking-wider text-xs mb-2">Skill Gap Detected</h3>
                                <p className="text-gray-300 text-sm">
                                    Your profile currently lacks strong evidence of <span className="text-white font-bold">{analysisResult.recommendation?.name.split(' ')[0]}</span> capabilities required for 2030 resilience.
                                </p>
                            </div>

                            <div className="p-6 bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 rounded-xl text-center space-y-4 shadow-inner">
                                <p className="text-gray-500 text-[10px] uppercase tracking-widest font-bold">Recommended Kelley Course</p>
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tight">{analysisResult.recommendation?.code}</h2>
                                    <p className="text-cyan-400 font-medium text-sm mt-1">{analysisResult.recommendation?.name}</p>
                                </div>

                                <button
                                    onClick={handleAcceptRecommendation}
                                    className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-white uppercase tracking-wider shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
                                >
                                    <span>Add to Academic Plan</span>
                                    <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">+15 Pts</span>
                                </button>
                                <p className="text-[10px] text-gray-500 italic">Clicking this acknowledges the curriculum requirement.</p>
                            </div>
                        </div>
                    )}

                    {/* STEP 4: FINAL RESULT */}
                    {step === 'result' && analysisResult && (
                        <div className="flex flex-col items-center space-y-6 animate-in zoom-in duration-300">
                            <div className="relative">
                                {/* Score Circle */}
                                <svg className="w-40 h-40 transform -rotate-90">
                                    <circle
                                        className="text-gray-800"
                                        strokeWidth="8"
                                        stroke="currentColor"
                                        fill="transparent"
                                        r="70"
                                        cx="80"
                                        cy="80"
                                    />
                                    <circle
                                        className={`${analysisResult.score > 80 ? 'text-green-500' : analysisResult.score > 60 ? 'text-yellow-500' : 'text-red-500'} transition-all duration-1000 ease-out`}
                                        strokeWidth="8"
                                        strokeDasharray={440}
                                        strokeDashoffset={440 - (440 * analysisResult.score) / 100}
                                        strokeLinecap="round"
                                        stroke="currentColor"
                                        fill="transparent"
                                        r="70"
                                        cx="80"
                                        cy="80"
                                    />
                                </svg>
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                    <span className="text-5xl font-black text-white tracking-tighter">{analysisResult.score}</span>
                                    <span className="block text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-1">Resilience</span>
                                </div>
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-bold text-white">Analysis Complete</h3>
                                <p className="text-sm text-gray-300 px-2 leading-relaxed">{analysisResult.feedback}</p>
                            </div>

                            <button
                                onClick={() => {
                                    const job = useStore.getState().jobs.find(j => j.id === 'job-15');
                                    if (job) useStore.getState().setSelectedJob(job);
                                    handleClose();
                                }}
                                className="px-6 py-2 border border-white/10 hover:bg-white/10 rounded-full text-xs font-bold uppercase tracking-wider text-gray-300 transition-colors"
                            >
                                View Recommended Career Path →
                            </button>
                        </div>
                    )}
                </div>

                {/* Decorative glow */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-0.5 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-50"></div>
            </div>
        </div>
    );
};
