import React from 'react';

export const IntroModal: React.FC = () => {
    // const show = useStore((state) => state.showIntro);
    // const setShow = useStore((state) => state.setShowIntro);
    const [isOpen, setIsOpen] = React.useState(true); // Simple local state for prototype for now

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-500">
            <div className="bg-gray-900 border border-white/10 rounded-2xl max-w-lg w-full p-8 shadow-2xl ring-1 ring-cyan-500/20">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="text-2xl font-bold font-display text-white mb-2">
                            Navigating the <span className="text-cyan-400">Intelligence Age</span>
                        </h2>
                        <p className="text-gray-400 text-sm">Strategic Workforce Intelligence • 2025-2030</p>
                    </div>
                </div>

                <div className="space-y-6 mb-8">
                    <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
                            ⛰️
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Terrain Height = Employment Volume</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                High peaks represent massive job clusters (e.g., Healthcare). Valleys represent niche or emerging roles.
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center border border-red-500/20 shrink-0">
                            ⚠️
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Color Indicates Risk</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                <span className="text-red-400">Red markers</span> indicate high automation risk.
                                <span className="text-green-400"> Green markers</span> are human-critical safe zones.
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                            🔍
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Deep Analysis</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                Click any marker to open the <strong>Command Center</strong> and view detailed AI vs. Human skills analysis.
                            </p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => setIsOpen(false)}
                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg transition-all shadow-[0_0_20px_rgba(8,145,178,0.4)] hover:shadow-[0_0_30px_rgba(8,145,178,0.6)]"
                >
                    Explore the Landscape
                </button>
            </div>
        </div>
    );
};
