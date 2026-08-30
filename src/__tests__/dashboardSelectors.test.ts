/**
 * Unit tests for src/utils/dashboardSelectors.ts — the pure logic behind
 * /dashboard. No component-rendering here on purpose: this repo has no
 * @testing-library/react or jsdom (see the module's own header comment), so
 * dashboard logic is tested as plain data transforms, same as every other
 * suite in this directory.
 */

import { describe, it, expect } from 'vitest';
import {
    buildJobIndex,
    enrichSavedRoles,
    enrichViewedRoles,
    filterRows,
    sortRows,
    computePortfolioStats,
    groupTrainingByRole,
    summarizeArtifacts,
    EMPTY_FILTERS,
    type EnrichedRow,
} from '../utils/dashboardSelectors';
import { buildRiskScale } from '../config/theme';
import type { Job } from '../types';
import type { SavedRole, JobView, UpskillCompletion, StoredArtifact } from '../lib/userData';

// Minimal Job stub — only the fields these selectors touch.
function makeJob(overrides: Partial<Job> & { id: string; title: string }): Job {
    return {
        cluster: 'Business',
        employment: 100000,
        automationCostIndex: 0,
        projectedGrowth: 5,
        salaryVolatilityLabel: '—',
        humanResilienceLabel: '—',
        confidenceScore: 1,
        dataSources: [],
        isAlias: false,
        tasks: [],
        ...overrides,
    };
}

const marketingManager = makeJob({ id: 'job-15', title: 'Marketing Manager', automationCostIndex: 0.7, projectedGrowth: 7 });
const softwareDeveloper = makeJob({ id: 'job-9', title: 'Software Developer', automationCostIndex: 0.2, projectedGrowth: 16 });
const actuary = makeJob({ id: 'job-41', title: 'Actuary', automationCostIndex: 0.45, projectedGrowth: -7 });
const unscoredJob = makeJob({ id: 'job-99', title: 'Unscored Role', automationCostIndex: 0 });

const allJobs = [marketingManager, softwareDeveloper, actuary, unscoredJob];
const jobIndex = buildJobIndex(allJobs);
const riskScale = buildRiskScale(allJobs.map((j) => j.automationCostIndex));

describe('buildJobIndex', () => {
    it('maps every job by id', () => {
        expect(jobIndex.size).toBe(4);
        expect(jobIndex.get('job-15')?.title).toBe('Marketing Manager');
    });

    it('later duplicate ids overwrite earlier ones (no silent drop, no crash)', () => {
        const dup = makeJob({ id: 'job-15', title: 'Duplicate' });
        const idx = buildJobIndex([marketingManager, dup]);
        expect(idx.size).toBe(1);
        expect(idx.get('job-15')?.title).toBe('Duplicate');
    });

    it('empty input produces an empty, usable map', () => {
        const idx = buildJobIndex([]);
        expect(idx.size).toBe(0);
        expect(idx.get('anything')).toBeUndefined();
    });
});

