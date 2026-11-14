/**
 * One rounding rule for every score the app shows.
 *
 * Every task score is published with two decimals (0.00 to 1.00), so it is a
 * whole number of hundredths. A role's mean is worked out in those whole
 * hundredths (integers) and rounded once, halves up. Float maths can round a
 * half down: 39-5093 Shampooers has four tasks whose Human Criticality is
 * 0.95, 0.85, 0.90 and 0.20, a mean of exactly 72.5%, yet 0.725.toFixed(2) is
 * "0.72", so it used to show 72%. This rule shows 73%.
 */

/** A two-decimal score as whole hundredths: 0.29 → 29 (never 28.999…). */
export const toHundredths = (v: number): number => Math.round(v * 100);

/** Mean of two-decimal scores as a whole percent, halves rounded up (72.5 → 73). 0 for an empty list. */
export function meanPercent(values: readonly number[]): number {
    const n = values.length;
    if (n === 0) return 0;
    const sum = values.reduce((s, v) => s + toHundredths(v), 0);
    // round(sum / n) with halves up, in integers only.
    return Math.floor((2 * sum + n) / (2 * n));
}

/** The same mean as a two-decimal 0 to 1 score (a role's Automation Risk index): 0.73. */
export const meanUnit = (values: readonly number[]): number => meanPercent(values) / 100;

/** One two-decimal score as a whole percent. */
export const percentOf = (v: number): number => toHundredths(v);
