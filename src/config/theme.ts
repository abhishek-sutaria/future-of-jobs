/**
 * Shared Design Tokens for Non-Tailwind Components (e.g. D3 Charts)
 * specific values must match tailwind.config.js
 */
export const CHART_COLORS = {
    success: '#22c55e', // green-500
    warning: '#f59e0b', // amber-500
    danger: '#ef4444',  // red-500
    primary: '#06b6d4', // cyan-500
    text: '#9ca3af',    // gray-400
    grid: '#374151'     // gray-700
};

export const CLUSTER_COLORS: Record<string, string> = {
    "Marketing": "#ec4899",         // Pink
    "Information Technology": "#3b82f6", // Blue
    "Finance": "#22c55e",           // Green
    "Business Management": "#8b5cf6", // Purple
    "Logistics": "#f97316",         // Orange
    "Sales": "#f59e0b",             // Amber
    "Data Science": "#06b6d4",      // Cyan
    "Business": "#94a3b8"           // Slate (Fallback)
};

export const FALLBACK_COLORS = [
    '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7'
];

/** Phase progression colors for roadmap timeline */
export const PHASE_COLORS = ['border-cyan-500', 'border-blue-500', 'border-purple-500'];

/**
 * Job Security Index scale — green (safe) → amber (hybrid) → red (high risk).
 * The Legend renders these same three colours, so it keys both the terrain
 * gradient and the discrete label dots.
 */
export const RISK_BAND_COLORS = {
    safe: '#22c55e',
    hybrid: '#f59e0b',
    high: '#ef4444',
} as const;

const hexToRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
];

const RISK_STOPS: [number, number, number][] = [
    hexToRgb(RISK_BAND_COLORS.safe),
    hexToRgb(RISK_BAND_COLORS.hybrid),
    hexToRgb(RISK_BAND_COLORS.high),
];

/** Neutral slate for jobs with no automation-risk score yet */
export const RISK_UNSCORED_RGB: [number, number, number] = [0.35, 0.42, 0.5];

/** Continuous green→amber→red ramp. Used for the terrain, where nuance is wanted. */
export function riskColorRGB(t: number): [number, number, number] {
    const u = Math.min(1, Math.max(0, t)) * 2;
    const i = u < 1 ? 0 : 1;
    const f = u - i;
    const a = RISK_STOPS[i];
    const b = RISK_STOPS[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function riskColorHex(t: number): string {
    return '#' + riskColorRGB(t).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

// ── Relative risk banding ───────────────────────────────────────────────────
//
// Raw scores only occupy a narrow slice of 0..1 (roughly 0.26–0.72 today), so
// colouring them absolutely leaves nearly every role amber and never reaches the
// green or red ends of the scale. Both the dots and the terrain therefore work
// off the distribution of the CURRENT scores instead of fixed cut-offs.
//
// Thresholds are derived at runtime rather than hard-coded so they stay balanced
// when scores are regenerated or refreshed.

export interface RiskScale {
    /** Tercile boundaries for the three discrete bands */
    lower: number;
    upper: number;
    /** Range used to stretch the continuous ramp across the full green→red span */
    min: number;
    max: number;
}

const percentile = (sorted: number[], p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];

/**
 * Build the scale from every scored role. Callers must pass the FULL job list,
 * never a filtered subset, or a role's colour would change when filters change.
 */
export function buildRiskScale(scores: number[]): RiskScale {
    const scored = scores.filter(s => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
    if (scored.length < 3) return { lower: 0.4, upper: 0.65, min: 0, max: 1 };
    return {
        lower: percentile(scored, 1 / 3),
        upper: percentile(scored, 2 / 3),
        // p5–p95 rather than min/max so a single outlier can't flatten everyone else.
        min: percentile(scored, 0.05),
        max: percentile(scored, 0.95),
    };
}

export type RiskBand = 'safe' | 'hybrid' | 'high';

/** Discrete band for the label dot — a bold, unambiguous verdict. */
export function riskBand(score: number, scale: RiskScale): RiskBand {
    if (score >= scale.upper) return 'high';
    if (score >= scale.lower) return 'hybrid';
    return 'safe';
}

export function riskBandColor(score: number, scale: RiskScale): string {
    return RISK_BAND_COLORS[riskBand(score, scale)];
}

/** Normalise a raw score onto 0..1 across the observed range, for the terrain ramp. */
export function normalizeRisk(score: number, scale: RiskScale): number {
    const span = scale.max - scale.min;
    if (span <= 1e-6) return 0.5;
    return Math.min(1, Math.max(0, (score - scale.min) / span));
}
