import React from 'react';
import { useStore } from '../store';

interface UpskillModalProps {
    isOpen: boolean;
    onClose: () => void;
    jobId: string;
    taskName: string;
}

export const UpskillModal: React.FC<UpskillModalProps> = ({ isOpen, onClose, jobId, taskName }) => {
    const upskillTask = useStore((state) => state.upskillTask);
    const job = useStore((state) => state.jobs.find(j => j.id === jobId));

    if (!isOpen || !job) return null;

    const handleComplete = () => {
        upskillTask(jobId, taskName);
        onClose();
    };

    return (
        <div className="absolute inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md shadow-[0_0_40px_rgba(0,0,0,0.6)] relative overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">

                {/* Header with decorative image/gradient */}
                <div className="h-32 bg-gradient-to-br from-blue-600 to-purple-700 relative flex items-end p-6">
                    <div className="absolute top-4 right-4 text-white/20 text-6xl font-bold select-none">🎓</div>
                    <div>
                        <p className="text-blue-100/80 text-xs font-bold uppercase tracking-wider mb-1">Recommended Training</p>
                        <h2 className="text-2xl font-bold text-white shadow-sm">{taskName}</h2>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    <div className="space-y-3">
                        <div className="bg-white/5 border border-white/5 rounded-xl p-4 hover:bg-white/10 transition-colors cursor-pointer group">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-bold text-gray-200 group-hover:text-cyan-400 transition-colors">Advanced {taskName} Strategies</h4>
                                    <p className="text-xs text-gray-400 mt-1">Kelley School of Business • 4 Weeks</p>
                                </div>
                                <span className="text-gray-500 group-hover:text-white">↗</span>
                            </div>
                        </div>

                        <div className="bg-white/5 border border-white/5 rounded-xl p-4 hover:bg-white/10 transition-colors cursor-pointer group">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-bold text-gray-200 group-hover:text-cyan-400 transition-colors">AI & {taskName}</h4>
                                    <p className="text-xs text-gray-400 mt-1">Coursera Professional Cert • 12 Hours</p>
                                </div>
                                <span className="text-gray-500 group-hover:text-white">↗</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                        <p className="text-xs text-blue-300 flex gap-2">
                            <span>💡</span>
                            Completing this training will increase your <strong>Human Criticality</strong> score by +20% and reduce Automation Risk.
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-white/10 flex justify-end gap-3 bg-gray-900">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleComplete}
                        className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold shadow-[0_0_15px_rgba(8,145,178,0.4)] transition-all transform hover:scale-105"
                    >
                        Complete Training
                    </button>
                </div>
            </div>
        </div>
    );
};
