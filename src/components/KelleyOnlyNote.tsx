import React from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { IconInfo } from './ui/Icons';

/**
 * Shown instead of the state map or the task split when the zoomed region
 * holds no Kelley role (see useNonKelleyFocus).
 */
export const KelleyOnlyNote: React.FC<{ continent: string; view: 'map' | 'tasks' }> = ({ continent, view }) => {
    const focusContinent = useWorldStore((s) => s.focusContinent);
    const setMapView = useStore((s) => s.setMapView);
    const what = view === 'map' ? 'The state map' : 'The task view';
    const why = view === 'map'
        ? 'It uses BLS state employment, which the app has for those roles only.'
        : 'It splits each role by its published AI scores, which cover those roles only.';
    return (
        <div className="absolute inset-0 flex items-center justify-center p-5" style={{ background: 'radial-gradient(circle at 50% 0%, #111b2b 0%, #0a0e17 70%)' }}>
            <div className="max-w-md w-full bg-gray-900/80 backdrop-blur-xl border border-cyan-400/25 rounded-2xl p-5 md:p-6 shadow-lg" role="status">
                <div className="flex items-center gap-2 mb-2">
                    <IconInfo size={16} className="text-cyan-400" />
                    <h2 className="text-white font-semibold">Available for Kelley roles for now</h2>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">
                    {what} covers the 50 Kelley business roles. {why} {CONTINENT_DISPLAY_NAMES[continent]} occupations are not in it yet.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                    <button
                        type="button"
                        onClick={() => focusContinent(null)}
                        className="px-3 py-2 min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold uppercase tracking-wider"
                    >
                        Show the 50 Kelley roles
                    </button>
                    <button
                        type="button"
                        onClick={() => setMapView('globe')}
                        className="px-3 py-2 min-h-[44px] rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-gray-200 text-xs font-semibold uppercase tracking-wider"
                    >
                        Back to 3D
                    </button>
                </div>
            </div>
        </div>
    );
};
