import React from 'react';
import { Modal } from './ui/Modal';
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
            <p className="text-gray-400 text-sm mb-6">50 marketing &amp; business roles · 2025–2030</p>

            <div className="space-y-5 mb-8">
                <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
                        <IconLayers size={18} className="text-blue-400" />
                    </div>
                    <div>
                        <h3 className="text-white font-semibold mb-1 text-sm">Terrain Height = Workers or Human Work</h3>
                        <p className="text-gray-400 text-sm leading-relaxed">
                            Toggle Peak Height on the year slider: Workers shows implied headcount; Human work is a scenario of how much of each role still needs a person (peaks erode as modelled AI share rises).
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
                Explore the Landscape
            </button>
        </Modal>
    );
};
