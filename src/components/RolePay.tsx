import React from 'react';
import { paySummary, payScopeNote, wageForTitle } from '../utils/wages';

/**
 * Median pay line for the role panel header. Static bundled BLS figures only
 * (src/data/national_wages.json), so it renders at full height on first paint
 * and never shifts the panel. Provenance is the "Pay" chip beside it.
 */
export const RolePay: React.FC<{ title: string }> = ({ title }) => {
    const found = wageForTitle(title);
    if (!found) return null;

    const { label, headline, mean } = paySummary(found.entry);
    const scopeNote = payScopeNote(title);

    return (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">{label}</span>
            {headline.text ? (
                <span className="text-base font-bold tabular-nums text-white">{headline.text}</span>
            ) : (
                <span className="text-sm text-gray-400" title={headline.reason}>Not published by BLS</span>
            )}
            {mean && <span className="text-[11px] text-gray-400 tabular-nums">Mean {mean}</span>}
            {headline.topcoded && (
                <span className="text-[10px] text-gray-500">BLS does not publish wages above this cap</span>
            )}
            {scopeNote && <span className="basis-full text-[10px] text-gray-500">{scopeNote}</span>}
        </div>
    );
};
