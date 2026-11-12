/**
 * The prompt text of every live Claude feature, built on the server
 * (api/_lib/gateway.ts) from the inputs the browser sends, never from a
 * prompt the browser writes. Moved here from utils/analysis.ts word for word,
 * so the same inputs give the same prompt as before.
 *
 * Pure: no Vite, no DOM, no Node. Relative imports carry ".js" because the
 * Vercel function runs as Node ESM, which needs the extension; Vite and tsc
 * resolve them to the .ts files.
 */

import { RISK_THRESHOLDS, OOH_FRACTION_AT_YEAR_MAX, OOH_ENDPOINT_YEAR } from '../config/constants.js';
import { oohEnvelopeCap } from '../utils/oohEnvelope.js';

/** Thousands separators fixed to en-US, so the server and every browser write the same prompt. */
const formatInt = (n: number): string => n.toLocaleString('en-US');

export function buildScenarioPrompt(
    jobTitle: string,
    riskScore: number,
    topTasks: { name: string, aiCapabilityScore: number }[]
): string {
    const highRiskTasks = topTasks
        .filter(t => t.aiCapabilityScore > RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE)
        .map(t => t.name)
        .join(', ');

    return `
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
}

export function buildResumePrompt(skillsInput: string): string {
    return `
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
}

export function buildRoadmapPrompt(jobTitle: string, riskTask: string, targetTask: string): string {
    return `
        Context: Career Defend & Build plan for a ${jobTitle}.
        Goal: DEFEND "${riskTask}" (high GenAI capability / automation exposure) by owning judgment, oversight, and exception-handling around it — do NOT abandon that task — while BUILDING "${targetTask}" (high human criticality) into a durable advantage.

        INSTRUCTION: Be specific to this exact role. Do not use generic filler text. Do not frame the plan as leaving or exiting the high-risk task. Reference specific, real-world tools, platforms, certifications, and frameworks relevant to a ${jobTitle}.

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
}

/**
 * Which side of the panel the training was launched from.
 *   'defend' — a high-automation-risk task. The user is NOT being taught to
 *              perform it faster; they're being moved into the judgment layer
 *              around it, which is the part that survives.
 *   'build'  — a human-critical task, deepened into a durable advantage.
 *
 * This distinction exists because the prompt used to assert, for every call,
 * that the task "has high human value and helps them stay resilient against
 * automation" — while the only button wired to it sat on the HIGH-RISK list.
 * Claude was being asked to justify resilience for tasks the app had just
 * flagged as automatable, so it did. Ray caught the contradiction on screen;
 * the false premise was underneath it.
 */
export type UpskillMode = 'defend' | 'build';

/** Exported for tests: the prompt is the thing that was wrong, so assert on it directly. */
export function buildUpskillPrompt(
    jobTitle: string,
    taskName: string,
    mode: UpskillMode,
    aiRiskPercent: number,
): string {
    const shape = `
        Output JSON only:
        {
            "courses": [
                { "title": "Exact real course name", "provider": "Platform name (e.g. Coursera, edX, LinkedIn Learning, Udemy, official body)", "duration": "e.g. 6 weeks", "level": "Beginner | Intermediate | Advanced" },
                { "title": "...", "provider": "...", "duration": "...", "level": "..." },
                { "title": "...", "provider": "...", "duration": "...", "level": "..." }
            ],
            "whyTheseCourses": "REPLACE_WHY"
        }
    `;

    if (mode === 'defend') {
        return `
        A professional working as a "${jobTitle}" has this task in their role:
        "${taskName}"

        This task carries roughly ${Math.round(aiRiskPercent)}% GenAI capability exposure — current models could handle much of it (capability, not guaranteed adoption).

        Do NOT recommend training that teaches them to perform this task faster or more cheaply by hand. That is precisely the part most exposed to automation.

        Recommend training that moves them UP the value chain on this exact task: directing and reviewing automated output, recognising where it fails, handling the exceptions and edge cases it cannot, carrying the accountability and judgment a model cannot own, and holding enough domain depth to know when the output is wrong.

        Recommend exactly 3 real, specific courses or certifications that make that shift.
        Each must reference a real platform and a real course title that exists today.
        ${shape.replace('REPLACE_WHY', `One sentence on how these move a ${jobTitle} from performing this task to owning the judgment around it.`)}
    `;
    }

    return `
        A professional working as a "${jobTitle}" wants to go deeper on this task:
        "${taskName}"

        This task is assessed as human-critical: it resists automation, and it is where this person's durable advantage lies. The goal is to deepen it from something they can do into something that clearly distinguishes them.

        Recommend exactly 3 real, specific courses or certifications that build that depth.
        Each must reference a real platform and a real course title that exists today.
        ${shape.replace('REPLACE_WHY', `One sentence on why these compound the human advantage a ${jobTitle} already has here.`)}
    `;
}

export function buildAnalyzePrompt(
    jobTitle: string,
    tasks: string[],
    bls: { employment: number; projectedGrowth: number },
): string {
    return `
    Analyze the following job tasks for a "${jobTitle}" role.

    Official BLS / snapshot context (do not invent different national totals; your scenario interprets these inputs):
    - US employment level (OES snapshot used in app): ${formatInt(bls.employment)}
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
    - The BLS figure is a 10-year (2024–${OOH_ENDPOINT_YEAR}) outlook. By 2030 the path may reach at most ~${(OOH_FRACTION_AT_YEAR_MAX * 100).toFixed(0)}% of that decade change (cap = ${oohEnvelopeCap(bls.projectedGrowth).toFixed(2)}), not the full ${bls.projectedGrowth}%.
    - For every forecast year, growthImpact MUST fall between 0.00 and ${oohEnvelopeCap(bls.projectedGrowth).toFixed(2)} inclusive — moving monotonically from the 2025 baseline toward that 2030 cap. Do not cross zero, and do not go past the cap.
    - Do not introduce other macro statistics (GDP, national unemployment, wages) unless they appear in the task text you were given.
    - "salary_forecast" should be an array of 6 numbers representing a salary index from 2025 to 2030. Start at 100.
    - If the role's tasks have high automation exposure, the salary forecast should show VOLATILITY (ups and downs) or DECLINE.
    - If the role's tasks have high human criticality, the salary should remain STABLE or GROW.
    - "salary_volatility_label" MUST match the data. High variance = "High".
  `;
}

export function buildStartupCorePrompt(resumeText: string): string {
    return `
You are the user's AI co-founder, startup strategist, and brutally honest entrepreneurial advisor.

Carefully review the RESUME/CV below. Do NOT give generic startup ideas — every recommendation must be specifically tailored to this person's real skills, domain experience, credibility, network, and unfair advantages. Be direct and realistic about what they can and cannot execute in the next 12 months. If they are better suited to a services-first business than a technical SaaS, say so.

First, extract a founder profile: core skills, industry/domain knowledge, unfair advantages, and honest gaps or weaknesses.

Then propose EXACTLY 5 tailored startup ideas. Each idea should be able to plausibly reach ~$10,000 MRR within 12 months with focused execution, and have a path to a $1M+ business. For every idea explain why THIS person is a strong or weak fit based on the resume, why AI makes it possible now, and why the problem is worth solving now. Rank the ideas best-first (idea #1 is the strongest fit).

Base your reasoning on the resume plus your general knowledge of current startup/AI market trends (Y Combinator, Product Hunt, Indie Hackers, common B2B/prosumer pain points). Do not claim to have performed live web research. Avoid vague "build an AI chatbot / AI automation agency" answers — be specific about the niche, the buyer, and the first product.

Be concise so the response stays complete: every string field is ONE sentence, EXCEPT "recommendation" which must be exactly one word — either "Pursue", "Test", or "Avoid" (no other text). Scores are integers from 1 to 10.

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
      "difficultyScore": 6,
      "resumeFitScore": 8,
      "revenuePotentialScore": 7,
      "recommendation": "Pursue"
    }
  ],
  "startHere": "Clear 'start here' guidance: the single most important first action for this founder."
}
`;
}

export function buildStartupPlansPrompt(resumeText: string, ideaNames: string[]): string {
    const names = ideaNames.slice(0, 3);
    return `
