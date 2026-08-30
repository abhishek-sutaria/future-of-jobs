import React from 'react';
import { useStore } from '../store';
import { Z } from '../config/layers';

export const ApiKeyModal: React.FC = () => {
    const hasConfiguredAI = useStore((state) => state.hasConfiguredAI);
    const apiKeyMode = useStore((state) => state.apiKeyMode);
    const setUserClaudeApiKey = useStore((state) => state.setUserClaudeApiKey);
    const useDefaultClaudeKey = useStore((state) => state.useDefaultClaudeKey);
    const claudeKeyModalOpen = useStore((state) => state.claudeKeyModalOpen);
    const closeClaudeKeyModal = useStore((state) => state.closeClaudeKeyModal);
    const route = useStore((state) => state.route);
    const hasDefaultClaudeKey = import.meta.env.VITE_HAS_DEFAULT_CLAUDE_KEY;

    const [inputKey, setInputKey] = React.useState('');
    const [inputError, setInputError] = React.useState<string | null>(null);

    // The dashboard needs no Claude access at all, so the otherwise-undismissable
    // "configure a key" gate must never block reaching it. A voluntary re-open
    // (claudeKeyModalOpen, e.g. from the header's "Claude API" button) still
    // works on the dashboard — only the involuntary !hasConfiguredAI gate is
    // suppressed there.
    const showModal = (!hasConfiguredAI && route !== 'dashboard') || claudeKeyModalOpen;
    const canDismiss = hasConfiguredAI && claudeKeyModalOpen;

    React.useEffect(() => {
        if (claudeKeyModalOpen) {
            setInputKey('');
            setInputError(null);
        }
    }, [claudeKeyModalOpen]);

    if (!showModal) return null;

    const handleUseMyKey = () => {
        const key = inputKey.trim();
        if (!key) {
            setInputError('Enter your Claude API key or choose "Use Default Key".');
            return;
        }
        if (!key.startsWith('sk-ant-')) {
            setInputError('Claude keys usually start with "sk-ant-". Please verify.');
            return;
        }
        setInputError(null);
        setUserClaudeApiKey(key);
        closeClaudeKeyModal();
    };

    const handleUseDefault = () => {
        if (!hasDefaultClaudeKey) return;
        useDefaultClaudeKey();
        closeClaudeKeyModal();
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" style={{ zIndex: Z.apiKey }}>
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl relative">
                {canDismiss && (
                    <button
                        type="button"
                        onClick={closeClaudeKeyModal}
                        className="absolute top-4 right-4 text-gray-500 hover:text-white text-xs font-medium uppercase tracking-wider"
                    >
                        Close
                    </button>
                )}
                <h2 className="text-xl font-semibold text-white pr-16">
                    {hasConfiguredAI ? 'Change Claude API key' : 'Connect Claude AI'}
                </h2>
                {hasConfiguredAI && (
                    <p className="mt-2 text-xs text-gray-500">
                        Current: {apiKeyMode === 'user' ? 'Your API key' : 'Default server key (from .env)'}
                    </p>
                )}
                <p className="mt-2 text-sm text-gray-400">
                    Enter your Claude API key, or continue with the app’s secure default key (dev server reads{' '}
                    <span className="text-gray-500 font-mono text-xs">ANTHROPIC_API_KEY</span> from <span className="text-gray-500 font-mono text-xs">.env</span>
                    — restart <span className="text-gray-500 font-mono text-xs">npm run dev</span> after changing it).
                </p>
                {!hasDefaultClaudeKey && (
                    <p className="mt-2 text-xs text-amber-300">
                        Default key is not configured on this machine yet, so please use your own Claude key for now.
                    </p>
                )}

                <div className="mt-5">
                    <label htmlFor="claude-api-key" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                        Claude API Key
                    </label>
                    <input
                        id="claude-api-key"
                        type="password"
                        value={inputKey}
                        onChange={(e) => {
                            setInputKey(e.target.value);
                            if (inputError) setInputError(null);
                        }}
                        placeholder="sk-ant-..."
                        className="dark-field w-full rounded-lg border border-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40"
                    />
                    {inputError && <p className="mt-2 text-xs text-red-400">{inputError}</p>}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:justify-end sm:flex-wrap">
                    {canDismiss && (
                        <button
                            type="button"
                            onClick={closeClaudeKeyModal}
                            className="order-last sm:order-none px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-medium sm:mr-auto"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleUseDefault}
                        disabled={!hasDefaultClaudeKey}
                        className="px-4 py-2.5 rounded-lg border border-white/10 text-gray-200 enabled:hover:bg-white/[0.05] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                        Use Default Key
                    </button>
                    <button
                        type="button"
                        onClick={handleUseMyKey}
                        className="px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors text-sm font-semibold"
                    >
                        {hasConfiguredAI ? 'Save new key' : 'Use my key'}
                    </button>
                </div>
            </div>
        </div>
    );
};
