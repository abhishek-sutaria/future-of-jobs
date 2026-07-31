import React from 'react';
import { Z } from '../config/layers';
import { RISK_BAND_COLORS } from '../config/theme';

// Hidden below md: at 390px this 210px panel covers the terrain and squeezes the
// time slider down to an unusable width. The colour scale is also explained in the
// intro modal, so phones lose nothing critical.
export const Legend: React.FC = () => {
    return (
        <div
            className="absolute bottom-6 right-6 hidden md:flex flex-col items-end gap-1.5 pointer-events-none select-none p-3 rounded-xl border border-cyan-400/15 bg-gray-900/60 backdrop-blur-md max-w-[210px]"
            style={{ zIndex: Z.base }}
            role="complementary"
            aria-label="Job Security Index legend"
        >
            <h3 className="text-[10px] uppercase text-gray-400 font-semibold tracking-wider text-right">
                Job Security Index
            </h3>

            {/* Label colours are pulled from the same constants the map dots use, so the
                legend keys both the discrete dots and the continuous terrain ramp. */}
            <div className="flex flex-row items-center gap-3">
                <div className="flex flex-col justify-between h-20 text-[10px] font-medium text-right py-0.5">
                    <span style={{ color: RISK_BAND_COLORS.safe }}>Safe / Human-Centric</span>
                    <span style={{ color: RISK_BAND_COLORS.hybrid }}>Hybrid / Augmented</span>
                    <span style={{ color: RISK_BAND_COLORS.high }}>High Automation Risk</span>
                </div>

                <div
                    className="h-20 w-1.5 rounded-full"
                    style={{
                        backgroundImage: `linear-gradient(to bottom, ${RISK_BAND_COLORS.safe}, ${RISK_BAND_COLORS.hybrid}, ${RISK_BAND_COLORS.high})`,
                    }}
                />
            </div>

            {/* Colour is banded against the other roles shown, not an absolute risk
                percentage — saying so keeps the scale honest. */}
            <div className="mt-1 pt-1.5 border-t border-white/[0.06] w-full text-right">
                <div className="text-[9px] text-gray-600 uppercase tracking-wide">
                    Height: growth vs 2025 &middot; Colour: automation risk, relative to all roles &middot; Regions: career clusters
                </div>
            </div>
        </div>
    );
};
