import type { z } from 'zod';
import { RISK_THRESHOLDS } from '../config/constants';
import { callClaudeJSON, StartupIdeasSchema } from './claude';

export { getClaudeUserFriendlyMessage } from './claude';

export type StartupIdeasResult = z.infer<typeof StartupIdeasSchema>;
export type StartupIdea = StartupIdeasResult['ideas'][number];
export type StartupTopThree = StartupIdeasResult['topThree'][number];

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

// Analyze used to re-call Claude on every click with no caching, so the same
// role bounced ~43–50%. The per-job fingerprint cache below keeps it stable
// (claude-sonnet-5 no longer accepts a temperature pin — see claude.ts).
const ANALYZE_CACHE_KEY = 'foj_analyze_cache_v1';
const ANALYZE_CACHE_VERSION = 1;
const ANALYZE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AnalyzeCacheFile = {
    version: number;
    entries: Record<string, { fingerprint: string; savedAt: number; result: JobAnalysis }>;
};

export function analyzeFingerprint(
    jobTitle: string,
    tasks: string[],
    bls: { employment: number; projectedGrowth: number },
): string {
    return JSON.stringify({
        jobTitle,
        tasks,
        employment: bls.employment,
        projectedGrowth: bls.projectedGrowth,
    });
}

function readAnalyzeCacheFile(): AnalyzeCacheFile {
    try {
        const raw = localStorage.getItem(ANALYZE_CACHE_KEY);
        if (!raw) return { version: ANALYZE_CACHE_VERSION, entries: {} };
        const parsed = JSON.parse(raw) as AnalyzeCacheFile;
        if (parsed.version !== ANALYZE_CACHE_VERSION || !parsed.entries) {
            return { version: ANALYZE_CACHE_VERSION, entries: {} };
        }
        return parsed;
    } catch {
        return { version: ANALYZE_CACHE_VERSION, entries: {} };
    }
}

export function loadAnalyzeCacheEntry(jobId: string, fingerprint: string): JobAnalysis | null {
    try {
        const file = readAnalyzeCacheFile();
        const hit = file.entries[jobId];
        if (!hit) return null;
        if (hit.fingerprint !== fingerprint) return null;
        if (Date.now() - hit.savedAt > ANALYZE_CACHE_TTL_MS) return null;
        return hit.result;
    } catch {
        return null;
    }
}

