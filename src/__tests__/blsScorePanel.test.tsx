/**
 * A scored BLS occupation in the common role panel (JobDetailPanel via
 * utils/blsRoleJob), and an unscored one in the numbers-only panel. The score
 * below is a SYNTHETIC FIXTURE for an invented occupation (99-0001): it only
 * drives the layout, it is never written to src/data and it is not a score for
 * any real job.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import type { BlsRoleScore } from '../utils/blsScores';
import type { OccupationEntry } from '../utils/occupationIndex';

const FIXTURE: BlsRoleScore = {
    soc: '99-0001',
    title: 'Fixture Occupation',
    tasks: [
        { name: 'Fixture task A', aiCapabilityScore: 0.8, humanCriticalityScore: 0.2, onetCode: '99-0001.00', taskId: 1 },
        { name: 'Fixture task B', aiCapabilityScore: 0.2, humanCriticalityScore: 0.9, onetCode: '99-0001.00', taskId: 2 },
    ],
    automationCostIndex: 0.5,
    humanCriticality: 0.55,
    scoredAt: '2026-01-02T12:00:00.000Z',
    model: 'claude-sonnet-5',
    onetCodes: ['99-0001.00'],
};

const { OccupationBody } = await import('../components/OccupationPanel');
const { JobDetailPanel } = await import('../components/JobDetailPanel');
const { blsRoleJob } = await import('../utils/blsRoleJob');
const { roleScaleFor } = await import('../utils/allRoleScale');
const { resilienceLabelFor, rankScopeText } = await import('../utils/roleScale');
const { useStore } = await import('../store');

const occupation = {
    soc: '99-0001',
    title: 'Fixture Occupation',
    major: '99-0000',
    minor: '99-0000',
    broad: null,
    oewsRows: [],
    oewsOGroups: [],
    employment: 1000,
    annualMedian: null,
    annualMean: null,
    hourlyMedian: null,
    hourlyMean: null,
    annualPct10: null,
    annualPct90: null,
    annualOnly: false,
    hourlyOnly: false,
    topcoded: {},
    ep: null,
    onetCode: '99-0001.00',
    onetTaskSource: '.00',
    onetSubCodes: [],
    description: null,
    tasks: [],
    dedupedTasks: 0,
    aiStatus: 'fixture',
    sources: {},
    nullReasons: {},
} as unknown as OccupationEntry;

const scale = roleScaleFor(useStore.getState().jobs);
const job = blsRoleJob(occupation, FIXTURE, scale);

function render() {
    const html = renderToStaticMarkup(
        <JobDetailPanel
            job={job}
            occupation={occupation}
            analysisResult={null}
            analysisLoading={false}
            analysisError={null}
            missingApiKey={false}
            onClose={() => {}}
            onSetAnalysisResult={() => {}}
            onSetAnalysisLoading={() => {}}
            onShowMethodology={() => {}}
        />,
    );
    return new JSDOM(`<body>${html}</body>`).window.document;
}

describe('a scored BLS occupation in the common role panel', () => {
    const doc = render();
    const text = doc.body.textContent ?? '';

    it('is a role-panel Job with the published numbers and no invented ones', () => {
        expect(job.id).toBe('soc:99-0001');
        expect(job.automationCostIndex).toBe(0.5);
        expect(job.tasks.map((t) => [t.name, t.aiCapabilityScore, t.humanCriticalityScore])).toEqual([
            ['Fixture task A', 0.8, 0.2],
            ['Fixture task B', 0.2, 0.9],
        ]);
        expect(job.humanResilienceLabel).toBe(resilienceLabelFor(0.55, scale));
        // No OOH badge: the repo has OOH figures for the Kelley roles only.
        expect(job.dataSources).not.toContain('BLS-OOH-2024-34');
    });

    it('shows the same tiles as a Kelley role, ranked among all scored roles', () => {
        expect(doc.querySelector('[data-testid="ai-soon"]')).toBeNull();
        expect(text).toContain('50%');
        expect(text).toContain('55%');
        expect(text).toContain('Human Resilience');
        expect(doc.querySelector('[data-testid="rank-scope"]')!.textContent).toBe(`Rank ${rankScopeText(scale)}`);
        expect(text).not.toMatch(/Compared with the \d+ Kelley roles/);
    });

    it('splits the rated tasks into the two columns, with both scores on each', () => {
        expect(text).toContain('Fixture task A');
        expect(text).toContain('80% AI EXPOSURE');
        expect(text).toContain('20% HUMAN');
        expect(text).toContain('Fixture task B');
        expect(text).toContain('90% HUMAN');
    });

    it('offers every role feature, with no Kelley label', () => {
        const buttons = [...doc.querySelectorAll('button')].map((b) => b.textContent ?? '');
        for (const feature of ['Roadmap', 'Scenario', 'Defend this task', 'Build on this']) {
            expect(buttons.some((b) => b.includes(feature)), feature).toBe(true);
        }
        expect(doc.querySelector('[data-testid="kelley-label"]')).toBeNull();
        expect(doc.querySelector('[data-testid="occupation-about"]')).not.toBeNull();
    });
});

describe('an unscored occupation in the numbers-only panel', () => {
    const html = renderToStaticMarkup(<OccupationBody occupation={occupation} onClose={() => {}} />);
    const doc = new JSDOM(`<body>${html}</body>`).window.document;
    const text = doc.body.textContent ?? '';

    it('says Not scored and offers no Claude feature', () => {
        expect(doc.querySelector('[data-testid="ai-soon"]')!.textContent).toContain('Not scored');
        for (const word of ['Strategic Insight', 'Roadmap', 'Scenario', 'Analyze', 'Defend this task', 'Build on this', 'Likely Replacements', 'AI Exposure']) {
            expect(text, word).not.toContain(word);
        }
        // Every button is the close button, the pay note or a source badge.
        const buttons = [...doc.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`.trim());
        for (const b of buttons) expect(b).toMatch(/^(Close panel|Where the pay figure comes from|Pay|EP|O\*NET)$/);
    });
});
