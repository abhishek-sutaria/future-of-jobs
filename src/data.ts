import type { Job, JobStatus } from './types';

// Deterministic mock data
export const initialJobs: Job[] = [
    // --- MARKETING & SALES (Primary Focus) ---
    {
        // PRESERVED ID for Navigation Compatibility
        id: 'job-15',
        title: 'Marketing Associate', // Aligning with Undergrad entry-level
        cluster: 'Marketing',
        employment: 400000,
        automationCostIndex: 0.5,
        projectedGrowth: -2.5,
        salaryVolatilityLabel: 'Medium',
        humanResilienceLabel: 'High',
        tasks: [
            { name: 'Campaign Logic', aiCapabilityScore: 0.8, humanCriticalityScore: 0.3 },
            { name: 'Creative Strategy', aiCapabilityScore: 0.3, humanCriticalityScore: 0.9 },
        ],
    },
    {
        id: 'job-11',
        title: 'Assoc. Brand Manager', // Undergrads start as ABMs or Analysts
        cluster: 'Marketing',
        employment: 150000,
        automationCostIndex: 0.6,
        projectedGrowth: 5.5,
        salaryVolatilityLabel: 'Low',
        humanResilienceLabel: 'Very High',
        tasks: [
            { name: 'Brand Voice', aiCapabilityScore: 0.4, humanCriticalityScore: 0.8 },
            { name: 'Market Tracking', aiCapabilityScore: 0.85, humanCriticalityScore: 0.2 },
        ],
    },
    {
        id: 'job-12',
        title: 'Digital Mktg Specialist', // Matches "Digital Marketing" category
        cluster: 'Marketing',
        employment: 600000,
        automationCostIndex: 0.2, // Highly automatable via GenAI
        projectedGrowth: 0.8,
        salaryVolatilityLabel: 'High',
        humanResilienceLabel: 'Low',
        tasks: [
            { name: 'SEQ/Ad Ops', aiCapabilityScore: 0.9, humanCriticalityScore: 0.1 },
            { name: 'Content Gen', aiCapabilityScore: 0.85, humanCriticalityScore: 0.3 },
        ],
    },
    {
        id: 'job-13',
        title: 'Sales Representative', // Matches "Sales" category
        cluster: 'Sales',
        employment: 900000,
        automationCostIndex: 0.4,
        projectedGrowth: -5.0,
        salaryVolatilityLabel: 'High',
        humanResilienceLabel: 'Medium',
        tasks: [
            { name: 'Lead Gen', aiCapabilityScore: 0.9, humanCriticalityScore: 0.1 },
            { name: 'Closing', aiCapabilityScore: 0.2, humanCriticalityScore: 0.9 },
        ],
    },
    {
        id: 'job-19',
        title: 'Project Manager',
        cluster: 'Business',
        employment: 1000000,
        automationCostIndex: 0.45,
        projectedGrowth: 4.0,
        salaryVolatilityLabel: 'Low',
        humanResilienceLabel: 'Very High',
        tasks: [
            { name: 'Scheduling', aiCapabilityScore: 0.85, humanCriticalityScore: 0.2 },
            { name: 'Stakeholder Mgmt', aiCapabilityScore: 0.3, humanCriticalityScore: 0.9 },
        ],
    },

    // --- STRATEGY & CONSULTING ---
    {
        id: 'job-6',
        title: 'Management Consultant',
        cluster: 'Consulting',
        employment: 700000,
        automationCostIndex: 0.5,
        projectedGrowth: 6.5,
        salaryVolatilityLabel: 'Medium',
        humanResilienceLabel: 'High',
        tasks: [
            { name: 'Data Analysis', aiCapabilityScore: 0.9, humanCriticalityScore: 0.2 },
            { name: 'Client Strategy', aiCapabilityScore: 0.3, humanCriticalityScore: 0.9 },
        ],
    },
    {
        id: 'job-7',
        title: 'Market Research Analyst', // Matches "Market Research" category
        cluster: 'Consulting',
        employment: 120000,
        automationCostIndex: 0.6,
        projectedGrowth: 7.8,
        salaryVolatilityLabel: 'Low',
        humanResilienceLabel: 'Moderate',
        tasks: [
            { name: 'Consumer Insight', aiCapabilityScore: 0.5, humanCriticalityScore: 0.8 },
            { name: 'Trend Analysis', aiCapabilityScore: 0.8, humanCriticalityScore: 0.4 },
        ],
    },
    {
        id: 'job-8',
        title: 'Business Analyst',
        cluster: 'Consulting',
        employment: 850000,
        automationCostIndex: 0.5, // Increased logic complexity -> Resists pure automation
        projectedGrowth: 6.0,
        salaryVolatilityLabel: 'Medium',
        humanResilienceLabel: 'High',
        tasks: [
            { name: 'Requirements', aiCapabilityScore: 0.6, humanCriticalityScore: 0.6 },
            { name: 'Process Mapping', aiCapabilityScore: 0.7, humanCriticalityScore: 0.3 },
        ],
    },

    // --- FINANCE ---
    {
        id: 'job-1',
        title: 'Investment Banker',
        cluster: 'Finance',
        employment: 150000,
        automationCostIndex: 0.3, // High AI adoption in modeling/trading
        projectedGrowth: 3.2,
        salaryVolatilityLabel: 'Very High',
        humanResilienceLabel: 'Medium',
        tasks: [
            { name: 'Financial Modeling', aiCapabilityScore: 0.9, humanCriticalityScore: 0.2 },
            { name: 'Deal Structuring', aiCapabilityScore: 0.4, humanCriticalityScore: 0.9 },
        ],
    },
    {
        id: 'job-4',
        title: 'Wealth Manager',
        cluster: 'Finance',
        employment: 300000,
        automationCostIndex: 0.5,
        projectedGrowth: 4.5,
        salaryVolatilityLabel: 'Medium',
        humanResilienceLabel: 'High',
        tasks: [
            { name: 'Portfolio Alloc.', aiCapabilityScore: 0.85, humanCriticalityScore: 0.3 },
            { name: 'Client Advising', aiCapabilityScore: 0.2, humanCriticalityScore: 0.9 },
        ],
    },

    // --- TECH & PRODUCT ---
    {
        id: 'job-14',
        title: 'Product Manager',
        cluster: 'Tech',
        employment: 350000,
        automationCostIndex: 0.6,
        projectedGrowth: 9.0,
        salaryVolatilityLabel: 'Low',
        humanResilienceLabel: 'Critical',
        tasks: [
            { name: 'Roadmapping', aiCapabilityScore: 0.5, humanCriticalityScore: 0.8 },
            { name: 'User Stories', aiCapabilityScore: 0.7, humanCriticalityScore: 0.4 },
        ],
    },
    {
        id: 'job-10', // Swapped ID slot
        title: 'Data Scientist (Biz)',
        cluster: 'Tech',
        employment: 200000,
        automationCostIndex: 0.3,
        projectedGrowth: 12.5,
        salaryVolatilityLabel: 'High',
        humanResilienceLabel: 'High',
        tasks: [
            { name: 'Algorithm Dev', aiCapabilityScore: 0.8, humanCriticalityScore: 0.4 },
            { name: 'Insight Story', aiCapabilityScore: 0.3, humanCriticalityScore: 0.9 },
        ],
    },

    // --- OPERATIONS & LEADERSHIP ---
    {
        id: 'job-16',
        title: 'Supply Chain Mgr',
        cluster: 'Ops',
        employment: 300000,
        automationCostIndex: 0.35,
        projectedGrowth: 5.0,
        salaryVolatilityLabel: 'Medium',
        humanResilienceLabel: 'Medium',
        tasks: [
            { name: 'Logistics Opt', aiCapabilityScore: 0.9, humanCriticalityScore: 0.2 },
            { name: 'Vendor Rel.', aiCapabilityScore: 0.4, humanCriticalityScore: 0.8 },
        ],
    },
    {
        id: 'job-18',
        title: 'HR Business Partner',
        cluster: 'Leadership',
        employment: 180000,
        automationCostIndex: 0.7,
        projectedGrowth: 3.5,
        salaryVolatilityLabel: 'Low',
        humanResilienceLabel: 'Critical',
        tasks: [
            { name: 'Org Design', aiCapabilityScore: 0.4, humanCriticalityScore: 0.8 },
            { name: 'Conflict Res.', aiCapabilityScore: 0.1, humanCriticalityScore: 0.95 },
        ],
    },
    {
        id: 'job-20',
        title: 'Corporate Strategist',
        cluster: 'Leadership',
        employment: 50000,
        automationCostIndex: 0.7,
        projectedGrowth: 2.8,
        salaryVolatilityLabel: 'Low',
        humanResilienceLabel: 'Critical',
        tasks: [
            { name: 'Vision Setting', aiCapabilityScore: 0.1, humanCriticalityScore: 1.0 },
            { name: 'M&A Strategy', aiCapabilityScore: 0.4, humanCriticalityScore: 0.8 },
        ],
    },
];