export function saveAnalyzeCacheEntry(jobId: string, fingerprint: string, result: JobAnalysis): void {
    try {
        const file = readAnalyzeCacheFile();
        file.entries[jobId] = { fingerprint, savedAt: Date.now(), result };
        localStorage.setItem(ANALYZE_CACHE_KEY, JSON.stringify(file));
    } catch (e) {
        console.warn('[Analyze] Could not write cache:', e);
    }
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

export async function analyzeJob(
    jobId: string,
    jobTitle: string,
    tasks: string[],
    bls: { employment: number; projectedGrowth: number },
    opts?: { forceRefresh?: boolean },
): Promise<JobAnalysis | null> {
    const fingerprint = analyzeFingerprint(jobTitle, tasks, bls);
    if (!opts?.forceRefresh) {
        const cached = loadAnalyzeCacheEntry(jobId, fingerprint);
        if (cached) return cached;
    }

    const prompt = `
    Analyze the following job tasks for a "${jobTitle}" role.

    Official BLS / snapshot context (do not invent different national totals; your scenario interprets these inputs):
    - US employment level (OES snapshot used in app): ${bls.employment.toLocaleString()}
    - BLS Occupational Outlook 10-year projected employment change for this occupation group: ${bls.projectedGrowth >= 0 ? '+' : ''}${bls.projectedGrowth}%

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
    - "yearlyForecast.growthImpact" is CUMULATIVE percent change in employment from the 2025 baseline. NOT year-over-year. Year 2025 MUST be 0.00. Use two-decimal precision (e.g. 2.40, -3.85).
    - For every forecast year, cumulative |growthImpact| must NOT exceed |${bls.projectedGrowth}| (the BLS OOH 10-year % for this role). Intermediate years must interpolate smoothly toward the 2030 endpoint without violating that cap at any year.
    - Do not introduce other macro statistics (GDP, national unemployment, wages) unless they appear in the task text you were given.
    - "salary_forecast" should be an array of 6 numbers representing a salary index from 2025 to 2030. Start at 100.
    - If the role's tasks have high automation exposure, the salary forecast should show VOLATILITY (ups and downs) or DECLINE.
    - If the role's tasks have high human criticality, the salary should remain STABLE or GROW.
    - "salary_volatility_label" MUST match the data. High variance = "High".
  `;

    const result = await callAnalysis(prompt) as JobAnalysis;
    if (result) saveAnalyzeCacheEntry(jobId, fingerprint, result);
    return result;
}

export async function generateStartupIdeas(
    resumeText: string,
    onProgress?: (accumulatedText: string) => void,
): Promise<StartupIdeasResult> {
    const prompt = `
You are the user's AI co-founder, startup strategist, and brutally honest entrepreneurial advisor.

Carefully review the RESUME/CV below. Do NOT give generic startup ideas — every recommendation must be specifically tailored to this person's real skills, domain experience, credibility, network, and unfair advantages. Be direct and realistic about what they can and cannot execute in the next 12 months. If they are better suited to a services-first business than a technical SaaS, say so.

First, extract a founder profile: core skills, industry/domain knowledge, unfair advantages, and honest gaps or weaknesses.

Then propose EXACTLY 5 tailored startup ideas. Each idea should be able to plausibly reach ~$10,000 MRR within 12 months with focused execution, and have a path to a $1M+ business. For every idea explain why THIS person is a strong or weak fit based on the resume, why AI makes it possible now, and how to validate demand quickly. Rank the ideas best-first (idea #1 is the strongest fit).

Base your reasoning on the resume plus your general knowledge of current startup/AI market trends (Y Combinator, Product Hunt, Indie Hackers, common B2B/prosumer pain points). Do not claim to have performed live web research. Avoid vague "build an AI chatbot / AI automation agency" answers — be specific about the niche, the buyer, and the first product.

Then provide a concrete execution plan for the top 3 ideas.

Be concise so the response stays complete: every string field is ONE sentence, and every array has at most 3 short items. Scores are integers from 1 to 10. "recommendation" must be exactly one of: "Pursue", "Test", or "Avoid".

RESUME/CV:
"""
${resumeText}
"""

Output JSON ONLY, matching this exact shape:
{
  "founderProfile": {
    "summary": "2-3 sentence honest summary of who this founder is and what they can realistically build.",
    "coreSkills": ["skill", "skill", "skill"],
    "domains": ["domain/industry", "..."],
    "unfairAdvantages": ["advantage", "..."],
    "gaps": ["gap or weakness", "..."]
  },
  "ideas": [
    {
      "name": "Startup name",
      "summary": "One-sentence summary.",
      "customer": "Who the customer is.",
      "problem": "The painful problem being solved.",
      "whyNow": "Why this problem is worth solving now.",
      "whyAI": "Why AI makes this possible or better.",
      "whyYou": "Why THIS person (per the resume) is suited to build it.",
      "applicableSkills": ["resume skill that applies", "..."],
      "skillsNeeded": ["skill or resource still needed", "..."],
      "mvpPlan": "MVP / proof-of-concept plan.",
      "firstCustomerPath": "Fastest path to the first paying customer.",
      "pricingModel": "Suggested pricing model.",
      "pathTo10kMrr": "How to reach $10k MRR within 12 months.",
      "pathToScale": "How it could become a $1M+ business.",
      "risks": ["main risk", "..."],
      "validation": "How to validate demand in 7-14 days.",
      "difficultyScore": 6,
      "resumeFitScore": 8,
      "revenuePotentialScore": 7,
      "recommendation": "Pursue"
    }
  ],
  "topThree": [
    {
      "name": "Must match one of the idea names above",
      "validation48h": "48-hour validation plan.",
      "mvp7day": "7-day MVP plan.",
      "launch30day": "30-day launch plan.",
      "revenue90day": "90-day revenue plan.",
      "techStack": ["recommended tool/stack", "..."],
      "firstCustomers": ["specific first customer to target", "..."],
      "outreachScript": "A short cold email or LinkedIn outreach script.",
      "killCriteria": "When to abandon the idea."
    }
  ],
  "startHere": "Clear 'start here' guidance: the single most important first action for this founder."
}
`;

    // Stream this one: it's a ~5k-token / ~55s response, and an unstreamed request
    // sends nothing until it finishes, so any idle/proxy timeout drops it mid-flight.
    // Headroom of 16k (model stops at end_turn ~5-6k) prevents truncated JSON.
    return callClaudeJSON(prompt, StartupIdeasSchema, { maxTokens: 16000, stream: true, onProgress });
}