describe('enrichSavedRoles / enrichViewedRoles', () => {
    it('joins title, cluster, risk and growth from the live job', () => {
        const saved: SavedRole[] = [{ jobId: 'job-15', jobTitle: 'Marketing Manager', createdAt: '2026-01-01T00:00:00Z' }];
        const [row] = enrichSavedRoles(saved, jobIndex, riskScale);
        expect(row.job?.title).toBe('Marketing Manager');
        expect(row.cluster).toBe('Marketing');
        expect(row.automationCostIndex).toBe(0.7);
        expect(row.projectedGrowth).toBe(7);
        expect(row.riskBand).not.toBeNull();
        expect(row.createdAt).toBe('2026-01-01T00:00:00Z');
    });

    it('a role no longer in the dataset degrades to nulls instead of crashing', () => {
        const saved: SavedRole[] = [{ jobId: 'job-gone', jobTitle: 'Deleted Role', createdAt: '2026-01-01T00:00:00Z' }];
        const [row] = enrichSavedRoles(saved, jobIndex, riskScale);
        expect(row.job).toBeNull();
        expect(row.cluster).toBeNull();
        expect(row.automationCostIndex).toBeNull();
        expect(row.riskBand).toBeNull();
        expect(row.jobTitle).toBe('Deleted Role'); // falls back to the stored title
    });

    it('an unscored job (automationCostIndex 0, pending baseline) gets a null riskBand, not a false "safe"', () => {
        const saved: SavedRole[] = [{ jobId: 'job-99', jobTitle: 'Unscored Role', createdAt: '2026-01-01T00:00:00Z' }];
        const [row] = enrichSavedRoles(saved, jobIndex, riskScale);
        expect(row.job).not.toBeNull();
        expect(row.riskBand).toBeNull();
    });

    it('viewed rows carry viewCount/lastViewedAt instead of createdAt', () => {
        const views: JobView[] = [{ jobId: 'job-9', jobTitle: 'Software Developer', viewCount: 4, lastViewedAt: '2026-02-01T00:00:00Z' }];
        const [row] = enrichViewedRoles(views, jobIndex, riskScale);
        expect(row.viewCount).toBe(4);
        expect(row.lastViewedAt).toBe('2026-02-01T00:00:00Z');
        expect(row.createdAt).toBeUndefined();
    });
});

describe('filterRows', () => {
    const rows: EnrichedRow[] = enrichSavedRoles(
        [
            { jobId: 'job-15', jobTitle: 'Marketing Manager', createdAt: '2026-01-01T00:00:00Z' },
            { jobId: 'job-9', jobTitle: 'Software Developer', createdAt: '2026-01-02T00:00:00Z' },
            { jobId: 'job-41', jobTitle: 'Actuary', createdAt: '2026-01-03T00:00:00Z' },
        ],
        jobIndex,
        riskScale
    );

    it('empty filters return everything', () => {
        expect(filterRows(rows, EMPTY_FILTERS)).toHaveLength(3);
    });

    it('query matches case-insensitively as a substring', () => {
        expect(filterRows(rows, { ...EMPTY_FILTERS, query: 'MARKETING' })).toHaveLength(1);
        // 'an' only occurs in "Manager" (Marketing Manager) — not Software Developer or Actuary.
        expect(filterRows(rows, { ...EMPTY_FILTERS, query: 'an' })).toHaveLength(1);
    });

    it('a query matching nothing returns an empty array, not all rows', () => {
        expect(filterRows(rows, { ...EMPTY_FILTERS, query: 'zzz-no-match' })).toHaveLength(0);
    });

    it('cluster facet filters correctly using the real functional cluster, not the useless Job.cluster field', () => {
        const result = filterRows(rows, { ...EMPTY_FILTERS, clusters: new Set(['Information Technology']) });
        expect(result.map((r) => r.jobTitle)).toEqual(['Software Developer']);
    });

    it('multiple facets intersect (AND, not OR)', () => {
        const result = filterRows(rows, {
            query: 'a',
            clusters: new Set(['Finance']),
            riskBands: new Set(),
        });
        // "a" matches Marketing Manager and Actuary by substring; only Actuary is Finance.
        expect(result.map((r) => r.jobTitle)).toEqual(['Actuary']);
    });

    it('a row with no resolvable riskBand never matches a riskBand facet', () => {
        const withUnscored = enrichSavedRoles(
            [{ jobId: 'job-99', jobTitle: 'Unscored Role', createdAt: '2026-01-01T00:00:00Z' }],
            jobIndex,
            riskScale
        );
        const result = filterRows(withUnscored, { ...EMPTY_FILTERS, riskBands: new Set(['safe', 'hybrid', 'high']) });
        expect(result).toHaveLength(0);
    });
});

