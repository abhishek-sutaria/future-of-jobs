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
 * Job Security Index color scale — must match the Legend gradient:
 * 0 → cyan #06b6d4 (safe), 0.5 → amber #f59e0b (hybrid), 1 → red #ef4444 (high risk)
 */
const RISK_STOPS: [number, number, number][] = [
    [0x06 / 255, 0xb6 / 255, 0xd4 / 255],
    [0xf5 / 255, 0x9e / 255, 0x0b / 255],
    [0xef / 255, 0x44 / 255, 0x44 / 255],
];

/** Neutral slate for jobs with no automation-risk score yet */
export const RISK_UNSCORED_RGB: [number, number, number] = [0.35, 0.42, 0.5];

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
