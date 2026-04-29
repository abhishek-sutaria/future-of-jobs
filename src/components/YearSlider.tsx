import React from 'react';
import { useStore } from '../store';
import { Z } from '../config/layers';
import { YEAR_MIN, YEAR_MAX, YEAR_RANGE } from '../config/constants';

export const YearSlider: React.FC = () => {
    const year = useStore((state) => state.year);
    const setYear = useStore((state) => state.setYear);
    const progress = ((year - YEAR_MIN) / YEAR_RANGE) * 100;

    return (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl pointer-events-auto" style={{ zIndex: Z.base }}>
            <div data-tour="tour-slider" className="bg-gray-900/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-4 md:p-6 shadow-lg">
                <div className="flex justify-between items-center mb-3 text-sm font-medium tracking-widest">
                    <span className="text-gray-500 text-xs">{YEAR_MIN}</span>
                    <span className="text-cyan-400 text-lg font-bold tabular-nums" aria-live="polite">
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
                            // #region agent log
                            fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a3c6a6'},body:JSON.stringify({sessionId:'a3c6a6',runId:'run1',hypothesisId:'H1',location:'YearSlider.tsx:35',message:'slider_on_change',data:{nextYear,prevYear:year},timestamp:Date.now()})}).catch(()=>{});
                            // #endregion
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
