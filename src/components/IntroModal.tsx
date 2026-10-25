import React from 'react';
import { Modal } from './ui/Modal';
import { INDEX_CONTINENTS, OCCUPATION_INDEX } from '../utils/occupationIndex';
import { IconLayers, IconAlertTriangle, IconSearch } from './ui/Icons';
import { useStore } from '../store';

import { UI } from '../config/constants';

const STORAGE_KEY = UI.INTRO_STORAGE_KEY;

export const IntroModal: React.FC = () => {
    const [dismissed, setDismissed] = React.useState(() => !!localStorage.getItem(STORAGE_KEY));
    const route = useStore((s) => s.route);

    // This modal explains 3D terrain and marker colour — entirely irrelevant
    // (and, since IntroModal previously had no external close path at all,
    // previously unsuppressable) on the dashboard. A first-time visitor who
    // deep-links straight to /dashboard should not see it; it still shows,
    // once, the first time they return to the map.
    const isOpen = !dismissed && route !== 'dashboard';

    const handleClose = () => {
        localStorage.setItem(STORAGE_KEY, '1');
        setDismissed(true);
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="AI & Future of Work" size="md" layer="overlay">
            <p className="text-gray-400 text-sm mb-6">All {OCCUPATION_INDEX._meta.counts.occupations} BLS occupations in {INDEX_CONTINENTS.length} fields · 2025–2035</p>

            <div className="space-y-5 mb-8">
                <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
                        <IconLayers size={18} className="text-blue-400" />
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-1 text-sm">A Globe of 22 Fields</h3>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            Each continent is one field, sized by its number of workers. Each peak is an occupation; its height is the number of jobs from BLS Employment Projections. Drag the year slider from 2025 to 2035 to follow the official path between those two levels.
                            Tap a continent to zoom into that field.
                        </p>
                    </div>
                </div>

                <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                        <IconAlertTriangle size={18} className="text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-1 text-sm">Color Indicates Relative Risk</h3>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            <span className="text-red-400">High risk markers</span> are more exposed to automation than most roles here.
                            <span className="text-emerald-400"> Safer markers</span> rank lower on that same relative scale — not immune.
                            AI scores cover the 50 Kelley business roles for now; <span className="text-slate-300">slate peaks</span> are scored soon.
                        </p>
                    </div>
                </div>

                <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                        <IconSearch size={18} className="text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-1 text-sm">Role detail</h3>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            Click any marker to open the role panel and compare AI-capable tasks with ones that still need a person.
                        </p>
                    </div>
                </div>
            </div>

            <button
                onClick={handleClose}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg transition-colors"
            >
                Explore the Globe
            </button>
        </Modal>
    );
};
