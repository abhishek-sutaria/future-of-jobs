import { RISK_THRESHOLDS } from '../config/constants';
import { callClaudeJSON } from './claude';

export { getClaudeUserFriendlyMessage } from './claude';

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

export interface TaskAnalysis {
    task_text: string;
    ai_exposure_score: number;
    human_criticality_score: number;
    reasoning: string;
}

export interface JobAnalysis {
    strategic_insight: string;
    tasks: TaskAnalysis[];
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

// --- API call layer ---

async function callAnalysis(prompt: string): Promise<unknown> {
    return callClaudeJSON(prompt);
}

// --- Exported functions ---

export async function generateJobScenario(
    jobTitle: string,
    riskScore: number,
    topTasks: { name: string, aiCapabilityScore: number }[]
): Promise<ScenarioResult> {
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

    return callAnalysis(prompt) as Promise<ScenarioResult>;
}

export async function analyzeResume(skillsInput: string): Promise<ResumeAnalysisResult> {
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

    return callAnalysis(prompt) as Promise<ResumeAnalysisResult>;
}

export async function generateRoadmap(jobTitle: string, riskTask: string, targetTask: string): Promise<RoadmapResult> {
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

    return callAnalysis(prompt) as Promise<RoadmapResult>;
}

export async function generateUpskillCourses(jobTitle: string, taskName: string): Promise<UpskillCoursesResult> {
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

    return callAnalysis(prompt) as Promise<UpskillCoursesResult>;
}

export async function analyzeJob(jobTitle: string, tasks: string[]): Promise<JobAnalysis | null> {
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
        { "year": 2025, "growthImpact": 0.00, "reasoning": "Baseline" },
        { "year": 2026, "growthImpact": number, "reasoning": "..." },
        { "year": 2027, "growthImpact": number, "reasoning": "..." },
        { "year": 2028, "growthImpact": number, "reasoning": "..." },
        { "year": 2029, "growthImpact": number, "reasoning": "..." },
        { "year": 2030, "growthImpact": number, "reasoning": "..." }
      ],
      "likely_replacements": ["Specific AI Tool 1", "Specific Algorithm 2", "Automation Type 3", "Tech 4"],
      "human_centric_traits": ["Trait 1", "Trait 2", "Trait 3", "Trait 4"],
      "human_resilience_label": "Low" | "Medium" | "High" | "Critical",
      "salary_volatility_label": "Low" | "Medium" | "High",
      "salary_forecast": [100, number, number, number, number, number]
    }

    IMPORTANT COHERENCE INSTRUCTIONS:
    - Provide precise, granular two-decimal scores (e.g., 0.73, 0.41, 0.88). DO NOT round to the nearest tenth or quarter.
    - "yearlyForecast.growthImpact" is CUMULATIVE percent change in employment from the 2025 baseline. NOT year-over-year. Year 2025 MUST be 0.00. Use two-decimal precision (e.g. 2.40, -3.85). Magnitudes around half of the BLS 10-year projection by year 2030, adjusted up for high human-criticality and down for high AI-capability tasks.
    - "salary_forecast" should be an array of 6 numbers representing a salary index from 2025 to 2030. Start at 100.
    - If the role's tasks have high automation exposure, the salary forecast should show VOLATILITY (ups and downs) or DECLINE.
    - If the role's tasks have high human criticality, the salary should remain STABLE or GROW.
    - "salary_volatility_label" MUST match the data. High variance = "High".
  `;

    return callAnalysis(prompt) as Promise<JobAnalysis>;
}