You are the user's startup execution coach. For the founder described by the RESUME below, produce a detailed build/execution plan for EACH of these 3 startup ideas (use these exact names): ${names.map((n) => `"${n}"`).join(', ')}.

Be concise and practical: every string field is ONE sentence, every array has at most 3 short items.

RESUME/CV:
"""
${resumeText}
"""

Output JSON ONLY, matching this exact shape:
{
  "topThree": [
    {
      "name": "Must exactly match one of: ${names.join(', ')}",
      "applicableSkills": ["resume skill that applies", "..."],
      "skillsNeeded": ["skill or resource still needed", "..."],
      "mvpPlan": "MVP / proof-of-concept plan.",
      "firstCustomerPath": "Fastest path to the first paying customer.",
      "pricingModel": "Suggested pricing model.",
      "pathTo10kMrr": "How to reach $10k MRR within 12 months.",
      "pathToScale": "How it could become a $1M+ business.",
      "risks": ["main risk", "..."],
      "validation": "How to validate demand in 7-14 days.",
      "validation48h": "48-hour validation plan.",
      "mvp7day": "7-day MVP plan.",
      "launch30day": "30-day launch plan.",
      "revenue90day": "90-day revenue plan.",
      "techStack": ["recommended tool/stack", "..."],
      "firstCustomers": ["specific first customer to target", "..."],
      "outreachScript": "A short cold email or LinkedIn outreach script.",
      "killCriteria": "When to abandon the idea."
    }
  ]
}
`;
}
