import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { ResumePrivacyNote } from './ui/ResumePrivacyNote';
import { IconUpload, IconShield, IconAlertTriangle, IconCheck } from './ui/Icons';
import { Skeleton } from './ui/Skeleton';
import { toast } from './ui/Toast';
import { useResumeInput } from '../hooks/useResumeInput';
import { getClaudeUserFriendlyMessage } from '../utils/analysis';
import { useUserStore } from '../userStore';
import { resumeCacheKey, loadSkillsAnalysis, saveSkillsAnalysis } from '../lib/userData';

interface SkillsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SkillsModal: React.FC<SkillsModalProps> = ({ isOpen, onClose }) => {
    const { resumeText: skillInput, setResumeText: setSkillInput, handleFileUpload, isParsing } = useResumeInput();
    const [analysisResult, setAnalysisResult] = useState<import('../utils/analysis').ResumeAnalysisResult | null>(null);
    const [step, setStep] = useState<'input' | 'analyzing' | 'result' | 'error'>('input');
    const [errorMessage, setErrorMessage] = useState('');
    const [restoredFromSaved, setRestoredFromSaved] = useState(false);
    const [saved, setSaved] = useState(false);
    const [cacheKey, setCacheKey] = useState<string | null>(null);
    const authStatus = useUserStore((s) => s.authStatus);

    const handleAnalyze = async () => {
        if (!skillInput.trim()) return;
        setStep('analyzing');
        setErrorMessage('');
        setRestoredFromSaved(false);
        setSaved(false);

        try {
            // The resume text itself is never stored — only a content hash, used
            // to look up a previously SAVED (opt-in) report for this exact input
            // without re-billing a Claude call. See src/lib/userData.ts.
            const key = await resumeCacheKey(skillInput);
            setCacheKey(key);
            const existing = authStatus !== 'disabled' ? await loadSkillsAnalysis(key) : null;
            if (existing) {
                setAnalysisResult(existing);
                setStep('result');
                setRestoredFromSaved(true);
                setSaved(true);
                return;
            }

            const { analyzeResume } = await import('../utils/analysis');
            const result = await analyzeResume(skillInput);
            setAnalysisResult(result);
            setStep('result');
            toast.success('Analysis complete');
        } catch (error: unknown) {
            console.error('Analysis failed', error);
            setErrorMessage(getClaudeUserFriendlyMessage(error));
            setStep('error');
            toast.error('Analysis failed');
        }
    };

    const handleSaveReport = async () => {
        if (!cacheKey || !analysisResult) return;
        const ok = await saveSkillsAnalysis(cacheKey, analysisResult);
        if (ok) {
            setSaved(true);
            toast.success('Report saved to your activity');
        } else {
            toast.warning('Could not save the report. Please try again.');
        }
    };

