import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { runAllChecks, makePendingResults, type CheckResult, type CheckStatus } from '../../utils/healthCheck';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const STATUS_STYLE: Record<CheckStatus, { bg: string; ring: string; text: string; icon: string; label: string }> = {
    pending: { bg: 'bg-gray-700/30',    ring: 'ring-gray-500/30',    text: 'text-gray-400',    icon: '…', label: 'Checking' },
    pass:    { bg: 'bg-emerald-500/15', ring: 'ring-emerald-400/40', text: 'text-emerald-300', icon: '✓', label: 'All good' },
    fail:    { bg: 'bg-red-500/15',     ring: 'ring-red-400/40',     text: 'text-red-300',     icon: '✕', label: 'Not working' },
    warn:    { bg: 'bg-amber-500/15',   ring: 'ring-amber-400/40',   text: 'text-amber-300',   icon: '!', label: 'Heads up' },
};

function deriveOverall(results: CheckResult[]): CheckStatus {
    if (results.length === 0 || results.some((r) => r.status === 'pending')) return 'pending';
    if (results.some((r) => r.status === 'fail')) return 'fail';
    if (results.some((r) => r.status === 'warn')) return 'warn';
    return 'pass';
}

const OVERALL_HEADLINE: Record<CheckStatus, string> = {
    pending: 'Checking everything…',
    pass:    'Everything is working perfectly.',
    fail:    'Something is not working right now.',
    warn:    'A few things need your attention.',
};

export const HealthCheckModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [results, setResults] = useState<CheckResult[]>(() => makePendingResults());
    const [isRunning, setIsRunning] = useState(false);
    const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

    const start = useCallback(async () => {
        setIsRunning(true);
        setResults(makePendingResults());
        await runAllChecks((next) => setResults(next));
        setIsRunning(false);
        setLastRunAt(new Date());
    }, []);

    useEffect(() => {
        if (isOpen) {
            start();
        }
    }, [isOpen, start]);

    const overall = deriveOverall(results);
    const overallStyle = STATUS_STYLE[overall];

    const counts = {
        pass: results.filter((r) => r.status === 'pass').length,
        fail: results.filter((r) => r.status === 'fail').length,
        warn: results.filter((r) => r.status === 'warn').length,
    };

    const lastCheckedTime = lastRunAt
        ? lastRunAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Is the app working?" size="md" layer="top">
            <div className="space-y-4">
                {/* Overall summary banner */}
                <div className={`p-4 rounded-xl ${overallStyle.bg} ring-1 ${overallStyle.ring}`}>
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${overallStyle.bg} ring-1 ${overallStyle.ring} ${overallStyle.text}`}>
                            {overallStyle.icon}
                        </div>
                        <div className="flex-1">
                            <div className="text-sm font-semibold text-white">{OVERALL_HEADLINE[overall]}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                                {counts.pass} of {results.length} things working
                                {counts.warn > 0 && <> · {counts.warn} need{counts.warn === 1 ? 's' : ''} attention</>}
                                {counts.fail > 0 && <> · {counts.fail} not working</>}
                                {lastCheckedTime && <> · last checked at {lastCheckedTime}</>}
                            </div>
                        </div>
                    </div>
                </div>

                <p className="text-xs text-gray-400 leading-relaxed">
                    This checks every part of the app to make sure it's working — the AI features,
                    the live data, your browser. <span className="text-emerald-300">Green</span> means
                    good, <span className="text-amber-300">yellow</span> means a minor issue, and{' '}
                    <span className="text-red-300">red</span> means something needs fixing. You can
                    re-run the checks any time with the button at the bottom.
                </p>

                {/* Per-check rows */}
                <div className="space-y-2">
                    {results.map((r) => {
                        const style = STATUS_STYLE[r.status];
                        return (
                            <div
                                key={r.id}
                                className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06]"
                            >
                                <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${style.bg} ring-1 ${style.ring} ${style.text} ${r.status === 'pending' ? 'animate-pulse' : ''}`}
                                >
                                    {style.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                        <h3 className="text-sm font-semibold text-white">{r.name}</h3>
                                        <span className={`text-[10px] uppercase tracking-wider font-semibold ${style.text}`}>
                                            {style.label}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-0.5">{r.description}</p>
                                    <p className="text-xs text-gray-200 mt-1.5">{r.message}</p>
                                    {r.detail && (
                                        <p className="text-[11px] text-gray-500 mt-1 italic break-words">{r.detail}</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button
                    onClick={start}
                    disabled={isRunning}
                    className="w-full py-2.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-cyan-300 text-xs font-semibold uppercase tracking-wider border border-cyan-500/30 transition-colors"
                >
                    {isRunning ? 'Checking…' : 'Check again'}
                </button>
            </div>
        </Modal>
    );
};
