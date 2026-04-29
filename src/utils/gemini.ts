import { YEAR_MIN, YEAR_RANGE, RISK_THRESHOLDS } from '../config/constants';
import { callClaudeJSON } from './claude';

export { getClaudeUserFriendlyMessage } from './claude';

export const IS_DEMO_MODE = false;
const DEMO_DELAY_MS = 800;

export interface ScenarioResult {
    story: string;
    keyChanges: string[];
}

export interface ResumeAnalysisResult {
    strengths: string[];
    gaps: string[];
    plan: string;
    feedback: string;
}

export interface RoadmapResult {
    phases: {
        title: string;
        items: string[];
    }[];
    resources: {
        category: string;
        items: string[];
    }[];
    successMetrics: string[];
}

export interface UpskillCoursesResult {
    courses: {
        title: string;
        provider: string;
        duration: string;
        level: string;
    }[];
    whyTheseCourses: string;
}

export interface GeminiTaskAnalysis {
    task_text: string;
    ai_exposure_score: number;
    human_criticality_score: number;
    reasoning: string;
}

export interface GeminiJobAnalysis {
    strategic_insight: string;
    tasks: GeminiTaskAnalysis[];
    yearlyForecast?: {
        year: number;
        growthImpact: number;
        reasoning: string;
    }[];
    likely_replacements: string[];
    human_centric_traits: string[];
    human_resilience_label: string;
    salary_volatility_label: string;
    salary_forecast: number[];
}

// --- Demo mode mock data ---

function getDemoAnalysis(jobTitle: string, tasks: string[]): GeminiJobAnalysis {
    const taskCount = tasks.length;
    const avgAi = 0.45 + (Math.random() * 0.1 - 0.05);
    const avgHuman = 0.62 + (Math.random() * 0.1 - 0.05);

    return {
        strategic_insight: `${jobTitle} roles are evolving with AI augmentation. While routine analytical tasks face automation pressure, strategic decision-making and stakeholder management remain deeply human. Professionals who embrace AI tools will see productivity gains.`,
        tasks: tasks.map((t, i) => {
            const aiScore = 0.2 + (i / taskCount) * 0.6 + (Math.random() * 0.1 - 0.05);
            const humanScore = 0.8 - (i / taskCount) * 0.5 + (Math.random() * 0.1 - 0.05);
            return {
                task_text: t,
                ai_exposure_score: parseFloat(Math.min(1, Math.max(0, aiScore)).toFixed(2)),
                human_criticality_score: parseFloat(Math.min(1, Math.max(0, humanScore)).toFixed(2)),
                reasoning: `AI can assist with structured aspects of this task, but human judgment remains essential for nuanced decisions.`
            };
        }),
        yearlyForecast: Array.from({ length: YEAR_RANGE }, (_, i) => {
            const year = YEAR_MIN + 1 + i;
            const impacts = [-1.2, -0.8, 0.5, 1.5, 2.2];
            const reasons = [
                'Initial AI adoption creates short-term displacement pressure',
                'Market adjusts as new hybrid roles emerge',
                'AI-augmented professionals show higher productivity',
                'Demand increases for human oversight of AI systems',
                'Mature AI ecosystem creates net positive job growth',
            ];
            return { year, growthImpact: impacts[i] ?? 0, reasoning: reasons[i] ?? 'Continued evolution' };
        }),
        likely_replacements: ['AI Code Assistants', 'Automated Reporting Tools', 'LLM-Powered Analysis', 'Workflow Automation Agents'],
        human_centric_traits: ['Strategic Thinking', 'Stakeholder Empathy', 'Creative Problem-Solving', 'Ethical Judgment'],
        human_resilience_label: avgHuman > RISK_THRESHOLDS.RESILIENCE_HIGH ? 'High' : avgHuman > RISK_THRESHOLDS.RESILIENCE_MEDIUM ? 'Medium' : 'Low',
        salary_volatility_label: avgAi > RISK_THRESHOLDS.VOLATILITY_HIGH ? 'High' : avgAi > RISK_THRESHOLDS.VOLATILITY_MODERATE ? 'Moderate' : 'Stable',
        salary_forecast: [100, 101, 99, 102, 104, 107],
    };
}

