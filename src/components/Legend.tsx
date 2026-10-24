import React from 'react';
import { Z } from '../config/layers';
import { RISK_BAND_COLORS, RISK_UNSCORED_HEX } from '../config/theme';

// Now visible on all viewports. The year slider width is scaled on mobile
// to leave room for the legend. Padding/radius match YearSlider's card so
// the two bottom bars share a height when only the title + three colour
// levels are shown.
export const Legend: React.FC = () => {
    return (
        <div
            className="absolute bottom-6 right-6 flex flex-col justify-center gap-2 pointer-events-none select-none px-3 py-2 md:px-5 md:py-4 rounded-2xl border border-cyan-400/25 bg-gray-900/60 backdrop-blur-xl max-w-[160px] md:max-w-[210px]"
            style={{ zIndex: Z.base }}
            role="complementary"
            aria-label="Job Security Index legend"
        >
            <h3 className="text-[9px] md:text-[10px] uppercase text-gray-400 font-semibold tracking-wider text-right">
                Job Security Index
            </h3>

            {/* Label colours are pulled from the same constants the map dots use, so the
                legend keys both the discrete dots and the continuous terrain ramp. */}
            <div className="flex flex-row items-center gap-2 md:gap-3">
                {/* h-[77px] sized so the card matches YearSlider's measured outer height
                    (title + subtitle + year row + range) at md+ padding. */}
                <div className="flex flex-col justify-between h-[60px] md:h-[77px] text-[8px] md:text-[10px] font-medium text-right py-0.5">
                    <span style={{ color: RISK_BAND_COLORS.safe }}>Safe / Human-Centric</span>
                    <span style={{ color: RISK_BAND_COLORS.hybrid }}>Hybrid / Augmented</span>
                    <span style={{ color: RISK_BAND_COLORS.high }}>High Automation Risk</span>
                </div>

                <div
                    className="h-[60px] md:h-[77px] w-1.5 rounded-full"
                    style={{
                        backgroundImage: `linear-gradient(to bottom, ${RISK_BAND_COLORS.safe}, ${RISK_BAND_COLORS.hybrid}, ${RISK_BAND_COLORS.high})`,
                    }}
                />
            </div>

            {/* Every occupation outside the 50 Kelley roles: no score, so no
                risk colour. The slate matches RISK_UNSCORED_RGB on the peaks. */}
            <div className="flex flex-row items-center justify-end gap-2 md:gap-3 border-t border-white/[0.06] pt-1.5">
                <span className="text-[8px] md:text-[10px] font-medium text-right text-slate-400 leading-tight">
                    Not scored yet<span className="max-md:hidden"> · AI scores coming soon</span>
                </span>
                <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full shrink-0" style={{ backgroundColor: RISK_UNSCORED_HEX }} />
            </div>
        </div>
    );
};
