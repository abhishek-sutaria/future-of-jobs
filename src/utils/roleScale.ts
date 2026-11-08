/**
 * One scale for every scored role. Human Resilience labels, the salary
 * volatility label, the colour bands and every "rank" sentence are worked out
 * against ALL scored roles together, not the 50 Kelley roles alone. Published
 * score values never change here: only where a role sits among the others.
 *
 * WHO IS COUNTED (docs/scoring-decisions.md, "Ranks across all roles"):
 * every scored role on the map, once. That is each of the 50 Kelley titles
 * (with their own published tasks and scores) plus every other scored BLS
 * occupation. Three BLS occupations hold two Kelley titles each (11-2021
 * Marketing / Brand Manager, 15-2051 Business Intelligence Analyst / Data
 * Scientist, 13-1020 Wholesale & Retail Buyer / Purchasing Agent). Each title
 * was scored on its own five tasks and has its own numbers, so each counts as
 * one role; the BLS occupation itself is never counted a second time (a
 * Kelley SOC is never in ai_scores_bls.json). So roles = Kelley titles +
 * other scored occupations, and occupations = roles minus the shared titles.
 *
 * Pure: no store, no Vite, so tests and the rank table script use it directly.
 */

import { PERCENTILES, RESILIENCE_LABELS, VOLATILITY_LABELS } from '../config/constants';
import { buildRiskScale, riskBand, type RiskBand, type RiskScale } from '../config/theme';

/** One scored role: its published Automation Risk and mean Human Criticality. */
export interface ScorePoint {
    key: string;
    /** automationCostIndex: the two-decimal mean task AI capability score. */
    risk: number;
    /** Mean task Human Criticality score. */
    human: number;
}

export interface RoleScale {
    /** How many scored roles the ranks are taken across. */
    count: number;
    risk: RiskScale;
    humanP25: number;
    humanP75: number;
    riskP50: number;
    riskP75: number;
}

/**
 * Means of five two-decimal scores are exact at three decimals, and of four
 * at four (39-5093 Shampooers has four tasks). Four decimals on both sides of
 * every comparison, so float noise (0.5640000001) can never break a tie.
 */
export const roundHuman = (v: number): number => Math.round(v * 10_000) / 10_000;

/** Same rule the app has always used: the value at floor(p × n) of the sorted list. */
const pct = (sorted: number[], p: number): number => sorted[Math.min(Math.floor(p * sorted.length), sorted.length - 1)];

export function buildRoleScale(points: readonly ScorePoint[]): RoleScale {
    const risks = points.map((p) => p.risk).sort((a, b) => a - b);
    const humans = points.map((p) => roundHuman(p.human)).sort((a, b) => a - b);
    return {
        count: points.length,
        risk: buildRiskScale(risks),
        humanP25: pct(humans, PERCENTILES.LOW),
        humanP75: pct(humans, PERCENTILES.HIGH),
        riskP50: pct(risks, PERCENTILES.MEDIUM),
        riskP75: pct(risks, PERCENTILES.HIGH),
    };
}

/** Top quarter of all scored roles Future-Proof, middle half High, bottom quarter At Risk. */
export function resilienceLabelFor(human: number, scale: RoleScale): string {
    const h = roundHuman(human);
    return h >= scale.humanP75 ? RESILIENCE_LABELS.TOP : h >= scale.humanP25 ? RESILIENCE_LABELS.MID : RESILIENCE_LABELS.BOTTOM;
}

export function volatilityLabelFor(risk: number, projectedGrowth: number, scale: RoleScale): string {
    const isHigh = risk >= scale.riskP75;
    if (isHigh && projectedGrowth < 0) return VOLATILITY_LABELS.CRITICAL;
    if (isHigh) return VOLATILITY_LABELS.HIGH;
    if (risk >= scale.riskP50) return VOLATILITY_LABELS.MODERATE;
    return VOLATILITY_LABELS.STABLE;
}

export function bandFor(risk: number, scale: RoleScale): RiskBand {
    return riskBand(risk, scale.risk);
}

/** "among all 786 scored roles", from the data. */
export const rankScopeText = (scale: Pick<RoleScale, 'count'>): string => `among all ${scale.count.toLocaleString('en-US')} scored roles`;
