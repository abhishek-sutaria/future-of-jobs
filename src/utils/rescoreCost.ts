/**
 * rescoreCost.ts
 * --------------
 * Rough Claude token / USD estimates for a full "Re-score all roles" run.
 * Used in the confirm UI so users can decide before spending their own key.
 *
 * Heuristic: ~4 chars per token (English prompts + JSON). Output size is
 * estimated from task count + the fixed 6-year forecast shape. Pricing is
 * Sonnet-class list rates ($3 / MTok in, $15 / MTok out) — adjust if the
 * model tier changes.
 */

import { buildJobAnalysisPrompt } from './taskScoring';

/** Public Sonnet-class list prices (USD per million tokens). */
export const RESCORE_PRICE_USD_PER_MTOK = {
    input: 3,
    output: 15,
} as const;

export interface RescoreJobInput {
    title: string;
    tasks: { name: string }[];
    employment: number;
    projectedGrowth: number;
}

export interface RescoreCostEstimate {
    apiCalls: number;
    totalTasks: number;
    /** Estimated prompt tokens across all jobs */
    inputTokens: number;
    /** Estimated completion tokens across all jobs */
    outputTokens: number;
    totalTokens: number;
    /** Midpoint USD estimate at RESCORE_PRICE_USD_PER_MTOK */
    costUsd: number;
    /** Soft band for UI copy (±~20%) */
    costUsdLow: number;
    costUsdHigh: number;
}

function estimateOutputChars(taskCount: number): number {
    // Per-task JSON row (~200 chars) + 6 forecast rows with short reasoning (~220) + braces
    return taskCount * 200 + 6 * 220 + 100;
}

/**
 * Estimate tokens and USD for scoring every job once (cleared cache / force refresh).
 */
export function estimateRescoreCost(jobs: RescoreJobInput[]): RescoreCostEstimate {
    let inputChars = 0;
    let outputChars = 0;
    let totalTasks = 0;

    for (const job of jobs) {
        const taskNames = job.tasks.map((t) => t.name);
        totalTasks += taskNames.length;
        inputChars += buildJobAnalysisPrompt(
            job.title,
            taskNames,
            job.employment,
            job.projectedGrowth,
        ).length;
        outputChars += estimateOutputChars(taskNames.length);
    }

    const inputTokens = Math.round(inputChars / 4);
    const outputTokens = Math.round(outputChars / 4);
    const totalTokens = inputTokens + outputTokens;
    const costUsd =
        (inputTokens / 1e6) * RESCORE_PRICE_USD_PER_MTOK.input +
        (outputTokens / 1e6) * RESCORE_PRICE_USD_PER_MTOK.output;

    return {
        apiCalls: jobs.length,
        totalTasks,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        costUsdLow: Math.max(0.01, costUsd * 0.8),
        costUsdHigh: costUsd * 1.2,
    };
}

/** Compact copy for the re-score confirm dialog. */
export function formatRescoreCostSummary(est: RescoreCostEstimate): string {
    const tokensK = Math.round(est.totalTokens / 1000);
    const low = est.costUsdLow.toFixed(2);
    const high = est.costUsdHigh.toFixed(2);
    return `~${est.apiCalls} Claude calls · ~${tokensK}k tokens · ~$${low}–$${high} (Sonnet list price)`;
}
