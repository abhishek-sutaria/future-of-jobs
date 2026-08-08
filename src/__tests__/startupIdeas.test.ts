import { describe, test, expect } from 'vitest';
import { StartupIdeasSchema } from '../utils/claude';

describe('StartupIdeasSchema', () => {
    test('parses a well-formed response', () => {
        const raw = {
            founderProfile: {
                summary: 'Experienced ops leader.',
                coreSkills: ['operations', 'sales'],
                domains: ['logistics'],
                unfairAdvantages: ['industry network'],
                gaps: ['no coding'],
            },
            ideas: [
                {
                    name: 'FleetPilot',
                    summary: 'AI dispatch for small trucking firms.',
                    customer: 'Small fleet owners',
                    problem: 'Manual dispatch wastes hours.',
                    whyNow: 'Driver shortage.',
                    whyAI: 'LLMs can route.',
                    whyYou: '10 years in logistics.',
                    applicableSkills: ['operations'],
                    skillsNeeded: ['a technical co-founder'],
                    mvpPlan: 'Spreadsheet + Zapier.',
                    firstCustomerPath: 'Call 20 fleets.',
                    pricingModel: '$99/mo per fleet.',
                    pathTo10kMrr: '100 fleets.',
                    pathToScale: 'Expand to mid-market.',
                    risks: ['long sales cycle'],
                    validation: 'Pre-sell to 3 fleets.',
                    difficultyScore: 6,
                    resumeFitScore: 9,
                    revenuePotentialScore: 7,
                    recommendation: 'Pursue',
                },
            ],
            topThree: [
                {
                    name: 'FleetPilot',
                    validation48h: 'Landing page.',
                    mvp7day: 'Manual concierge.',
                    launch30day: 'Onboard 3 fleets.',
                    revenue90day: 'Hit $2k MRR.',
                    techStack: ['Airtable', 'Zapier'],
                    firstCustomers: ['Local trucking co'],
                    outreachScript: 'Hi, I help fleets...',
                    killCriteria: 'No paying customer in 60 days.',
                },
            ],
            startHere: 'Call your first 10 contacts today.',
        };

        const parsed = StartupIdeasSchema.parse(raw);
        expect(parsed.ideas).toHaveLength(1);
        expect(parsed.ideas[0].name).toBe('FleetPilot');
        expect(parsed.ideas[0].resumeFitScore).toBe(9);
        expect(parsed.topThree[0].techStack).toContain('Zapier');
        expect(parsed.founderProfile.coreSkills).toContain('sales');
    });

    test('coerces string scores and clamps out-of-range values', () => {
        const parsed = StartupIdeasSchema.parse({
            ideas: [
                {
                    name: 'Idea A',
                    difficultyScore: '8',
                    resumeFitScore: 42,
                    revenuePotentialScore: -3,
                    recommendation: 'Test',
                },
            ],
        });
        expect(parsed.ideas[0].difficultyScore).toBe(8);
        expect(parsed.ideas[0].resumeFitScore).toBe(10);
        expect(parsed.ideas[0].revenuePotentialScore).toBe(0);
    });

    test('applies defaults for missing optional fields', () => {
        const parsed = StartupIdeasSchema.parse({
            ideas: [{ name: 'Sparse Idea' }],
        });
        expect(parsed.ideas[0].applicableSkills).toEqual([]);
        expect(parsed.ideas[0].risks).toEqual([]);
        expect(parsed.topThree).toEqual([]);
        expect(parsed.founderProfile.coreSkills).toEqual([]);
        expect(parsed.startHere).toBe('');
    });

    test('rejects a response with no ideas', () => {
        expect(() => StartupIdeasSchema.parse({ ideas: [] })).toThrow();
    });
});