describe('sortRows', () => {
    const rows: EnrichedRow[] = enrichSavedRoles(
        [
            { jobId: 'job-15', jobTitle: 'Marketing Manager', createdAt: '2026-01-01T00:00:00Z' },
            { jobId: 'job-9', jobTitle: 'Software Developer', createdAt: '2026-01-03T00:00:00Z' },
            { jobId: 'job-41', jobTitle: 'Actuary', createdAt: '2026-01-02T00:00:00Z' },
        ],
        jobIndex,
        riskScale
    );

    it('sorts by title ascending/descending', () => {
        expect(sortRows(rows, 'title', 'asc').map((r) => r.jobTitle)).toEqual(['Actuary', 'Marketing Manager', 'Software Developer']);
        expect(sortRows(rows, 'title', 'desc').map((r) => r.jobTitle)).toEqual(['Software Developer', 'Marketing Manager', 'Actuary']);
    });

    it('sorts by date (createdAt)', () => {
        expect(sortRows(rows, 'date', 'desc').map((r) => r.jobTitle)).toEqual(['Software Developer', 'Actuary', 'Marketing Manager']);
    });

    it('sorts by risk and by growth', () => {
        expect(sortRows(rows, 'risk', 'desc').map((r) => r.jobTitle)).toEqual(['Marketing Manager', 'Actuary', 'Software Developer']);
        expect(sortRows(rows, 'growth', 'asc').map((r) => r.jobTitle)).toEqual(['Actuary', 'Marketing Manager', 'Software Developer']);
    });

    it('is stable and does not mutate the input array', () => {
        const original = [...rows];
        sortRows(rows, 'title', 'asc');
        expect(rows).toEqual(original);
    });

    it('rows with a missing sort field sort last regardless of direction', () => {
        const withMissing = enrichSavedRoles(
            [
                { jobId: 'job-15', jobTitle: 'Marketing Manager', createdAt: '2026-01-01T00:00:00Z' },
                { jobId: 'job-gone', jobTitle: 'Deleted Role', createdAt: '2026-01-01T00:00:00Z' },
            ],
            jobIndex,
            riskScale
        );
        expect(sortRows(withMissing, 'risk', 'asc').at(-1)?.jobTitle).toBe('Deleted Role');
        expect(sortRows(withMissing, 'risk', 'desc').at(-1)?.jobTitle).toBe('Deleted Role');
    });
});

describe('computePortfolioStats', () => {
    it('computes the mean automation risk across saved, scored roles', () => {
        const saved: SavedRole[] = [
            { jobId: 'job-15', jobTitle: 'Marketing Manager', createdAt: '2026-01-01T00:00:00Z' }, // 0.7
            { jobId: 'job-9', jobTitle: 'Software Developer', createdAt: '2026-01-01T00:00:00Z' }, // 0.2
        ];
        const stats = computePortfolioStats(saved, [], [], jobIndex);
        expect(stats.savedCount).toBe(2);
        expect(stats.averageRisk).toBeCloseTo(0.45, 5);
    });

    it('an empty saved list produces averageRisk: null, never NaN', () => {
        const stats = computePortfolioStats([], [], [], jobIndex);
        expect(stats.averageRisk).toBeNull();
        expect(Number.isNaN(stats.averageRisk)).toBe(false);
    });

    it('unscored saved roles are excluded from the average, not treated as 0 risk', () => {
        const saved: SavedRole[] = [{ jobId: 'job-99', jobTitle: 'Unscored Role', createdAt: '2026-01-01T00:00:00Z' }];
        const stats = computePortfolioStats(saved, [], [], jobIndex);
        expect(stats.averageRisk).toBeNull();
    });

    it('counts explored and trained independently of saved', () => {
        const views: JobView[] = [{ jobId: 'job-9', jobTitle: 'Software Developer', viewCount: 1, lastViewedAt: '2026-01-01T00:00:00Z' }];
        const completions: UpskillCompletion[] = [
            { jobId: 'job-15', taskName: 'Task A', completedAt: '2026-01-01T00:00:00Z' },
            { jobId: 'job-15', taskName: 'Task B', completedAt: '2026-01-02T00:00:00Z' },
        ];
        const stats = computePortfolioStats([], views, completions, jobIndex);
        expect(stats.exploredCount).toBe(1);
        expect(stats.trainedCount).toBe(2);
    });
});

