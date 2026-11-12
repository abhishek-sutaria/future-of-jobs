/**
 * The app's live Claude features, as the browser calls them. The browser sends
 * only each feature's inputs; the server builds the prompt (shared/aiPrompts)
 * and checks the answer (shared/aiFeatures). Role answers (Strategic Insight,
 * Scenario, Roadmap, Defend / Build) are saved server-side on first use and
 * shared with every later visitor, so each comes back with `shared`: `hit`
 * means it was already saved and no Claude call was made.
 */

import type { z } from 'zod';
import { callClaudeFeature, StartupIdeasSchema, StartupCoreSchema, StartupPlansSchema, type SharedAnswerMeta } from './claude';
import type { UpskillMode } from '../shared/aiPrompts';

export { getClaudeUserFriendlyMessage, AiLimitError } from './claude';
export { buildUpskillPrompt } from '../shared/aiPrompts';
export type { UpskillMode } from '../shared/aiPrompts';
export type { SharedAnswerMeta } from './claude';

/** A role answer plus where it came from (saved earlier, or made just now). */
export interface RoleAnswer<T> {
    result: T;
    shared?: SharedAnswerMeta;
}

export type StartupIdeasResult = z.infer<typeof StartupIdeasSchema>;
export type StartupIdea = StartupIdeasResult['ideas'][number];
export type StartupTopThree = StartupIdeasResult['topThree'][number];
export type StartupCoreResult = z.infer<typeof StartupCoreSchema>;
export type StartupDetail = z.infer<typeof StartupPlansSchema>['topThree'][number];

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

// --- Exported functions ---
//
// Every role feature takes the role's key ("job-15" for a Kelley role,
// "soc:29-1141" for any other occupation): it is part of the saved answer's
// key on the server, with a hash of the exact request.

export async function generateJobScenario(
    roleKey: string,
    jobTitle: string,
    riskScore: number,
    topTasks: { name: string, aiCapabilityScore: number }[]
): Promise<RoleAnswer<ScenarioResult>> {
    return callClaudeFeature<ScenarioResult>('scenario', {
        roleKey,
        title: jobTitle,
        risk: riskScore,
        tasks: topTasks.map((t) => ({ name: t.name, aiCapabilityScore: t.aiCapabilityScore })),
    });
}

export async function analyzeResume(skillsInput: string): Promise<ResumeAnalysisResult> {
    return (await callClaudeFeature<ResumeAnalysisResult>('skills', { text: skillsInput })).result;
}

export async function generateRoadmap(roleKey: string, jobTitle: string, riskTask: string, targetTask: string): Promise<RoleAnswer<RoadmapResult>> {
    return callClaudeFeature<RoadmapResult>('roadmap', { roleKey, title: jobTitle, riskTask, targetTask });
}

export async function generateUpskillCourses(
    roleKey: string,
    jobTitle: string,
    taskName: string,
    mode: UpskillMode,
    aiRiskPercent: number,
): Promise<RoleAnswer<UpskillCoursesResult>> {
    return callClaudeFeature<UpskillCoursesResult>('upskill', { roleKey, title: jobTitle, taskName, mode, riskPercent: aiRiskPercent });
}

/**
 * Live Analyze: Strategic Insight, the reasoning under each task, likely
 * replacements and required traits. Prose only: the role's scores stay the
 * published ones (alignAnalysisToTasks). The server clamps the forecast into
 * the BLS envelope before it is saved, as this file used to do in the browser.
 */
export async function analyzeJob(
    roleKey: string,
    jobTitle: string,
    tasks: string[],
    bls: { employment: number; projectedGrowth: number },
): Promise<JobAnalysis & { shared?: SharedAnswerMeta }> {
    const { result, shared } = await callClaudeFeature<JobAnalysis>('analyze', {
        roleKey,
        title: jobTitle,
        tasks,
        employment: Math.round(bls.employment),
        projectedGrowth: bls.projectedGrowth,
    });
    return shared ? { ...result, shared } : result;
}

