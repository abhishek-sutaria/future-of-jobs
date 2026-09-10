import { RISK_THRESHOLDS } from '../config/constants';

interface ScoredTask {
    name: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

/** High on both axes: AI does much of the task, a person still decides the outcome. */
export function isHybridTask(task: ScoredTask): boolean {
    return (
        task.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE &&
        task.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE
    );
}

/**
 * Splits a role's tasks into the panel's two columns by AI exposure, the same
 * per-task score the Automation Risk gauge averages. Every task lands in exactly
 * one column and shows its score there, so the gauge is the average of the
 * numbers on screen (to within rounding): at or above the line there is always a task in the risk
 * column, and below it an empty risk column is explained (see emptyColumnNote).
 *
 * Deliberately not getTaskCategory: its three-way label also requires LOW human
 * criticality before calling a task automatable, which hid tasks high on both
 * axes and left the risk column empty under a mid-range gauge.
 */
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

/** Roadmap pivots from the most exposed task to the most human-critical one;
 *  chosen independently they can be the same task, i.e. "move from X to X". */
export function pickRoadmapPair<T extends ScoredTask>(tasks: T[]): { riskTask: T | undefined; safeTask: T | undefined } {
    const riskTask = [...tasks].sort((a, b) => b.aiCapabilityScore - a.aiCapabilityScore)[0];
    const safeTask = [...tasks]
        .sort((a, b) => b.humanCriticalityScore - a.humanCriticalityScore)
        .find((t) => t !== riskTask);
    return { riskTask, safeTask };
}

/** What an empty column says: it must square with the gauge above it and never
 *  point at something that isn't on screen. */
export function emptyColumnNote(column: 'exposed' | 'resistant', hasHybrid: boolean): string {
    if (column === 'exposed') {
        return `No single task here reaches ${RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE * 100}% automation exposure. This role’s risk score comes from AI handling parts of many tasks rather than taking over any one of them.`;
    }
    return hasHybrid
        ? 'Every task in this role carries significant AI exposure. Those marked Hybrid still depend on human judgment.'
        : 'Every task in this role carries significant AI exposure.';
}
