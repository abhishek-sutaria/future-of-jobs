import type { Job } from '../types';
import { DATA_SOURCES } from '../config/constants';

/** Traceable origin for a value shown in the UI (labor-market claims). */
export type DataProvenance =
    | 'BLS_OES'
    | 'BLS_OOH'
    | 'BLS_CPS'
    | 'BLS_STATE'
    | 'ONET'
    | 'CLAUDE_TASK_SCORE'
    | 'CLAUDE_FORECAST'
    | 'COVERAGE_FORMULA'
    | 'UNAVAILABLE';

const PROVENANCE_LABEL: Record<DataProvenance, string> = {
    BLS_OES: 'How many people in the U.S. have this job today. Comes from the government’s main employment survey (BLS OES).',
    BLS_OOH: 'How much this job is expected to grow or shrink over the next 10 years (2024–2034). Comes from the government’s job outlook handbook (BLS OOH).',
    BLS_CPS: 'Live U.S. unemployment rate from the government’s household survey (BLS CPS). This is the national rate — not a count of people in this specific job.',
    BLS_STATE: 'How many people have this job in each U.S. state. Used to color the U.S. map view.',
    ONET: 'The day-to-day tasks listed for this job. Comes from O*NET, a government job-description database.',
    CLAUDE_TASK_SCORE: 'For each task, AI rated how easy it is to automate and how much a human is still needed. Those scores power the risk numbers you see.',
    CLAUDE_FORECAST: 'A year-by-year guess of how employment for this job may change, created by AI using the government’s 10-year outlook as a guide.',
    COVERAGE_FORMULA: 'An in-app score for how complete our data is for this job. Not an official government statistic.',
    UNAVAILABLE: 'This information is not available right now.',
};

export function provenanceLabel(p: DataProvenance): string {
    return PROVENANCE_LABEL[p];
}

/** Map bundled `dataSources` strings to provenance chips for the panel header. */
export function jobSourceProvenanceChips(job: Job): { key: string; label: string; provenance: DataProvenance }[] {
    const chips: { key: string; label: string; provenance: DataProvenance }[] = [];
    const src = new Set(job.dataSources);

    if (src.has(DATA_SOURCES.BLS_OES)) chips.push({ key: 'oes', label: 'OES', provenance: 'BLS_OES' });
    if (src.has(DATA_SOURCES.BLS_OOH)) chips.push({ key: 'ooh', label: 'OOH', provenance: 'BLS_OOH' });
    if (src.has(DATA_SOURCES.BLS_CPS)) chips.push({ key: 'cps', label: 'CPS', provenance: 'BLS_CPS' });
    if (src.has(DATA_SOURCES.BLS_STATE)) chips.push({ key: 'st', label: 'State OES', provenance: 'BLS_STATE' });
    if (src.has(DATA_SOURCES.ONET)) chips.push({ key: 'onet', label: 'O*NET', provenance: 'ONET' });

    const hasClaudeTasks = job.tasks.some((t) => t.aiCapabilityScore > 0 || t.humanCriticalityScore > 0);
    if (hasClaudeTasks) chips.push({ key: 'ai', label: 'Claude tasks', provenance: 'CLAUDE_TASK_SCORE' });
    if (job.yearlyForecast?.length) chips.push({ key: 'fc', label: 'Claude forecast', provenance: 'CLAUDE_FORECAST' });

    return chips;
}

export function dataCoverageTooltip(): string {
    return 'Shows how complete our data is for this job. It is not a government accuracy rating.';
}
