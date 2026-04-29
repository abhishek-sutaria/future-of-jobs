import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { initialJobs } from '../data';

// Mock dependencies
vi.mock('../utils/bls', () => ({
    fetchLaborStats: vi.fn(() => Promise.resolve(new Map())),
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

    it('should initialize seed data with expected structure', () => {
        const jobs = useStore.getState().jobs;
        expect(jobs.length).toBeGreaterThan(0);
        jobs.forEach(job => {
            expect(job.id).toBeDefined();
            expect(job.title).toBeDefined();
            expect(job.tasks.length).toBeGreaterThan(0);
        });
    });

    it('should calculate percentiles and assign volatility labels after fetchRealData', async () => {
        await useStore.getState().fetchRealData();

        const updatedJobs = useStore.getState().jobs;

        // Every job should have a salaryVolatilityLabel assigned
        updatedJobs.forEach(job => {
            expect(job.salaryVolatilityLabel).toMatch(/Critical|High|Moderate|Stable/);
        });

        // At least one job should not be "Stable" (population has variance)
        const nonStable = updatedJobs.filter(j => j.salaryVolatilityLabel !== 'Stable');
        expect(nonStable.length).toBeGreaterThan(0);
    });
});
