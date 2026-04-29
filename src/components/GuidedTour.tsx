import React, { useEffect, useState, useCallback } from 'react';
import { Z } from '../config/layers';

interface Step {
    target: string | null; // data-tour="…" selector, or null for centered card
    title: string;
    description: string;
    padding?: number;
}

const STEPS: Step[] = [
    {
        target: null,
        title: 'Welcome — quick tour',
        description: 'This map shows the AI impact on 50 marketing & business roles from 2025 to 2030. Click Next to walk through each feature.',
    },
    {
        target: 'tour-slider',
        title: 'AI Timeline',
        description: 'Drag the slider from 2025 → 2030. Peaks shrink as AI displaces workers — the higher the risk, the faster the drop.',
        padding: 14,
    },
    {
        target: 'tour-search',
        title: 'Search any role',
        description: 'Type a job title to jump to it on the map and instantly open its full AI impact analysis.',
        padding: 10,
    },
    {
        target: 'tour-skills',
        title: 'My Skills',
        description: "Paste your CV or skills list here. You'll get a personalised AI risk score, skill gaps, and a 6-month upskilling roadmap.",
        padding: 10,
    },
    {
        target: 'tour-toggle',
        title: 'Switch view',
        description: 'Toggle between the 3D terrain and a flat 2D US map to see where each role is most concentrated geographically.',
        padding: 10,
    },
    {
        target: 'tour-methodology',
        title: 'Data & sources',
        description: 'All data comes from BLS Occupational Outlook, O*NET, and Claude AI analysis. Click to read the full methodology.',
        padding: 10,
    },
];

interface Rect { top: number; left: number; width: number; height: number; }

interface Props {
    isActive: boolean;
    onClose: () => void;
}

const CARD_W = 300;
const CARD_H = 260;

export const GuidedTour: React.FC<Props> = ({ isActive, onClose }) => {
    const [step, setStep] = useState(0);
    const [rect, setRect] = useState<Rect | null>(null);

    const current = STEPS[step];

    const updateRect = useCallback(() => {
        if (!current.target) { setRect(null); return; }
        const el = document.querySelector(`[data-tour="${current.target}"]`);
        if (!el) { setRect(null); return; }
        const r = el.getBoundingClientRect();
        const p = current.padding ?? 8;
        setRect({ top: r.top - p, left: r.left - p, width: r.width + p * 2, height: r.height + p * 2 });
    }, [current]);

    // Reset to step 0 every time tour opens
    useEffect(() => { if (isActive) setStep(0); }, [isActive]);

    // Recalculate spotlight rect on step change and window resize
    useEffect(() => {
        updateRect();
        window.addEventListener('resize', updateRect);
        return () => window.removeEventListener('resize', updateRect);
    }, [updateRect, step]);

    if (!isActive) return null;

    const isLast = step === STEPS.length - 1;

    let cardStyle: React.CSSProperties;
    if (rect) {
        const below = rect.top + rect.height + 14;
        const above = rect.top - CARD_H - 14;
        const preferBelow = below + CARD_H < window.innerHeight - 16;
        const rawTop = preferBelow ? below : above;
        const top = Math.max(16, Math.min(window.innerHeight - CARD_H - 16, rawTop));
        const left = Math.max(16, Math.min(window.innerWidth - CARD_W - 16, rect.left + rect.width / 2 - CARD_W / 2));
        cardStyle = { position: 'fixed', top, left, width: CARD_W };
    } else {
        cardStyle = {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: CARD_W,
        };
    }

    return (
        <>
            {/* Dark overlay — spotlight punches through via box-shadow */}
            {rect ? (
                <div
                    style={{
                        position: 'fixed',
                        zIndex: Z.modal,
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                        borderRadius: 10,
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.82)',
                        border: '2px solid rgba(6,182,212,0.5)',
                        pointerEvents: 'none',
                    }}
                />
            ) : (
                <div
                    className="fixed inset-0"
                    style={{ zIndex: Z.modal, background: 'rgba(0,0,0,0.82)', pointerEvents: 'none' }}
                />
            )}

            {/* Step card */}
            <div style={{ ...cardStyle, zIndex: Z.modal + 1 }} className="bg-gray-900 border border-white/10 rounded-xl p-5 shadow-2xl">
                {/* Progress dots */}
                <div className="flex gap-1.5 mb-4">
                    {STEPS.map((_, i) => (
                        <div
                            key={i}
                            className={`h-1 rounded-full transition-all duration-300 ${
                                i === step ? 'w-6 bg-cyan-400' : i < step ? 'w-2 bg-cyan-800' : 'w-2 bg-white/15'
                            }`}
                        />
                    ))}
                </div>

                <p className="text-[10px] text-cyan-500 uppercase tracking-widest font-bold mb-1">
                    {step + 1} / {STEPS.length}
                </p>
                <h3 className="text-white font-bold text-[15px] mb-2">{current.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-5">{current.description}</p>

                <div className="flex items-center justify-between">
                    <button
                        onClick={step === 0 ? onClose : () => setStep(s => s - 1)}
                        className="text-gray-500 text-sm hover:text-gray-300 transition-colors"
                    >
                        {step === 0 ? 'Skip tour' : '← Back'}
                    </button>
                    <button
                        onClick={isLast ? onClose : () => setStep(s => s + 1)}
                        className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                        {isLast ? 'Done ✓' : 'Next →'}
                    </button>
                </div>
            </div>
        </>
    );
};