/**
 * Calculates the risk status of a job for a given year.
 * Logic is deterministic based on AI Capability, Human Criticality, and Automation Cost.
 */
export function getJobStatus(job: Job, year: number): JobStatus {
    // 1. Calculate Average Scores
    const totalAiScore = job.tasks.reduce((sum, t) => sum + t.aiCapabilityScore, 0);
    const totalHumanScore = job.tasks.reduce((sum, t) => sum + t.humanCriticalityScore, 0);

    const avgAiCapability = totalAiScore / job.tasks.length;
    const avgHumanCriticality = totalHumanScore / job.tasks.length;

    // 2. Risk Logic Rules
    // Red (High Risk): High AI Capability AND Low Automation Cost
    const isHighRisk = avgAiCapability > 0.7 && job.automationCostIndex < 0.4;

    // Green (Insulated): High Human Criticality OR High Automation Cost
    const isInsulated = avgHumanCriticality > 0.6 || job.automationCostIndex > 0.6;

    let riskScore = 0.5; // Default Medium
    let color = '#fbbf24'; // amber-400 (medium)

    if (isHighRisk) {
        riskScore = 0.9;
        color = '#ef4444'; // red-500
    } else if (isInsulated) {
        riskScore = 0.1;
        color = '#22c55e'; // green-500
    } else {
        // Medium risk - calculate a score between 0.3 and 0.7 based on factors
        riskScore = 0.3 + (avgAiCapability * 0.4);
        color = '#3b82f6'; // blue-500 (safe-ish / transformed) or just Yellow?
        // User requested Red -> Yellow -> Green scale.
        // If not Red and not Green, let's stick to Yellow/Amber.
        color = '#fbbf24';
    }

    // User requirement: "Year-aware (risk can evolve from 2025 -> 2030 via mock trends)"
    // Let's implement a simple trend: AI Capability effectively increases over time.
    // We can simulate this by slightly increasing the perceived AI score in the logic, 
    // or just by modifying the output risk score slightly.
    // For this "Phase 1" strict implementation, let's keep it clean but add a modifier.

    const yearsPassed = year - 2025;

    // Logic: As time passes, automation gets cheaper (cost index drops) 
    // BUT humans also adapt/upskill (human score effectively rises for survival).

    // Adaptation Factor: Humans shift focus to higher value tasks over time.
    // We simulate this by boosting the effective human criticality score.
    const adaptationBoost = yearsPassed * 0.05; // Significant boost over 5 years (+0.25)

    const projectedAiCap = Math.min(1, avgAiCapability + (yearsPassed * 0.02));
    const projectedCost = Math.max(0, job.automationCostIndex - (yearsPassed * 0.02));
    const effectiveHumanCriticality = Math.min(1, avgHumanCriticality + adaptationBoost);

    // Re-evaluate Risk with Projected Values
    const isProjectedHighRisk = projectedAiCap > 0.7 && projectedCost < 0.4;
    const isProjectedInsulated = effectiveHumanCriticality > 0.7 || projectedCost > 0.6;

    if (isProjectedInsulated) {
        // TURN GREEN: Adaptation successful
        riskScore = 0.2;
        color = '#22c55e'; // green-500
    } else if (isProjectedHighRisk) {
        // Stay Red / High Risk
        riskScore = 0.9;
        color = '#ef4444';
    } else {
        // Transition / Yellow
        riskScore = 0.5;
        color = '#fbbf24';
    }

    return {
        riskScore,
        color
    };
}

export type TaskCategory = 'Automatable' | 'Augmentable' | 'Human-Critical';

export function getTaskCategory(task: { aiCapabilityScore: number; humanCriticalityScore: number }, year: number): TaskCategory {
    const yearsPassed = year - 2025;
    const projectedAiCap = Math.min(1, task.aiCapabilityScore + (yearsPassed * 0.02));

    // ADAPTATION: Task itself becomes more human-centric as routine parts are automated
    const adaptationBoost = yearsPassed * 0.05;
    const effectiveHumanScore = Math.min(1, task.humanCriticalityScore + adaptationBoost);

    // Logic matches Plan + Adaptation:
    // Automatable: High AI (>0.7) AND Low Effective Human (<0.5)
    // Human-Critical: High Effective Human (>0.6)

    if (projectedAiCap > 0.7 && effectiveHumanScore < 0.5) {
        return 'Automatable';
    }
    if (effectiveHumanScore > 0.6) {
        return 'Human-Critical';
    }
    return 'Augmentable';
}
