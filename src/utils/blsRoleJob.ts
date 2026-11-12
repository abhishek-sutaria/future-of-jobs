/**
 * A scored BLS occupation as a role-panel Job, so it opens the same panel as
 * a Kelley role (components/JobDetailPanel) with the same features: Analyze,
 * Strategic Insight, Roadmap, Scenario, Defend / Build, Save role, Human
 * Resilience.
 *
 * Every value is published data, never invented:
 *   title, employment           BLS OEWS May 2025 (the occupation file)
 *   EP 2025 / 2035, growth      BLS Employment Projections 2025–35
 *   tasks and their scores      ai_scores_bls.json (published, same for everyone)
 *   labels                      the one all-roles scale (utils/roleScale)
 * Sources list only what the repo has for this occupation: no OOH badge (the
 * repo's OOH extract covers the Kelley roles only). Its state employment is
 * not on the Job: the Map view reads it per field (utils/stateMapData).
 */

import type { Job } from '../types';
import { CONFIDENCE, DATA_SOURCES } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { continentOf, INDEX_OCCUPATION_BY_SOC, type OccupationEntry } from './occupationIndex';
import type { BlsRoleScore } from './blsScoresData';
import { BLS_SCORE_HUMAN, BLS_SCORE_RISK } from './blsScores';
import { resilienceLabelFor, volatilityLabelFor, type RoleScale } from './roleScale';
import { blsKey } from './allRoleScale';

/** O*NET's placeholder importance, the same as data.ts uses for the Kelley tasks. */
const UNIFORM_IMPORTANCE = 3;

export const isBlsRoleId = (id: string): boolean => id.startsWith('soc:');
export const socOfBlsRoleId = (id: string): string | null => (isBlsRoleId(id) ? id.slice(4) : null);

export function blsRoleJob(o: OccupationEntry, score: BlsRoleScore, scale: RoleScale): Job {
    const growth = o.ep?.percentChange ?? 0;
    const sources: string[] = [];
    if (o.employment != null) sources.push(DATA_SOURCES.BLS_OES);
    if (o.annualMedian != null || o.hourlyMedian != null || o.annualMean != null || o.hourlyMean != null) sources.push(DATA_SOURCES.BLS_OES_WAGES);
    if (o.ep) sources.push(DATA_SOURCES.BLS_EP);
    if (score.onetCodes.length > 0 || score.tasks.some((t) => t.onetCode)) sources.push(DATA_SOURCES.ONET);
    let confidence = CONFIDENCE.BASELINE;
    if (sources.some((s) => s.includes('BLS'))) confidence += CONFIDENCE.BLS_BONUS;
    if (sources.includes(DATA_SOURCES.ONET)) confidence += CONFIDENCE.ONET_BONUS;
    return {
        id: blsKey(o.soc),
        title: o.title,
        cluster: CONTINENT_DISPLAY_NAMES[continentOf(o.soc)] ?? o.major,
        employment: o.employment ?? 0,
        ...(o.ep ? { epEmployment2025: o.ep.employment2025, epEmployment2035: o.ep.employment2035 } : {}),
        automationCostIndex: score.automationCostIndex,
        projectedGrowth: growth,
        salaryVolatilityLabel: volatilityLabelFor(score.automationCostIndex, growth, scale),
        humanResilienceLabel: resilienceLabelFor(score.humanCriticality, scale),
        confidenceScore: confidence,
        dataSources: sources,
        isAlias: false,
        tasks: score.tasks.map((t) => ({
            name: t.name,
            aiCapabilityScore: t.aiCapabilityScore,
            humanCriticalityScore: t.humanCriticalityScore,
            importance: UNIFORM_IMPORTANCE,
        })),
    };
}

/**
 * A scored occupation from the always-loaded bundle only (title, risk, human
 * mean, EP growth), for lists such as the dashboard that must not load a field
 * per row. No tasks: open the role for those. Null when the SOC is not scored.
 */
export function blsSummaryJob(soc: string, scale: RoleScale): Job | null {
    const occ = INDEX_OCCUPATION_BY_SOC.get(soc);
    const risk = BLS_SCORE_RISK.get(soc);
    const human = BLS_SCORE_HUMAN.get(soc);
    if (!occ || risk === undefined || human === undefined) return null;
    const growth = occ.epPercentChange ?? 0;
    return {
        id: blsKey(soc),
        title: occ.title,
        cluster: CONTINENT_DISPLAY_NAMES[continentOf(soc)] ?? soc.slice(0, 2),
        employment: occ.employment ?? 0,
        ...(occ.epEmployment2025 != null && occ.epEmployment2035 != null
            ? { epEmployment2025: occ.epEmployment2025, epEmployment2035: occ.epEmployment2035 }
            : {}),
        automationCostIndex: risk,
        projectedGrowth: growth,
        salaryVolatilityLabel: volatilityLabelFor(risk, growth, scale),
        humanResilienceLabel: resilienceLabelFor(human, scale),
        confidenceScore: CONFIDENCE.BASELINE,
        dataSources: [],
        isAlias: false,
        tasks: [],
    };
}
