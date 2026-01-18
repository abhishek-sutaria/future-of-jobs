import { create } from 'zustand';
import type { Job } from './types';
import { initialJobs } from './data';

interface AppState {
    year: number;
    setYear: (year: number) => void;
    selectedJob: Job | null;
    setSelectedJob: (job: Job | null) => void;
    jobs: Job[];
    upskillTask: (jobId: string, taskName: string) => void;
}

export const useStore = create<AppState>((set) => ({
    year: 2025,
    setYear: (year) => set({ year }),
    selectedJob: null,
    setSelectedJob: (selectedJob) => set({ selectedJob }),
    jobs: initialJobs,
    upskillTask: (jobId, taskName) => set((state) => {
        const newJobs = state.jobs.map((job) => {
            if (job.id !== jobId) return job;

            const newTasks = job.tasks.map((task) => {
                if (task.name !== taskName) return task;
                return {
                    ...task,
                    humanCriticalityScore: Math.min(1, task.humanCriticalityScore + 0.2),
                    aiCapabilityScore: Math.max(0, task.aiCapabilityScore - 0.1)
                };
            });

            return { ...job, tasks: newTasks };
        });

        // Also update selectedJob if it's the one being modified
        const newSelectedJob = state.selectedJob?.id === jobId
            ? newJobs.find(j => j.id === jobId) || null
            : state.selectedJob;

        return { jobs: newJobs, selectedJob: newSelectedJob };
    }),
}));
