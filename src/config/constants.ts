/**
 * Application-wide constants — single source of truth.
 * Every magic number, threshold, and label referenced in the app lives here.
 */

// ── Simulation Time Range ──────────────────────────────────────────
export const YEAR_MIN = 2025;
export const YEAR_MAX = 2030;
export const YEAR_RANGE = YEAR_MAX - YEAR_MIN;       // 5
export const YEAR_COUNT = YEAR_RANGE + 1;             // 6 years (2025–2030 inclusive)

// ── Data Sources (metadata for seed data) ──────────────────────────
// BLS_OES is the NATIONAL per-role headcount baked into src/data.ts (drives
// terrain height, the Workers stat, and the "OES" provenance badge). BLS_STATE
// is a SEPARATE vintage: the state-level breakdown in src/data/geo_real.json
// that drives the 2D map (see that file's own _meta.bls_release for its
// current vintage — it is not guaranteed to match BLS_OES). Keep this literal
// in sync with every `dataSources` array in src/data.ts; a mismatch silently
// removes the OES badge (see src/utils/provenance.ts) with no test failure —
// src/__tests__/oesVintage.test.ts guards this.
export const DATA_SOURCES = {
    BLS_OES: 'BLS-OES-2025',
    BLS_OOH: 'BLS-OOH-2024-34',
    BLS_CPS: 'BLS-CPS (Live)',
    BLS_STATE: 'BLS-OES-State',
    ONET: 'ONET',
} as const;

export const DEFAULT_DATA_SOURCES = [DATA_SOURCES.BLS_OES, DATA_SOURCES.BLS_OOH] as const;

// ── BLS API ────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();

export const BLS_API = {
    PROXY_URL: '/api/bls',
    // Derived from the current date rather than hardcoded — the previous
    // literal ('2023'..'2025') silently went stale as the calendar moved on.
    // A 3-year window is plenty for a live unemployment-rate fetch.
    START_YEAR: String(CURRENT_YEAR - 2),
    END_YEAR: String(CURRENT_YEAR),
    /** Unemployment rate threshold — green below, red above */
    UNEMPLOYMENT_THRESHOLD: 4.5,
    /** BLS unemployment rate series ID */
    UNEMPLOYMENT_SERIES_ID: 'LNS14000000',
} as const;


// ── Risk & Classification Thresholds ───────────────────────────────
export const RISK_THRESHOLDS = {
    /**
     * AI capability score above which a task may be considered automatable.
     * 0.5, not 0.6: a 0.6 cutoff left mid-range tasks (e.g. 0.53 AI / 0.47 human)
     * failing BOTH tests and silently missing from the risk AND human-skills cards.
     * Report cards must still use getTaskCategory() so mixed-score tasks never appear
     * in both buckets.
     */
    AUTOMATABLE_AI_SCORE: 0.5,
    /** Human criticality score above which a task is human-critical. Paired with the above. */
    HUMAN_CRITICAL_SCORE: 0.5,
    /** Human score below which a task is considered automatable (combined with AI score) */
    AUTOMATABLE_HUMAN_CEILING: 0.5,
    /** Projected AI capability above which future risk is flagged */
    PROJECTED_HIGH_RISK_AI: 0.7,
    /** Projected human criticality above which future is considered insulated */
    PROJECTED_INSULATED_HUMAN: 0.65,
    /** Low automation cost threshold (inverted: higher cost = harder to automate) */
    LOW_AUTOMATION_COST: 0.6,
    /** Threshold for labelling human resilience as "High" */
    RESILIENCE_HIGH: 0.7,
    /** Threshold for labelling human resilience as "Medium" (below = "Low") */
    RESILIENCE_MEDIUM: 0.4,
    /** Threshold for labelling salary volatility as "High" */
    VOLATILITY_HIGH: 0.7,
    /** Threshold for labelling salary volatility as "Moderate" (below = "Stable") */
    VOLATILITY_MODERATE: 0.4,
} as const;

// ── Percentile Classification ──────────────────────────────────────
export const PERCENTILES = {
    HIGH: 0.75,
    MEDIUM: 0.50,
    LOW: 0.25,
} as const;

// ── Labels ─────────────────────────────────────────────────────────
export const RESILIENCE_LABELS = {
    TOP: 'Future-Proof',
    MID: 'High',
    BOTTOM: 'At Risk',
} as const;

export const VOLATILITY_LABELS = {
    CRITICAL: 'Critical',
    HIGH: 'High',
    MODERATE: 'Moderate',
    STABLE: 'Stable',
} as const;

// ── Confidence Scoring ─────────────────────────────────────────────
export const CONFIDENCE = {
    BASELINE: 0.5,
    BLS_BONUS: 0.25,
    ONET_BONUS: 0.25,
} as const;