function getDemoScenario(jobTitle: string): ScenarioResult {
    return {
        story: `It's 7:30 AM in 2030. As a ${jobTitle}, my morning starts with a briefing from my AI copilot — it's already triaged overnight client requests, flagged two anomalies in the quarterly data, and drafted preliminary recommendations. I spend my first hour on what matters most: a video call with a nervous client navigating a major transition. No AI can replace the trust built in that conversation. By noon, I've reviewed three AI-generated strategy proposals, adding the contextual nuance only years of experience provide. The afternoon is for creative work — designing a novel framework that my AI tools say has no precedent in their training data. That's where the magic happens.`,
        keyChanges: [
            'AI handles 60% of routine data analysis and report generation',
            'Human professionals focus on relationship management and strategic advisory',
            'New "AI Director" responsibilities emerge for overseeing automated workflows'
        ]
    };
}

function getDemoResumeAnalysis(): ResumeAnalysisResult {
    return {
        strengths: [
            'Strong analytical foundation adaptable to AI-augmented workflows',
            'Communication skills that remain irreplaceable by automation',
            'Domain expertise that provides critical context for AI oversight'
        ],
        gaps: [
            'AI/ML literacy — understanding how to effectively prompt and validate AI outputs',
            'Data pipeline skills — ability to prepare and evaluate data for AI systems',
            'Human-AI collaboration frameworks — methodologies for hybrid workflows'
        ],
        plan: 'Over the next 5 years, focus on becoming an "AI-augmented professional" rather than competing with AI. Start with AI literacy courses (Months 1-6), then transition to hands-on AI tool integration in your daily workflows (Months 7-18). By Year 3, aim to lead AI adoption initiatives in your organization. Years 4-5 should focus on developing strategic oversight capabilities for AI systems in your domain.',
        feedback: 'Your profile shows a solid foundation with transferable skills. The key gap is practical AI integration experience. You are well-positioned to transition into an AI-augmented role with targeted upskilling.'
    };
}

function getDemoRoadmap(): RoadmapResult {
    return {
        phases: [
            {
                title: 'Months 1-2: Foundation',
                items: [
                    'Complete "AI for Everyone" by Andrew Ng on Coursera to build conceptual understanding',
                    'Start using AI coding assistants (GitHub Copilot, Claude) in daily work for 30 min/day',
                    'Join 2 professional communities focused on AI in your industry (LinkedIn groups, Discord)'
                ]
            },
            {
                title: 'Months 3-4: Application',
                items: [
                    'Build a portfolio project automating one routine workflow using LLM APIs',
                    'Shadow a team already using AI tools — document their processes and pain points',
                    'Complete a prompt engineering certification (DeepLearning.AI or similar)'
                ]
            },
            {
                title: 'Months 5-6: Mastery',
                items: [
                    'Lead an AI integration pilot project at your organization or freelance',
                    'Mentor 2-3 peers on AI tool adoption, solidifying your own expertise',
                    'Publish a case study or article on your AI integration experience'
                ]
            }
        ],
        resources: [
            { category: 'Online Platforms', items: ['Coursera', 'edX', 'LinkedIn Learning', 'Udacity'] },
            { category: 'Professional Networks', items: ['Industry associations', 'Meetup groups', 'Discord communities'] },
            { category: 'Practice Projects', items: ['GitHub', 'Kaggle', 'personal portfolio'] },
            { category: 'Certifications', items: ['Industry-recognized credentials'] },
        ],
        successMetrics: [
            'Complete at least 2 relevant courses with certificates',
            'Lead or contribute to 3+ projects using the target skill',
            'Build a portfolio showcasing your expertise',
            'Receive positive feedback from peers and supervisors',
            'Transition 30-50% of your work time to this skill area',
        ]
    };
}

