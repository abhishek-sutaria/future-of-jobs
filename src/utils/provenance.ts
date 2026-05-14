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
    BLS_OES: 'BLS OES (occupation employment)',
    BLS_OOH: 'BLS OOH (10-year outlook)',
    BLS_CPS: 'BLS CPS (live series, when loaded)',
    BLS_STATE: 'BLS OES state/geo extract',
    ONET: 'O*NET (tasks & importance)',
    CLAUDE_TASK_SCORE: 'Claude (task-level scores from O*NET text)',
    CLAUDE_FORECAST: 'Claude (cumulative employment path)',
    COVERAGE_FORMULA: 'App (source coverage index, not a BLS statistic)',
    UNAVAILABLE: 'Unavailable',
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
    return 'Coverage index: baseline plus bonuses when BLS live and O*NET-backed fields are present. It is not a statistical margin of error from BLS.';
}