describe('groupTrainingByRole', () => {
    it('joins job_title by id, since upskill_completions has no title column', () => {
        const completions: UpskillCompletion[] = [
            { jobId: 'job-15', taskName: 'Draft ad copy', completedAt: '2026-01-01T00:00:00Z' },
            { jobId: 'job-15', taskName: 'Compile lists', completedAt: '2026-01-02T00:00:00Z' },
            { jobId: 'job-9', taskName: 'Write tests', completedAt: '2026-01-03T00:00:00Z' },
        ];
        const groups = groupTrainingByRole(completions, jobIndex);
        expect(groups).toHaveLength(2);
        const marketing = groups.find((g) => g.jobId === 'job-15');
        expect(marketing?.jobTitle).toBe('Marketing Manager');
        expect(marketing?.cluster).toBe('Marketing');
        expect(marketing?.completions).toHaveLength(2);
    });

    it('a completion for a role no longer in the dataset gets a placeholder title, not a crash', () => {
        const completions: UpskillCompletion[] = [{ jobId: 'job-gone', taskName: 'Some task', completedAt: '2026-01-01T00:00:00Z' }];
        const [group] = groupTrainingByRole(completions, jobIndex);
        expect(group.jobTitle).toBe('(role no longer available)');
        expect(group.cluster).toBeNull();
    });

    it('empty input produces an empty array', () => {
        expect(groupTrainingByRole([], jobIndex)).toEqual([]);
    });
});

describe('summarizeArtifacts', () => {
    const base = { id: 'a1', jobId: 'job-15', jobTitle: 'Marketing Manager', cacheKey: 'job-15', updatedAt: '2026-01-01T00:00:00Z' };

    it('extracts a preview from a scenario payload', () => {
        const artifacts: StoredArtifact[] = [{ ...base, kind: 'scenario', payload: { story: 'In 2030, you spend your mornings...', keyChanges: [] } }];
        const [summary] = summarizeArtifacts(artifacts);
        expect(summary.preview).toContain('In 2030');
        expect(summary.kind).toBe('scenario');
    });

    it('extracts a preview from a roadmap payload (first phase title)', () => {
        const artifacts: StoredArtifact[] = [{ ...base, kind: 'roadmap', payload: { phases: [{ title: 'Phase 1: Foundations', items: [] }] } }];
        const [summary] = summarizeArtifacts(artifacts);
        expect(summary.preview).toBe('Phase 1: Foundations');
    });

    it('extracts a preview from a startup-ideas payload (founder summary)', () => {
        const artifacts: StoredArtifact[] = [{ ...base, kind: 'startup_ideas', payload: { founderProfile: { summary: 'A data-driven operator with...' } } }];
        const [summary] = summarizeArtifacts(artifacts);
        expect(summary.preview).toContain('data-driven operator');
    });

    it('truncates long previews with an ellipsis rather than overflowing a card', () => {
        const longStory = 'x'.repeat(300);
        const artifacts: StoredArtifact[] = [{ ...base, kind: 'scenario', payload: { story: longStory, keyChanges: [] } }];
        const [summary] = summarizeArtifacts(artifacts);
        expect(summary.preview.length).toBeLessThan(160);
        expect(summary.preview.endsWith('…')).toBe(true);
    });

    it('an unrecognised/empty payload shape produces an empty preview, not a crash', () => {
        const artifacts: StoredArtifact[] = [{ ...base, kind: 'skills_analysis', payload: {} }];
        const [summary] = summarizeArtifacts(artifacts);
        expect(summary.preview).toBe('');
    });
});
