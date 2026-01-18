import React from 'react';

interface MethodologyModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const MethodologyModal: React.FC<MethodologyModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-gray-800/50">
                    <h2 className="text-xl font-bold text-white tracking-wide">
                        Methodology & Data Benchmarks
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">

                    {/* Section 1: GDPval */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">🤖</span>
                            <h3 className="text-lg font-bold text-cyan-400">AI Capability: OpenAI GDPval</h3>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed">
                            We utilize the <strong>GPT-4o benchmark framework (GDPval)</strong> to assess the technical feasibility of automating specific tasks.
                        </p>
                        <ul className="list-disc list-inside text-xs text-gray-400 ml-2 space-y-1">
                            <li><strong>Routine Cognitive:</strong> High automation potential (Score &gt; 0.8)</li>
                            <li><strong>Strategic/Social:</strong> Low automation potential (Score &lt; 0.3)</li>
                        </ul>
                    </div>

                    <div className="h-px bg-white/10" />

                    {/* Section 2: Iceberg Index */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">🧊</span>
                            <h3 className="text-lg font-bold text-blue-400">Economic Viability: MIT Iceberg Index</h3>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed">
                            Just because a task <em>can</em> be automated doesn't mean it <em>will</em> be. We apply the <strong>Iceberg Index cost-model</strong> to filter out automation that isn't ROI-positive for companies yet.
                        </p>
                        <ul className="list-disc list-inside text-xs text-gray-400 ml-2 space-y-1">
                            <li><strong>High Cost/Complexity tasks</strong> remain human-led even if AI is capable.</li>
                            <li><strong>"Green Peaks"</strong> in our map represent these economically insulated roles.</li>
                        </ul>
                    </div>

                    <div className="h-px bg-white/10" />

                    {/* Section 3: Labor Data */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">📊</span>
                            <h3 className="text-lg font-bold text-green-400">Official Gov Data: BLS & O*NET</h3>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed">
                            <strong>Height & Volume:</strong> Sourced directly from the <em>Bureau of Labor Statistics (BLS) 2024 OEWS</em> dataset.
                            <br />
                            <strong>Task Composition:</strong> Sourced from the <em>O*NET 29.0 Database</em>.
                        </p>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-black/40 text-center">
                    <p className="text-xs text-gray-500 italic">
                        "The goal is not to predict the future perfectly, but to prepare for it strategically." — Kelley School of Business
                    </p>
                </div>
            </div>
        </div>
    );
};
