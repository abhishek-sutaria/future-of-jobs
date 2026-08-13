import { test, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

beforeEach(() => {
    useStore.setState({
        selectedJob: null,
    });
});

test('live Analyze with paraphrased task_text still syncs Automation Risk to the panel', () => {
    const job = useStore.getState().jobs.find((j) => j.title === 'IT Project Manager');
    expect(job).toBeTruthy();
    if (!job) return;

    // Paraphrased names (no exact match) — must still apply by index.
    useStore.getState().updateJobFromLiveAnalysis(job.id, {
        tasks: job.tasks.map((_, i) => ({
            task_text: `Paraphrased task ${i + 1}`,
            ai_exposure_score: 0.47,
            human_criticality_score: 0.80,
        })),
        yearlyForecast: [],
    });

    const updated = useStore.getState().jobs.find((j) => j.id === job.id)!;
    expect(updated.automationCostIndex).toBe(0.47);
    expect(updated.tasks.every((t) => t.aiCapabilityScore === 0.47)).toBe(true);
    // Panel display uses the same two-decimal mean.
    expect((updated.automationCostIndex * 100).toFixed(0)).toBe('47');
});
