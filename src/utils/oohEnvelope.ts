import { OOH_FRACTION_AT_YEAR_MAX } from '../config/constants.js';

/**
 * Max cumulative % a baked AI forecast may reach by 2030 for a given OOH figure.
 *
 * Its own module, with no data imports, so the Node score generators
 * (scripts/generate_ai_scores.ts, scripts/generate_bls_scores.ts) can load
 * taskScoring.ts: terrainMath.ts pulls in occupationIndex.ts, whose
 * import.meta.glob only exists under Vite. terrainMath re-exports it.
 */
export function oohEnvelopeCap(projectedGrowth: number): number {
    return projectedGrowth * OOH_FRACTION_AT_YEAR_MAX;
}

/**
 * The cap as the scoring prompt states it, at two decimals. The forecast check
 * reads this same value, so a forecast on the cap the prompt gave Claude passes.
 */
export function oohEnvelopeCapLabel(projectedGrowth: number): string {
    return oohEnvelopeCap(projectedGrowth).toFixed(2);
}
