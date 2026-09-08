/**
 * The export path is the whole point of the dashboard for anyone who needs to
 * hand a report to someone else, so it is pure and fully covered here: no
 * payload field may be silently dropped, and no payload shape may throw.
 */

import { describe, it, expect } from 'vitest';
import { reportToMarkdown, reportFilename } from '../utils/reportExport';
import type { StoredArtifact } from '../lib/userData';

const base = { id: 'a1', cacheKey: 'k', updatedAt: '2026-09-07T12:00:00.000Z' };

const scenario: StoredArtifact = {
    ...base, kind: 'scenario', jobId: 'job-14', jobTitle: 'Brand Manager',
    payload: { story: 'A day in 2030.', keyChanges: ['AI drafts copy', 'Humans own brand judgment'] },
};
const roadmap: StoredArtifact = {
    ...base, kind: 'roadmap', jobId: 'job-14', jobTitle: 'Brand Manager',
    payload: {
        phases: [{ title: 'Month 1-2', items: ['Audit exposure', 'Pick a lane'] }],
        resources: [{ category: 'Courses', items: ['Coursera: AI for Marketers'] }],
        successMetrics: ['Ship one AI-assisted campaign'],
    },
};
const skills: StoredArtifact = {
    ...base, kind: 'skills_analysis', jobId: null, jobTitle: null,
    payload: { feedback: 'Solid generalist.', strengths: ['Positioning'], gaps: ['SQL'], plan: 'Specialise.' },
};
const startup: StoredArtifact = {
    ...base, kind: 'startup_ideas', jobId: null, jobTitle: null,
    payload: {
        founderProfile: { summary: 'Marketer turned operator.', coreSkills: ['Positioning'], domains: ['B2B'], unfairAdvantages: ['Network'], gaps: ['Engineering'] },
        startHere: 'Talk to 10 buyers.',
        ideas: [{ name: 'BrandOps', summary: 'Ops for brand teams.' }],
        topThree: [{
            name: 'BrandOps', validation48h: 'Cold-DM 20 CMOs', mvp7day: 'Airtable + Zapier',
            launch30day: 'Beta with 3 teams', revenue90day: 'Three paying pilots',
            techStack: ['Next.js'], firstCustomers: ['Series-B CMOs'],
            outreachScript: 'Hi X, noticed Y...', killCriteria: 'No paid pilot by day 90',
        }],
    },
};

describe('reportToMarkdown', () => {
    it('renders a scenario in full', () => {
        const md = reportToMarkdown(scenario);
        expect(md).toContain('# Day in the Life: Brand Manager');
        expect(md).toContain('A day in 2030.');
        expect(md).toContain('1. AI drafts copy');
        expect(md).toContain('2. Humans own brand judgment');
    });

    it('renders a roadmap in full', () => {
        const md = reportToMarkdown(roadmap);
        for (const s of ['Month 1-2', 'Audit exposure', 'Pick a lane', 'Courses', 'Coursera: AI for Marketers', 'Ship one AI-assisted campaign']) {
            expect(md).toContain(s);
        }
    });

    it('renders a skills analysis in full', () => {
        const md = reportToMarkdown(skills);
        for (const s of ['Solid generalist.', 'Positioning', 'SQL', 'Specialise.']) expect(md).toContain(s);
    });

    it('renders every startup field, including the execution detail the viewer used to drop', () => {
        const md = reportToMarkdown(startup);
        for (const s of [
            'Marketer turned operator.', 'Positioning', 'B2B', 'Network', 'Engineering',
            'Talk to 10 buyers.', 'BrandOps', 'Ops for brand teams.',
            'Cold-DM 20 CMOs', 'Airtable + Zapier', 'Beta with 3 teams', 'Three paying pilots',
            'Next.js', 'Series-B CMOs', 'Hi X, noticed Y...', 'No paid pilot by day 90',
        ]) {
            expect(md).toContain(s);
        }
    });

    it('degrades gracefully on empty payloads instead of emitting undefined', () => {
        for (const kind of ['scenario', 'roadmap', 'skills_analysis', 'startup_ideas'] as const) {
            const md = reportToMarkdown({ ...base, kind, jobId: null, jobTitle: null, payload: {} });
            expect(md).not.toMatch(/undefined|\[object Object\]/);
            expect(md.trim().length).toBeGreaterThan(0);
        }
    });

    it('never leaves a run of blank lines', () => {
        expect(reportToMarkdown(startup)).not.toMatch(/\n{3,}/);
    });
});

describe('reportFilename', () => {
    it('is readable, dated and safe', () => {
        expect(reportFilename(scenario)).toBe('future-of-jobs-scenario-brand-manager-2026-09-07.md');
    });

    it('says "resume" when there is no role', () => {
        expect(reportFilename(skills)).toBe('future-of-jobs-skills-analysis-resume-2026-09-07.md');
    });

    it('strips characters a filesystem would object to', () => {
        const messy = { ...scenario, jobTitle: 'Sales / Ops & "Growth" Lead' };
        const name = reportFilename(messy);
        expect(name).not.toMatch(/[/\\?%*:|"<>&]/);
        expect(name).toContain('sales-ops-growth-lead');
    });
});
