/**
 * The scored layout of OccupationPanel, tested before any real Business &
 * Finance score exists. The score below is a SYNTHETIC FIXTURE for an invented
 * occupation (99-0001): it only drives the layout, it is never written to
 * src/data and it is not a score for any real job.
 */

import { describe, it, expect, vi } from 'vitest';
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

vi.mock('../utils/blsScores', async (importOriginal) => {
    const real = await importOriginal<typeof import('../utils/blsScores')>();
    return { ...real, blsScoreFor: (soc: string) => (soc === FIXTURE.soc ? FIXTURE : real.blsScoreFor(soc)) };
});

const { OccupationBody } = await import('../components/OccupationPanel');

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

function render() {
    const html = renderToStaticMarkup(<OccupationBody occupation={occupation} onClose={() => {}} />);
    return new JSDOM(`<body>${html}</body>`).window.document;
}

describe('scored OccupationPanel layout', () => {
    const doc = render();
    const text = doc.body.textContent ?? '';

    it('replaces "AI scores coming soon" with the score tiles', () => {
        expect(doc.querySelector('[data-testid="ai-soon"]')).toBeNull();
        expect(text).not.toContain('AI scores coming soon');
        expect(doc.querySelector('[data-testid="bls-risk"]')!.textContent).toContain('50%');
        expect(doc.querySelector('[data-testid="bls-human"]')!.textContent).toContain('55%');
    });

    it('splits the rated tasks into the two columns, with both scores on each', () => {
        const tasks = [...doc.querySelectorAll('[data-testid="bls-task"]')];
        expect(tasks).toHaveLength(2);
        expect(tasks[0].textContent).toContain('Fixture task A');
        expect(tasks[0].textContent).toContain('80% RISK');
        expect(tasks[0].textContent).toContain('20% HUMAN');
        expect(tasks[1].textContent).toContain('Fixture task B');
        expect(tasks[1].textContent).toContain('20% RISK');
    });

    it('words the rank against the 50 plainly, and leaves them alone', () => {
        const rank = doc.querySelector('[data-testid="bls-rank"]')!.textContent!;
        expect(rank).toMatch(/Compared with the 50 Kelley roles: its Automation Risk is higher than \d+ of them/);
        expect(rank).toContain('their own ranks do not change');
    });

    it('says who scored it and when', () => {
        const line = doc.querySelector('[data-testid="bls-provenance"]')!.textContent!;
        expect(line).toContain('Scored by claude-sonnet-5 on January 2, 2026');
        expect(line).toContain('no live AI call');
    });

    it('offers no Claude feature', () => {
        for (const word of ['Strategic Insight', 'Roadmap', 'Scenario', 'Analyze', 'Defend this task', 'Build on this', 'Likely Replacements']) {
            expect(text, word).not.toContain(word);
        }
        // Every button is the close button, the pay note or a source badge.
        const buttons = [...doc.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`.trim());
        for (const b of buttons) expect(b).toMatch(/^(Close panel|Where the pay figure comes from|Pay|Claude tasks|EP|O\*NET)$/);
    });
});