    const handleClose = () => {
        // The resume text lives only in this component's state and is discarded
        // here — it is never written to localStorage or any backend.
        setSkillInput('');
        setAnalysisResult(null);
        setErrorMessage('');
        setStep('input');
        setRestoredFromSaved(false);
        setSaved(false);
        setCacheKey(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Resume Health Check" size="md" layer="overlay">
            {step === 'input' && (
                <div className="space-y-4">
                    <p className="text-gray-400 text-sm">
                        Upload your resume or paste your skills to get a <strong className="text-white">qualitative 5-year relevance check</strong> powered by AI.
                    </p>

                    <ResumePrivacyNote />

                    <div className="relative group border border-white/[0.08] hover:border-cyan-500/30 bg-white/[0.02] hover:bg-white/[0.04] rounded-xl p-8 text-center transition-all cursor-pointer overflow-hidden">
                        <input
                            type="file"
                            accept=".txt,.md,.json,.pdf"
                            onChange={handleFileUpload}
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                            aria-label="Upload resume file"
                        />
                        <div className="pointer-events-none flex flex-col items-center relative z-0">
                            <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4 group-hover:border-cyan-500/30 transition-all">
                                <IconUpload size={24} className="text-gray-400 group-hover:text-cyan-400 transition-colors" />
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
                        className="dark-field w-full h-32 border border-white/[0.08] rounded-lg p-3 focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 outline-none transition-all text-sm resize-none"
                        placeholder="e.g., Python, Data Analysis, Project Management, Communication..."
                        value={skillInput}
                        onChange={(e) => setSkillInput(e.target.value)}
                    />

                    <button
                        onClick={handleAnalyze}
                        disabled={!skillInput.trim()}
                        className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wider text-sm"
                    >
                        Analyze Relevance
                    </button>
                </div>
            )}

            {step === 'analyzing' && (
                <div className="flex flex-col items-center justify-center text-center space-y-6 py-12" role="status" aria-busy="true">
                    <div className="w-10 h-10 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin"></div>
                    <div>
                        <p className="text-white font-medium mb-1">Analyzing Career Resilience</p>
                        <p className="text-gray-500 text-xs">This usually takes a few seconds...</p>
                    </div>
                    <div className="w-full max-w-xs space-y-3">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-4/5" />
                        <Skeleton className="h-3 w-3/5" />
                    </div>
                </div>
            )}

            {step === 'result' && analysisResult && (
                <div className="space-y-5 animate-in fade-in duration-300">
                    {restoredFromSaved && (
                        <p className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-2">
                            Restored from your saved reports for this exact resume — no new AI call was made.
                        </p>
                    )}
                    <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Executive Summary</h3>
                        <p className="text-gray-200 text-sm leading-relaxed">{analysisResult.feedback}</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="p-4 bg-emerald-500/[0.04] border border-emerald-500/15 rounded-xl">
                            <h3 className="text-emerald-400 font-semibold uppercase tracking-wider text-xs mb-3 flex items-center gap-2">
                                <IconShield size={14} /> Resilience Strengths
                            </h3>
                            <ul className="space-y-2">
                                {analysisResult.strengths?.map((item, i) => (
                                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                                        <IconCheck size={14} className="text-emerald-500 mt-0.5 shrink-0" /> {item}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="p-4 bg-red-500/[0.04] border border-red-500/15 rounded-xl">
                            <h3 className="text-red-400 font-semibold uppercase tracking-wider text-xs mb-3 flex items-center gap-2">
                                <IconAlertTriangle size={14} /> Future Gaps (2030)
                            </h3>
                            <ul className="space-y-2">
                                {analysisResult.gaps?.map((item, i) => (
                                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                                        <span className="text-red-500 mt-0.5 shrink-0 text-xs font-bold">!</span> {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <div className="p-5 bg-blue-500/[0.04] border border-blue-500/15 rounded-xl">
                        <h3 className="text-cyan-300 font-semibold uppercase tracking-wider text-xs mb-2">5-Year Strategic Outlook</h3>
                        <p className="text-gray-200 text-sm leading-relaxed">{analysisResult.plan}</p>
                    </div>

                    {authStatus !== 'disabled' && (
                        <button
                            onClick={() => void handleSaveReport()}
                            disabled={saved}
                            className="w-full py-2.5 border border-indigo-500/25 bg-indigo-500/[0.06] hover:bg-indigo-500/15 disabled:opacity-50 disabled:cursor-default rounded-lg text-xs font-semibold uppercase tracking-wider text-indigo-300 transition-colors"
                        >
                            {saved ? 'Saved to your activity' : 'Save this report'}
                        </button>
                    )}

                    <button
                        onClick={handleClose}
                        className="w-full py-3 border border-white/[0.08] hover:bg-white/[0.04] rounded-lg text-sm font-medium text-gray-400 transition-colors"
                    >
                        Close Analysis
                    </button>
                </div>
            )}

            {step === 'error' && (
                <div className="flex flex-col items-center justify-center text-center space-y-4 py-8">
                    <IconAlertTriangle size={40} className="text-red-400" />
                    <h3 className="text-lg font-semibold text-white">Analysis Failed</h3>
                    <p className="text-gray-400 text-sm max-w-xs">{errorMessage}</p>
                    {(errorMessage.includes('429') || /quota|rate limit/i.test(errorMessage)) && (
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