// ── 3D Scene ───────────────────────────────────────────────────────
export const SCENE = {
    CAMERA_INITIAL_POSITION: [0, 35, 55] as readonly [number, number, number],
    CAMERA_FOV: 45,
    FOG_COLOR: '#0a0e17',
    FOG_NEAR: 20,
    FOG_FAR: 120,
    MIN_CAMERA_DISTANCE: 10,
    MAX_CAMERA_DISTANCE: 100,
    MAX_POLAR_ANGLE: Math.PI / 2.2,
    PLANE_SIZE: 70,
    /** Camera distance thresholds for Level-of-Detail */
    LOD: {
        FAR: 80,
        MID: 50,
    },
    /** Collision detection for label staggering */
    LABEL: {
        COLLISION_DISTANCE: 6.0,
        VERTICAL_OFFSET: 1.8,
        /**
         * Equal-length leader line height above the peak surface. Raised so labels
         * sit clear of the topography (Ray feedback). Keep STAGGER_ENABLED false
         * while evaluating; flip to true if overlap returns.
         */
        BASE_HEIGHT: 5.2,
        /**
         * When false every leader line is BASE_HEIGHT, so a label's height on screen
         * mirrors the terrain beneath it — the tallest labels are the fastest-growing
         * roles. When true, crowded labels are lifted in VERTICAL_OFFSET steps to stop
         * them overlapping, which reads more cleanly but makes label height meaningless.
         * Flip this single value to switch between the two.
         */
        STAGGER_ENABLED: false,
    },
    /** Major job visibility threshold at far LOD */
    MAJOR_GROWTH_THRESHOLD: 5,
    /** Show every Nth job at far LOD */
    LOD_FILTER_MODULO: 5,
    /** 3D anchor geometry for job label pins */
    ANCHOR: {
        RING_INNER: 0.1,
        RING_OUTER: 0.2,
        RING_SEGMENTS: 16,
        SPHERE_RADIUS: 0.1,
    },
} as const;

// ── Particles ──────────────────────────────────────────────────────
export const PARTICLES = {
    POSITION_SPREAD: 80,
    MIN_HEIGHT: 2,
    MAX_HEIGHT: 22,     // MIN_HEIGHT + 20
    /** Particle counts keyed by hardware tier */
    COUNTS: {
        LOW: 50,       // ≤2 cores
        MEDIUM: 150,   // ≤4 cores
        HIGH: 300,     // >4 cores
    },
    CORE_THRESHOLDS: {
        LOW: 2,
        MEDIUM: 4,
    },
    SIZE: 0.15,
    ROTATION_SPEED: 0.05,
} as const;

// ── Shader Constants (must match GLSL) ─────────────────────────────
export const SHADER = {
    SIGMA_SQ2: 8.0,         // 2 * PEAK_WIDTH^2 = 2 * 2.0^2 = 8.0 — tighter peaks for 50-job density
    HEIGHT_SCALE: 2.5,
    /** Dampening multiplier for growth→height conversion in shader */
    GROWTH_DAMPENING: 0.08,
    /** Stronger dampening for negative growth so decline reads clearly */
    DECLINE_DAMPENING: 0.45,
    HEIGHT_CLAMP_MIN: 0.1,
    HEIGHT_CLAMP_MAX: 5.0,
    DECLINE_TINT_MAX: 0.65,
    MAX_JOBS: 50,
    FORECAST_ARRAY_SIZE: 300, // MAX_JOBS * YEAR_COUNT
    /** Gaussian steepness exponent for JobMesh bell-curve LatheGeometry */
    BELL_CURVE_DECAY: 3.5,
    /**
     * Workers mode only: stretches peak height change from baseline→implied headcount
     * when the year scrub updates cumulative %. Does not alter stored % or data.
     */
    WORKERS_HEIGHT_DELTA_AMPLIFIER: 3.45,
    /**
     * Workers mode: mix in this fraction of Growth-mode height (same cumulative % dampers)
     * so the scrub feels responsive; remainder stays employment-led implied headcount path.
     */
    WORKERS_GROWTH_STYLE_BLEND: 0.28,
} as const;

// ── Chart Defaults ─────────────────────────────────────────────────
export const CHART = {
    IMPACT_MATRIX: {
        WIDTH: 300,
        HEIGHT: 220,
        MARGIN: { top: 20, right: 20, bottom: 40, left: 40 },
    },
    TASK_COMPOSITION: {
        WIDTH: 300,
        HEIGHT: 40,
    },
    SPARKLINE: {
        DEFAULT_COLOR: '#22d3ee',  // cyan-400
        WIDTH: 120,
        HEIGHT: 40,
    },
    RADIAL_GAUGE: {
        SIZE: 120,
        STROKE_WIDTH: 8,
        /** Thresholds for green→yellow→red */
        COLOR_LOW: 0.3,
        COLOR_HIGH: 0.6,
    },
} as const;

