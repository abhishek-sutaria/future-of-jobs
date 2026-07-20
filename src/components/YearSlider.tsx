import React from 'react';
import { useStore } from '../store';
import { Z } from '../config/layers';
import { YEAR_MIN, YEAR_MAX, YEAR_RANGE } from '../config/constants';

export const YearSlider: React.FC = () => {
    const year = useStore((state) => state.year);
    const setYear = useStore((state) => state.setYear);
    const heightMode = useStore((state) => state.heightMode);
    const setHeightMode = useStore((state) => state.setHeightMode);
    const progress = ((year - YEAR_MIN) / YEAR_RANGE) * 100;

    const modeHint = heightMode === 'employment'
        ? 'Height = log-scaled implied workforce (BLS employment × cumulative % at this year).'
        : 'Height = projected growth at this year';

    return (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl pointer-events-auto" style={{ zIndex: Z.timeBar }}>
            <div data-tour="tour-slider" className="bg-gray-900/60 backdrop-blur-xl border border-cyan-400/25 rounded-2xl p-4 md:p-6 shadow-lg shadow-cyan-500/5 overflow-hidden">
                {/* Peak height encoding toggle */}
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap min-w-0">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">
                        Peak Height
                    </span>
                    <div
                        role="radiogroup"
                        aria-label="Peak height encoding"
                        className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5"
                    >
                        <button
                            type="button"
                            role="radio"
                            aria-checked={heightMode === 'growth'}
                            onClick={() => setHeightMode('growth')}
                            className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md transition-colors ${
                                heightMode === 'growth'
                                    ? 'bg-cyan-500/20 text-cyan-200'
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            Growth
                        </button>
                        <button
                            type="button"
                            role="radio"
                            aria-checked={heightMode === 'employment'}
                            onClick={() => setHeightMode('employment')}
                            className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md transition-colors ${
                                heightMode === 'employment'
                                    ? 'bg-cyan-500/20 text-cyan-200'
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            Workers
                        </button>
                    </div>
                </div>
                <p className="text-[10px] text-gray-500 mb-3 leading-snug break-words">{modeHint}</p>

                <div className="flex justify-between items-center mb-3 text-sm font-medium tracking-widest gap-2 min-w-0">
                    <span className="text-gray-500 text-xs">{YEAR_MIN}</span>
                    <span className="text-cyan-400 text-lg font-bold tabular-nums shrink-0 min-w-0 text-center" aria-live="polite">
                        {year.toFixed(0)}
                    </span>
                    <span className="text-gray-500 text-xs">{YEAR_MAX}</span>
                </div>

                <div className="relative">
                    <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 bg-white/[0.06] rounded-full pointer-events-none">
                        <div
                            className="h-full bg-cyan-500/80 rounded-full transition-[width] duration-75"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <input
                        type="range"
                        min={YEAR_MIN}
                        max={YEAR_MAX}
                        step="0.1"
                        value={year}
                        onChange={(e) => {
                            const nextYear = parseFloat(e.target.value);
                            setYear(nextYear);
                        }}
                        aria-label={`Year selector, currently ${year.toFixed(0)}`}
                        aria-valuemin={YEAR_MIN}
                        aria-valuemax={YEAR_MAX}
                        aria-valuenow={Math.round(year)}
                        className="relative w-full h-6 appearance-none bg-transparent cursor-pointer z-10 slider-input"
                    />
                </div>
            </div>
        </div>
    );
};
