import React from 'react';
import { Z } from '../config/layers';

export const Legend: React.FC = () => {
    return (
        <div
            className="absolute bottom-6 right-6 flex flex-col items-end gap-2 pointer-events-none select-none p-4 rounded-xl border border-cyan-400/15 bg-gray-900/60 backdrop-blur-md max-w-[210px]"
            style={{ zIndex: Z.base }}
            role="complementary"
            aria-label="Job Security Index legend"
        >
            <h3 className="text-[10px] uppercase text-gray-400 font-semibold tracking-wider mb-1.5 text-right">
                Job Security Index
            </h3>

            <div className="flex flex-row items-center gap-3">
                <div className="flex flex-col justify-between h-28 text-[10px] font-medium text-gray-400 text-right py-0.5">
                    <span className="text-cyan-400">Safe / Human-Centric</span>
                    <span className="text-gray-500">Hybrid / Augmented</span>
                    <span className="text-red-400">High Automation Risk</span>
                </div>

                <div className="h-28 w-1.5 rounded-full bg-gradient-to-b from-cyan-500 via-amber-500 to-red-500"></div>
            </div>

            <div className="mt-1.5 pt-1.5 border-t border-white/[0.06] w-full text-right">
                <div className="text-[9px] text-gray-600 uppercase tracking-widest">
                    Y: Growth &middot; Color: Automation risk &middot; Regions: Career clusters
                </div>
            </div>
        </div>
    );
};
