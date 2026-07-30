import React from 'react';
import { Z } from '../config/layers';

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

            {/* Scale height reduced from h-28 to h-20: the three labels still clear each
                other comfortably, and the box gets shorter without shrinking any text. */}
            <div className="flex flex-row items-center gap-3">
                <div className="flex flex-col justify-between h-20 text-[10px] font-medium text-gray-400 text-right py-0.5">
                    <span className="text-cyan-400">Safe / Human-Centric</span>
                    <span className="text-gray-500">Hybrid / Augmented</span>
                    <span className="text-red-400">High Automation Risk</span>
                </div>

                <div className="h-20 w-1.5 rounded-full bg-gradient-to-b from-cyan-500 via-amber-500 to-red-500"></div>
            </div>

            {/* tracking-wide (not a smaller font) lets this caption fit on fewer lines. */}
            <div className="mt-1 pt-1.5 border-t border-white/[0.06] w-full text-right">
                <div className="text-[9px] text-gray-600 uppercase tracking-wide">
                    Y: Growth &middot; Color: Automation risk &middot; Regions: Career clusters
                </div>
            </div>
        </div>
    );
};
