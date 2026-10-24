import React from 'react';
import { paySummary, payScopeNote, wageForTitle } from '../utils/wages';

/**
 * Median pay line for the role panel header, read as one quiet sentence under
 * the title ("$166,570 median annual pay · $186,910 mean"). Static bundled BLS
 * figures only (src/data/national_wages.json), so it renders at full height on
 * first paint and never shifts the panel. Provenance is the "Pay" chip below.
 */
export const RolePay: React.FC<{ title: string }> = ({ title }) => {
    const found = wageForTitle(title);
    if (!found) return null;

    const { label, headline, mean } = paySummary(found.entry);
    const scopeNote = payScopeNote(title);

    return (
        <div className="mt-1">
            {/* Two whole phrases: one line with a dot on desktop, stacked on a phone. */}
            <p className="text-sm text-gray-400 flex flex-col md:flex-row md:items-baseline md:gap-1.5">
                {headline.text ? (
                    <span className="whitespace-nowrap">
                        <span className="font-semibold text-gray-100 tabular-nums">{headline.text}</span> {label.toLowerCase()}
                    </span>
                ) : (
                    <span title={headline.reason}>{label}: not published by BLS</span>
                )}
                {mean && (
                    <span className="text-gray-500 tabular-nums whitespace-nowrap">
                        <span className="hidden md:inline" aria-hidden="true">· </span>{mean} mean
                    </span>
                )}
            </p>
            {headline.topcoded && (
                <p className="text-[11px] text-gray-500 mt-0.5">BLS does not publish wages above this cap.</p>
            )}
            {scopeNote && <p className="text-[11px] text-gray-500 mt-0.5">{scopeNote}</p>}
        </div>
    );
};