function getDemoUpskillCourses(taskName: string): UpskillCoursesResult {
    return {
        courses: [
            { title: `Advanced ${taskName}`, provider: 'Coursera', duration: '4 weeks', level: 'Intermediate' },
            { title: `AI & ${taskName}`, provider: 'LinkedIn Learning', duration: '12 hours', level: 'Beginner' },
            { title: `${taskName} Certification`, provider: 'edX', duration: '8 weeks', level: 'Advanced' },
        ],
        whyTheseCourses: `These courses will help you deepen expertise in ${taskName} and become more resilient to automation.`,
    };
}

// --- API call layer ---

async function callGemini(prompt: string): Promise<unknown> {
    return callClaudeJSON(prompt);
}

// --- Exported functions ---

export async function generateJobScenario(
    jobTitle: string,
    riskScore: number,
    topTasks: { name: string, aiCapabilityScore: number }[]
): Promise<ScenarioResult> {
    if (IS_DEMO_MODE) {
        await new Promise(r => setTimeout(r, DEMO_DELAY_MS));
        return getDemoScenario(jobTitle);
    }

    const highRiskTasks = topTasks
        .filter(t => t.aiCapabilityScore > RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE)
        .map(t => t.name)
        .join(', ');

    const prompt = `
        Context: It is the year 2030. Automation has augmented the workforce.
        Role: ${jobTitle}
        AI Risk Score: ${(riskScore * 10).toFixed(1)}/10
        Tasks now automated by AI: ${highRiskTasks}

        Task: Write a "Day in the Life" diary entry (max 150 words) for a professional in this role in 2030.
        Focus on how they interact with AI agents to do the automated tasks, and what HIGH-LEVEL human work they focus on instead.
        Make it feel optimistic but realistic and futuristic.

        Also provide 3 bullet points of "Key Changes".
        Format output as JSON: { "story": "...", "keyChanges": ["...", "...", "..."] }
    `;

    return callGemini(prompt) as Promise<ScenarioResult>;
}

export async function analyzeResume(skillsInput: string): Promise<ResumeAnalysisResult> {
    if (IS_DEMO_MODE) {
        await new Promise(r => setTimeout(r, DEMO_DELAY_MS));
        return getDemoResumeAnalysis();
    }

    const prompt = `
        Role: Career Resilience Expert & Futurist.
        Task: Analyze these user skills for relevance in the next 5 years (AI Era).
        User Skills/Context: "${skillsInput}"

        CRITICAL INSTRUCTION:
        1. Do NOT provide a generic score.
        2. Identify TOP 3 Strengths (what makes them resilient).
        3. Identify TOP 3 Gaps (what they miss for 2030).
        4. Provide a "5-Year Relevance Plan" (1 short paragraph).

        Output JSON only:
        {
            "strengths": ["Strength 1", "Strength 2", "Strength 3"],
            "gaps": ["Gap 1", "Gap 2", "Gap 3"],
            "plan": "Actionable 5-year outlook...",
            "feedback": "Short summary of their current standing."
        }
    `;

    return callGemini(prompt) as Promise<ResumeAnalysisResult>;
}

export async function generateRoadmap(jobTitle: string, riskTask: string, targetTask: string): Promise<RoadmapResult> {
    if (IS_DEMO_MODE) {
        await new Promise(r => setTimeout(r, DEMO_DELAY_MS));
        return getDemoRoadmap();
    }

    const prompt = `
        Context: Career transition plan for a ${jobTitle}.
        Goal: Move away from "${riskTask}" (high automation risk) towards "${targetTask}" (high human value).

        INSTRUCTION: Be specific to this exact role and transition. Do not use generic filler text. Reference specific, real-world tools, platforms, certifications, and frameworks relevant to a ${jobTitle}.

        Output JSON only:
        {
            "phases": [
                { "title": "Months 1-2: Foundation", "items": ["Specific verifiable step 1", "Specific step 2", "Specific step 3"] },
                { "title": "Months 3-4: Application", "items": ["Specific step 1", "Specific step 2", "Specific step 3"] },
                { "title": "Months 5-6: Mastery", "items": ["Specific step 1", "Specific step 2", "Specific step 3"] }
            ],
            "resources": [
                { "category": "Courses & Certifications", "items": ["Specific course or cert name relevant to ${jobTitle} and ${targetTask}", "..."] },
                { "category": "Tools & Platforms", "items": ["Specific tool used in this field", "..."] },
                { "category": "Communities & Networks", "items": ["Specific professional association, forum, or community", "..."] },
                { "category": "Books & Research", "items": ["Specific book or publication relevant to this transition", "..."] }
            ],
            "successMetrics": [
                "Specific, measurable milestone 1 tied to ${targetTask}",
                "Specific milestone 2",
                "Specific milestone 3",
                "Specific milestone 4",
                "Specific milestone 5"
            ]
        }
    `;

    return callGemini(prompt) as Promise<RoadmapResult>;
}

