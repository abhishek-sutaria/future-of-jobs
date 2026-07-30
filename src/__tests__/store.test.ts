import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { initialJobs } from '../data';

// Mock dependencies
vi.mock('../utils/bls', () => ({
    fetchLaborStats: vi.fn(() => Promise.resolve({ values: new Map(), source: 'live', fetchedAt: Date.now() })),
    getSeriesIdForJob: vi.fn(() => 'LEU0252881500'),
}));

vi.mock('../utils/onet', () => ({
    getRealOnetTasks: vi.fn(() => []),
    MAP_TITLE_TO_SOC: {},
}));

vi.mock('../data/geo_real.json', () => ({
    default: {}
}));

describe('Store Logic: Truth in Data', () => {
    beforeEach(() => {
        useStore.setState({
            jobs: initialJobs,
            isLoadingData: false,
            hasLoadedRealData: false
        });
    });

    // Guards the fix for the ~5-minute cold start: scores must come precomputed
    // from src/data/ai_scores.json at module load, not from a blocking live pass.
    // If this fails, either the file is missing or its schema version drifted —
    // run `npm run generate-scores`.
    it('seeds precomputed AI scores at store init, with no live scoring needed', () => {
        const initial = useStore.getInitialState();

        expect(initial.scoresSource).toBe('baked');
        expect(initial.hasAIScores).toBe(true);
        expect(initial.scoresGeneratedAt).toBeTypeOf('number');

        const scored = initial.jobs.filter((j) => j.automationCostIndex > 0);
        expect(scored.length).toBe(initial.jobs.length);

        const withFullForecast = initial.jobs.filter((j) => (j.yearlyForecast?.length ?? 0) >= 6);
        expect(withFullForecast.length).toBe(initial.jobs.length);

        // Risk must actually vary, otherwise the terrain renders one flat color.
        const indices = initial.jobs.map((j) => j.automationCostIndex);
        expect(Math.max(...indices) - Math.min(...indices)).toBeGreaterThan(0.1);
    });

    it('should initialize seed data with expected structure', () => {
        const jobs = useStore.getState().jobs;
        expect(jobs.length).toBeGreaterThan(0);
        jobs.forEach(job => {
            expect(job.id).toBeDefined();
            expect(job.title).toBeDefined();
            expect(job.tasks.length).toBeGreaterThan(0);
        });
    });

    it('keeps pending volatility labels (—) after fetchRealData when task scores are still uninitialized', async () => {
        await useStore.getState().fetchRealData();

        const updatedJobs = useStore.getState().jobs;
        expect(useStore.getState().hasLoadedRealData).toBe(true);

        const allPending = updatedJobs.every(
            (job) => job.salaryVolatilityLabel === '—' && job.humanResilienceLabel === '—',
        );
        expect(allPending).toBe(true);
    });

    it('assigns volatility labels after fetchRealData once jobs have Claude task scores', async () => {
        const varied = initialJobs.map((job, i) => {
            const highRisk = i < 25;
            return {
                ...job,
                tasks: job.tasks.map((t) => ({
                    ...t,
                    aiCapabilityScore: highRisk ? 0.85 : 0.15,
                    humanCriticalityScore: highRisk ? 0.25 : 0.75,
                })),
                automationCostIndex: highRisk ? 0.85 : 0.15,
            };
        });
        useStore.setState({ jobs: varied, hasLoadedRealData: false });

        await useStore.getState().fetchRealData();

        const updatedJobs = useStore.getState().jobs;
        updatedJobs.forEach((job) => {
            expect(job.salaryVolatilityLabel).toMatch(/Critical|High|Moderate|Stable/);
        });

        const nonStable = updatedJobs.filter((j) => j.salaryVolatilityLabel !== 'Stable');
        expect(nonStable.length).toBeGreaterThan(0);
    });
});
