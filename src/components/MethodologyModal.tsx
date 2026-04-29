import React from 'react';
import { Modal } from './ui/Modal';
import { IconBrain, IconActivity, IconTrendingUp } from './ui/Icons';

interface MethodologyModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const MethodologyModal: React.FC<MethodologyModalProps> = ({ isOpen, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Methodology & Data Benchmarks" size="md" layer="top">
            <div className="space-y-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconBrain size={18} className="text-cyan-400" />
                        <h3 className="text-base font-semibold text-cyan-400">AI Capability: Claude Analysis</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        We utilize <strong>Anthropic Claude</strong> to assess technical adaptability and generate future scenarios.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Raw Capability:</strong> Scores based on direct LLM analysis of O*NET tasks.</li>
                        <li><strong>Relative Risk:</strong> Labels are dynamic, grading on a curve (e.g. <strong>Top 25%</strong> of automated jobs are labeled "High Risk").</li>
                    </ul>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconActivity size={18} className="text-blue-400" />
                        <h3 className="text-base font-semibold text-blue-400">Economic Viability: MIT Iceberg Index</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        Just because a task <em>can</em> be automated doesn't mean it <em>will</em> be. We apply the <strong>Iceberg Index cost-model</strong> to filter out automation that isn't ROI-positive yet.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>High Cost/Complexity tasks</strong> remain human-led even if AI is capable.</li>
                        <li><strong>"Green Peaks"</strong> represent these economically insulated roles.</li>
                    </ul>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconTrendingUp size={18} className="text-emerald-400" />
                        <h3 className="text-base font-semibold text-emerald-400">Official Gov Data: BLS & O*NET</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        <strong>Height & Volume:</strong> Sourced from the <em>BLS 2024 OEWS</em> dataset.
                        <br />
                        <strong>Task Composition:</strong> Sourced from the <em>O*NET 29.0 Database</em>.
                    </p>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06] text-center">
                <p className="text-xs text-gray-500 italic">
                    "The goal is not to predict the future perfectly, but to prepare for it strategically."
                </p>
            </div>
        </Modal>
    );
};