export async function generateUpskillCourses(jobTitle: string, taskName: string): Promise<UpskillCoursesResult> {
    if (IS_DEMO_MODE) {
        await new Promise(r => setTimeout(r, DEMO_DELAY_MS));
        return getDemoUpskillCourses(taskName);
    }

    const prompt = `
        A professional working as a "${jobTitle}" wants to upskill in this specific task:
        "${taskName}"

        This task has high human value and helps them stay resilient against automation.

        Recommend exactly 3 real, specific courses or certifications they should take.
        Each must reference a real platform and real course title that exists today.

        Output JSON only:
        {
            "courses": [
                { "title": "Exact real course name", "provider": "Platform name (e.g. Coursera, edX, LinkedIn Learning, Udemy, official body)", "duration": "e.g. 6 weeks", "level": "Beginner | Intermediate | Advanced" },
                { "title": "...", "provider": "...", "duration": "...", "level": "..." },
                { "title": "...", "provider": "...", "duration": "...", "level": "..." }
            ],
            "whyTheseCourses": "One sentence explaining why these specific courses build resilience for a ${jobTitle}."
        }
    `;

    return callGemini(prompt) as Promise<UpskillCoursesResult>;
}

export async function analyzeJobWithGemini(jobTitle: string, tasks: string[]): Promise<GeminiJobAnalysis | null> {
    if (IS_DEMO_MODE) {
        await new Promise(r => setTimeout(r, DEMO_DELAY_MS));
        return getDemoAnalysis(jobTitle, tasks);
    }

    const prompt = `
    Analyze the following job tasks for a "${jobTitle}" role.

    For each task, provide:
    1. ai_exposure_score (0.0 to 1.0): How easily can GenAI/Agents automate this?
    2. human_criticality_score (0.0 to 1.0): How crucial is a human for trust/ethics/physicality?
    3. reasoning: A short 1-sentence explanation.

    Tasks:
    ${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

    return a JSON object with this structure:
    {
      "strategic_insight": "A short strategic summary of the job's future.",
      "tasks": [
        { "task_text": "original text", "ai_exposure_score": number, "human_criticality_score": number, "reasoning": "..." }
      ],
      "yearlyForecast": [
        { "year": 2026, "growthImpact": number, "reasoning": "..." }
      ],
      "likely_replacements": ["Specific AI Tool 1", "Specific Algorithm 2", "Automation Type 3", "Tech 4"],
      "human_centric_traits": ["Trait 1", "Trait 2", "Trait 3", "Trait 4"],
      "human_resilience_label": "Low" | "Medium" | "High" | "Critical",
      "salary_volatility_label": "Low" | "Medium" | "High",
      "salary_forecast": [100, number, number, number, number, number]
    }

    IMPORTANT COHERENCE INSTRUCTIONS:
    - Provide precise, granular two-decimal scores (e.g., 0.73, 0.41, 0.88). DO NOT round to the nearest tenth or quarter.
    - "salary_forecast" should be an array of 6 numbers representing a salary index from 2025 to 2030. Start at 100.
    - If the role's tasks have high automation exposure, the salary forecast should show VOLATILITY (ups and downs) or DECLINE.
    - If the role's tasks have high human criticality, the salary should remain STABLE or GROW.
    - "salary_volatility_label" MUST match the data. High variance = "High".
  `;

    return callGemini(prompt) as Promise<GeminiJobAnalysis>;
}