// The dashboard is generated in two streamed calls so neither nears Vercel's 60s
// function limit (a single combined call ran ~46-56s and timed out on cold/heavy
// runs). Call 1 = founder profile + 5 ranked ideas; call 2 = top-3 execution plans.
// Résumé features are personal: never saved on the server.

export async function generateStartupCore(
    resumeText: string,
    onProgress?: (accumulatedText: string) => void,
): Promise<StartupCoreResult> {
    return (await callClaudeFeature('startup_core', { resume: resumeText }, { schema: StartupCoreSchema, stream: true, onProgress })).result;
}

/**
 * Call 2: deep detail + execution plan for the top 3 ideas only. Returned so the
 * modal can both enrich those idea cards and render the Top-3 execution section.
 */
export async function generateStartupTopThree(
    resumeText: string,
    ideaNames: string[],
): Promise<StartupDetail[]> {
    const { result } = await callClaudeFeature('startup_plans', { resume: resumeText, ideaNames: ideaNames.slice(0, 3) }, { schema: StartupPlansSchema, stream: true });
    return result.topThree;
}

/** Merge Call-2 detail into the light ideas (by name) and split out the plan fields. */
export function mergeStartupResult(core: StartupCoreResult, details: StartupDetail[]): StartupIdeasResult {
    const byName = new Map(details.map((d) => [d.name.trim().toLowerCase(), d]));
    const ideas = core.ideas.map((idea) => {
        const d = byName.get(idea.name.trim().toLowerCase());
        if (!d) return idea;
        return {
            ...idea,
            applicableSkills: d.applicableSkills,
            skillsNeeded: d.skillsNeeded,
            mvpPlan: d.mvpPlan,
            firstCustomerPath: d.firstCustomerPath,
            pricingModel: d.pricingModel,
            pathTo10kMrr: d.pathTo10kMrr,
            pathToScale: d.pathToScale,
            risks: d.risks,
            validation: d.validation,
        };
    });
    const topThree: StartupTopThree[] = details.map((d) => ({
        name: d.name,
        validation48h: d.validation48h,
        mvp7day: d.mvp7day,
        launch30day: d.launch30day,
        revenue90day: d.revenue90day,
        techStack: d.techStack,
        firstCustomers: d.firstCustomers,
        outreachScript: d.outreachScript,
        killCriteria: d.killCriteria,
    }));
    return { ...core, ideas, topThree };
}

/** Convenience orchestrator (core + detail). The modal calls the pieces separately
 *  so it can render ideas as soon as the core call returns. */
export async function generateStartupIdeas(
    resumeText: string,
    onProgress?: (accumulatedText: string) => void,
): Promise<StartupIdeasResult> {
    const core = await generateStartupCore(resumeText, onProgress);
    try {
        const details = await generateStartupTopThree(resumeText, core.ideas.map((i) => i.name));
        return mergeStartupResult(core, details);
    } catch {
        return { ...core, topThree: [] };
    }
}

/**
 * Rows for the role panel's task cards: the role's published scores, with the
 * live run's reasoning attached. Matched by exact name, then 40-char prefix, then
 * position, because Claude sometimes paraphrases task_text. The live scores are
 * ignored on purpose, so Analyze can never show a number the role page doesn't.
 */
export function alignAnalysisToTasks(
    jobTasks: { name: string; aiCapabilityScore: number; humanCriticalityScore: number }[],
    liveTasks: { task_text: string; reasoning?: string }[],
): { name: string; ai: number; human: number; reasoning: string }[] {
    return jobTasks.map((task, index) => {
        const match =
            liveTasks.find((t) => t.task_text === task.name) ??
            liveTasks.find((t) => t.task_text.startsWith(task.name.slice(0, 40))) ??
            liveTasks[index];
        return {
            name: task.name,
            ai: task.aiCapabilityScore,
            human: task.humanCriticalityScore,
            reasoning: match?.reasoning ?? '',
        };
    });
}
