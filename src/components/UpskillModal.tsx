import React from 'react';
import { useStore } from '../store';
import { Modal } from './ui/Modal';
import { IconAward, IconArrowRight, IconInfo, IconBook } from './ui/Icons';
import { Skeleton, SkeletonText } from './ui/Skeleton';
import { UPSKILL_IMPACT } from '../config/GameMechanics';
import type { UpskillCoursesResult } from '../utils/analysis';
import { useUserStore } from '../userStore';
import { toast } from './ui/Toast';

interface UpskillModalProps {
    isOpen: boolean;
    onClose: () => void;
    jobId: string;
    taskName: string;
}

export const UpskillModal: React.FC<UpskillModalProps> = ({ isOpen, onClose, jobId, taskName }) => {
    const upskillTask = useStore((state) => state.upskillTask);
    const job = useStore((state) => state.jobs.find(j => j.id === jobId));
    const recordUpskillCompletion = useUserStore((state) => state.recordUpskillCompletion);

    const [courses, setCourses] = React.useState<UpskillCoursesResult | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        if (!isOpen || !job) return;
        let mounted = true;
        setIsLoading(true);
        setCourses(null);

        import('../utils/analysis').then(({ generateUpskillCourses }) =>
            generateUpskillCourses(job.title, taskName)
        ).then(result => {
            if (mounted) { setCourses(result); setIsLoading(false); }
        }).catch(() => {
            if (mounted) setIsLoading(false);
        });

        return () => { mounted = false; };
    }, [isOpen, job?.title, taskName]);

    if (!job) return null;

    const handleComplete = () => {
        upskillTask(jobId, taskName);
        // Persisted separately from the store's in-memory score boost above —
        // without this, the boost is lost on reload AND silently erased by any
        // later Analyze run that overwrites task scores wholesale (store.ts
        // applyAnalysesToJobs). See App.tsx's re-apply effect.
        void recordUpskillCompletion(jobId, taskName);
        toast.success(
            `🏆 Leveled up! "${taskName}" is now a human-strength skill — Automation Risk just dropped.`
        );
        onClose();
    };

    const levelColor = (level: string) => {
        if (level === 'Advanced') return 'text-red-400 bg-red-500/10 border-red-500/20';
        if (level === 'Intermediate') return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="" size="md">
            {/* Header */}
            <div className="h-32 bg-gradient-to-br from-blue-600 to-purple-700 relative flex items-end p-6 -mx-6 -mt-14 mb-4">
                <div className="absolute top-4 right-4 text-white/20">
                    <IconAward size={56} />
                </div>
                <div>
                    <p className="text-blue-100/80 text-xs font-bold uppercase tracking-wider mb-1">Recommended Training</p>
                    <h2 className="text-xl font-bold text-white leading-snug">{taskName}</h2>
                </div>
            </div>

            <div className="space-y-5">
                {/* Course list */}
                <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
                        <IconBook size={11} /> Courses & Certifications
                    </p>

                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 space-y-2">
                                    <Skeleton className="h-4 w-3/4" />
                                    <SkeletonText lines={1} />
                                </div>
                            ))}
                        </div>
                    ) : courses ? (
                        <div className="space-y-3">
                            {courses.courses.map((course, i) => (
                                <div
                                    key={i}
                                    className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.06] transition-colors group"
                                >
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-gray-200 group-hover:text-cyan-400 transition-colors text-sm leading-snug">
                                                {course.title}
                                            </h4>
                                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                <span className="text-xs text-gray-400">{course.provider}</span>
                                                <span className="text-gray-600 text-xs">·</span>
                                                <span className="text-xs text-gray-500">{course.duration}</span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${levelColor(course.level)}`}>
                                                    {course.level}
                                                </span>
                                            </div>
                                        </div>
                                        <IconArrowRight size={16} className="text-gray-500 group-hover:text-white transition-colors shrink-0 mt-1" />
                                    </div>
                                </div>
                            ))}
                            {courses.whyTheseCourses && (
                                <p className="text-[11px] text-gray-500 italic px-1">{courses.whyTheseCourses}</p>
                            )}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-500 italic">Could not load courses. Try again later.</p>
                    )}
                </div>

                {/* Impact notice */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                    <p className="text-xs text-blue-300 flex items-start gap-2">
                        <IconInfo size={14} className="shrink-0 mt-0.5" />
                        <span>
                            Completing this training will increase your <strong>Human Criticality</strong> score
                            by +{UPSKILL_IMPACT.HUMAN_SCORE_BOOST * 100}% and reduce Automation Risk.
                        </span>
                    </p>
                </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-white/[0.06]">
                <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] transition-colors min-h-[44px]"
                >
                    Cancel
                </button>
                <button
                    onClick={handleComplete}
                    className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold transition-colors min-h-[44px]"
                >
                    Complete Training
                </button>
            </div>
        </Modal>
    );
};