// ── UI ─────────────────────────────────────────────────────────────
export const UI = {
    SEARCH_DEBOUNCE_MS: 200,
    TOAST_DURATION_MS: 4000,
    SIDEBAR_WIDTH_REM: 20,    // w-80 = 20rem
    INTRO_STORAGE_KEY: 'foj_intro_dismissed',
    /** Max tasks to show in filtered lists */
    MAX_TASK_PREVIEW: 3,
    /** Word count above which text renders as paragraph vs chips */
    LONG_TEXT_WORD_THRESHOLD: 8,
} as const;

// ── Task Category Colors (for charts) ──────────────────────────────
export const TASK_CATEGORY_COLORS = {
    'Automatable': '#ef4444',
    'Augmentable': '#3b82f6',
    'Human-Critical': '#22c55e',
} as const;

// ── Shader Visual Constants (fragment shader) ────────────────────
export const SHADER_VISUAL = {
    GRID_FREQUENCY: 60,
    GRID_THRESHOLD: 0.98,
    /**
     * Elevation range over which a peak's risk colour fades in. Previously 1.5→4.0,
     * which tied colour strength to height: at 2025 every peak sits at the baseline,
     * so the average peak showed only ~38% of its colour and none reached full — the
     * whole terrain read as an undifferentiated wash exactly where users start.
     * Starting at 0 means risk colour is legible at any height; the ceiling is kept
     * low so tall peaks still saturate.
     */
    HEIGHT_MIX_MIN: 0.0,
    HEIGHT_MIX_MAX: 2.0,
    ISOLINE_FREQUENCY: 4.0,
    ISOLINE_THRESHOLD: 0.95,
    MOUSE_HIGHLIGHT_FALLOFF: 3.0,
    /** Edge fade alpha thresholds — must be > max job UV radius (50 jobs = 0.45) */
    EDGE_FADE_START: 0.46,
    EDGE_FADE_END: 0.52,
} as const;

// ── Shader Colors (vec3 values for GLSL) ─────────────────────────
export const SHADER_COLORS = {
    TERRAIN_DEFAULT: 'vec3(0.05, 0.1, 0.2)',
    TERRAIN_BASE: 'vec3(0.06, 0.09, 0.13)',
    GRID: 'vec3(0.2, 0.25, 0.35)',
    ISOLINE_DARK: 'vec3(0.3, 0.4, 0.5)',
    ISOLINE_BRIGHT: 'vec3(1.0)',
    CURSOR: 'vec3(0.3, 0.5, 0.7)',
    RIM_LIGHTING: 'vec3(0.2, 0.3, 0.4)',
} as const;

// ── Animation Constants ──────────────────────────────────────────
export const ANIMATIONS = {
    PULSE_DECAY: 0.05,
    PULSE_AMPLITUDE: 0.2,
    HIGH_RISK_GROWTH_RATE: 0.95,
    LOW_RISK_GROWTH_RATE: 1.02,
    EMPLOYMENT_HEIGHT_DIVISOR: 500000,
    COLOR_LERP_SPEED: 0.1,
    /** Employment threshold above which floating labels always show */
    MAJOR_EMPLOYMENT_THRESHOLD: 1500000,
    /** On mobile, only this many highest-employment roles get a floating
     * terrain label by default (plus whichever is selected/hovered) — all 50
     * fully rendered labels overlap into an unreadable mass on a phone
     * screen. Every role stays reachable via search regardless. */
    MOBILE_LABEL_COUNT: 5,
    /** Automation cost index above which a "saved" job is flagged */
    SAVED_AUTOMATION_THRESHOLD: 0.7,
    /** Emissive intensity for highlighted (saved) mesh state */
    EMISSIVE_INTENSITY_HIGHLIGHTED: 1.0,
    /** Emissive intensity for normal holographic mesh state */
    EMISSIVE_INTENSITY_NORMAL: 0.5,
} as const;

// ── Map View Constants ───────────────────────────────────────────
export const MAP_VIEW = {
    MARKER_MIN_SIZE: 24,
    MARKER_MAX_SIZE: 56,
    MARKER_SCALE_MULTIPLIER: 4,
} as const;

// ── Job Icon Keyword Mappings ─────────────────────────────────────
export const JOB_ICON_KEYWORDS: [string[], string][] = [
    [['Nurse', 'Health', 'Doctor'], '⚕️'],
    [['Data', 'Entry', 'Software'], '⌨️'],
    [['Analyst', 'Finance', 'Accountant'], '📊'],
    [['Manager', 'Executive'], '💼'],
    [['Sales', 'Retail'], '🏷️'],
    [['Driver'], '🚚'],
];
export const JOB_ICON_DEFAULT = '⚡';

// ── Risk Color Mapping ─────────────────────────────────────────────
export const RISK_COLORS: Record<string, string> = {
    HIGH: '#ef4444',    // red-500
    MEDIUM: '#fbbf24',  // amber-400
    LOW: '#22c55e',     // green-500
};
