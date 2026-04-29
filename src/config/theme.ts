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
