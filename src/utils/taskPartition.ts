import { RISK_THRESHOLDS } from '../config/constants';

interface ScoredTask {
    name: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

/**
 * Splits a role's tasks into the two columns of the job detail panel.
 *
 * This deliberately does NOT use getTaskCategory. That function answers
 * "how would an analyst label this task" with three buckets, and the panel
 * only renders two of them, which produced a contradiction users could see:
 *
 *   getTaskCategory calls a task Automatable only when AI is high AND human
 *   criticality is low. In this dataset 193 of 250 tasks score high on human
 *   criticality, so tasks sitting at 50-60% AI exposure were classified
 *   Human-Critical and never appeared in the Automation Risk column. The
 *   gauge above, meanwhile, averages AI exposure across every task. The
 *   result: 19 of 50 roles showed a gauge between 26% and 56% above a column
 *   reading "No automatable tasks". A further 10 tasks matched neither
 *   rendered bucket and were invisible in the panel entirely, while still
 *   counting toward the gauge.
 *
 * The panel therefore splits on the one axis the gauge itself measures, AI
 * exposure, so the two can never disagree. Every task lands in exactly one
 * column and none can go missing. A task that is high on BOTH axes is real
 * and common (97 of 250 here); it belongs in the risk column, flagged as
 * hybrid, because that is precisely where "Defend this task" applies.
 */
export function isHybridTask(task: ScoredTask): boolean {
    return (
        task.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE &&
        task.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE
    );
}

export function partitionRoleTasks<T extends ScoredTask>(
    tasks: T[],
    isTrained: (task: T) => boolean = () => false,
): { exposed: T[]; resistant: T[] } {
    // Trained first so a user's own work stays visible, then by the score that
    // earns the task its column.
    const trainedFirst = (a: T, b: T) => Number(isTrained(b)) - Number(isTrained(a));

    const exposed = tasks
        .filter((t) => t.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE)
        .sort((a, b) => trainedFirst(a, b) || b.aiCapabilityScore - a.aiCapabilityScore);

    const resistant = tasks
        .filter((t) => t.aiCapabilityScore < RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE)
        .sort((a, b) => trainedFirst(a, b) || b.humanCriticalityScore - a.humanCriticalityScore);

    return { exposed, resistant };
}
