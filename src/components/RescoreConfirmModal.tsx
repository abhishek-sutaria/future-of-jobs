import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { estimateRescoreCost, formatRescoreCostSummary } from '../utils/rescoreCost';
import { Modal } from './ui/Modal';

/**
 * Gate for the expensive full re-score: show a token/USD estimate and require
 * the user's own Claude API key (not the app default) before proceeding.
 *
 * IMPORTANT: Must NOT render under Header's `pointer-events-none` ancestor —
 * that made the backdrop look modal while clicks fell through to the globe,
 * year slider, and job labels. The shared Modal is portaled to document.body
 * (`portal`) with pointer-events-auto at Z.modalTop.
 */
export const RescoreConfirmModal: React.FC = () => {
    const isOpen = useStore((s) => s.rescoreModalOpen);
    const onClose = useStore((s) => s.closeRescoreModal);
    const jobs = useStore((s) => s.jobs);
    const apiKeyMode = useStore((s) => s.apiKeyMode);
    const userClaudeApiKey = useStore((s) => s.userClaudeApiKey);
    const setUserClaudeApiKey = useStore((s) => s.setUserClaudeApiKey);
    const refreshAIScores = useStore((s) => s.refreshAIScores);

    const [inputKey, setInputKey] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);

    const estimate = useMemo(
        () =>
            estimateRescoreCost(
                jobs.map((j) => ({
                    title: j.title,
                    tasks: j.tasks.map((t) => ({ name: t.name })),
                    employment: j.employment,
                    projectedGrowth: j.projectedGrowth,
                })),
            ),
        [jobs],
    );

    const hasSavedUserKey = apiKeyMode === 'user' && !!userClaudeApiKey.trim();

    useEffect(() => {
        if (!isOpen) return;
        setInputKey('');
        setInputError(null);
        setStarting(false);
    }, [isOpen]);

    const handleStart = async () => {
        // Prefer a freshly entered key; otherwise reuse a saved user key.
        const typed = inputKey.trim();
        if (typed) {
            if (!typed.startsWith('sk-ant-')) {
                setInputError('Claude keys usually start with "sk-ant-". Please verify.');
                return;
            }
            setUserClaudeApiKey(typed);
        } else if (!hasSavedUserKey) {
            setInputError('Enter your Claude API key to run re-score (app default key is not used here).');
            return;
        }

        setInputError(null);
        setStarting(true);
        onClose();
        try {
            await refreshAIScores();
            // A full re-score overwrites every job's task scores wholesale —
            // restore any upskill boosts the user has earned, for every job.
        } finally {
            setStarting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Re-score all roles?" size="sm" layer="top" portal>
                <p className="text-sm text-gray-400 leading-relaxed">
                    This refreshes AI task ratings and year-by-year forecasts for every role on the map.
                    It takes about 4–5 minutes in the background. The new ratings replace the published
                    ones in this browser only; everyone else keeps seeing the published set.
                </p>

                <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/90 mb-1">
                        Estimated Claude usage
                    </p>
                    <p className="text-sm text-gray-200 font-medium">{formatRescoreCostSummary(estimate)}</p>
                    <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
                        ~{estimate.inputTokens.toLocaleString()} input + ~{estimate.outputTokens.toLocaleString()}{' '}
                        output tokens across {estimate.totalTasks} O*NET tasks. Actual cost depends on your
                        Anthropic plan and response length.
                    </p>
                </div>

                <div className="mt-5">
                    <label htmlFor="rescore-claude-api-key" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                        Your Claude API key
                    </label>
                    <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                        Re-scoring bills <span className="text-gray-400">your</span> key so shared app usage
                        stays low — everything else in the app runs on the built-in key with no setup.
                        Your key is stored only in this browser and sent only to Anthropic, never saved
                        to any account.
                    </p>
                    <input
                        id="rescore-claude-api-key"
                        type="password"
                        value={inputKey}
                        onChange={(e) => {
                            setInputKey(e.target.value);
                            if (inputError) setInputError(null);
                        }}
                        placeholder={hasSavedUserKey ? '••••••••  (saved key will be used if left blank)' : 'sk-ant-...'}
                        className="dark-field w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                        autoComplete="off"
                        data-autofocus
                    />
                    {hasSavedUserKey && !inputKey.trim() && (
                        <p className="mt-2 text-xs text-emerald-400/90">Using your previously saved Claude API key.</p>
                    )}
                    {inputError && <p className="mt-2 text-xs text-red-400">{inputError}</p>}
                </div>

                <div className="mt-6 flex sm:justify-end">
                    <button
                        type="button"
                        disabled={starting}
                        onClick={() => { void handleStart(); }}
                        className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white transition-colors text-sm font-semibold"
                    >
                        {starting ? 'Starting…' : 'Start re-score'}
                    </button>
                </div>
        </Modal>
    );
};
