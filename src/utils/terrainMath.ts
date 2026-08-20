import { SHADER, YEAR_MIN, YEAR_MAX, YEAR_COUNT } from '../config/constants';
import type { Job } from '../types';
import { CLUSTER_ORDER, getFunctionalCluster, type FunctionalCluster } from '../config/clusters';
import { MAP_TITLE_TO_SOC } from './onet';

// Per-year growth values come from Claude's forecast (cumulative percent change
// from the 2025 baseline, grounded in real BLS + O*NET inputs). When Claude
// has not produced a forecast yet, cumulative % is a linear ramp from 0% at
// YEAR_MIN to the job's BLS OOH projectedGrowth at YEAR_MAX (single official anchor).

// Constants for Landscape Generation
export const TERRAIN_CONFIG = {
    // Gaussian Shape — derived from SHADER constants (single source of truth)
    /** Sigma (Gaussian spread). Must match SHADER.SIGMA_SQ2 = 2 * PEAK_WIDTH^2. */
    PEAK_WIDTH: Math.sqrt(SHADER.SIGMA_SQ2 / 2),
    /** Height multiplier. Must match SHADER.HEIGHT_SCALE. */
    PEAK_HEIGHT_SCALE: SHADER.HEIGHT_SCALE,

    // World Position
    TERRAIN_OFFSET_Y: -3.0, // Move terrain down so peaks rise up
};

export const VISUAL_CONFIG = {
    BASE_HEIGHT: 1.0,
    GROWTH_SCALER: SHADER.GROWTH_DAMPENING,
    DECLINE_SCALER: SHADER.DECLINE_DAMPENING,
    MIN_HEIGHT: SHADER.HEIGHT_CLAMP_MIN,
    MAX_HEIGHT: SHADER.HEIGHT_CLAMP_MAX,
    DECLINE_TINT_MAX: SHADER.DECLINE_TINT_MAX,
};

export interface PeakData {
    x: number;
    z: number;
    height: number; // 0 to 1 normalized
}

// Cluster-territory layout: each functional cluster owns a contiguous angular
// sector of the disc (related clusters adjacent, see CLUSTER_ORDER), filled with
// concentric arcs. Within a sector, jobs are ordered by SOC code so occupationally
// similar roles sit next to each other.
const TERRITORY_LAYOUT = {
    /** Innermost arc radius */
    R_MIN: 7,
    /** Outermost usable radius — must stay inside the shader edge fade (~32 for the 70-unit plane) */
    R_MAX: 30,
    /** Radial gap between arcs; also min arc length per job (≥ 2× PEAK_WIDTH so peaks stay legible) */
    RING_SPACING: 5,
    /** Angular gap between adjacent sectors (radians) */
    GAP_RAD: 0.06,
    /** Smallest sector span before normalization (radians) */
    MIN_SPAN_RAD: 0.25,
};

export function computeClusterTerritoryLayout(jobs: Job[]): Map<string, { x: number; z: number }> {
    const positions = new Map<string, { x: number; z: number }>();
    if (jobs.length === 0) return positions;

    const groups = new Map<FunctionalCluster, Job[]>();
    for (const job of jobs) {
        const cluster = getFunctionalCluster(job.title);
        const members = groups.get(cluster);
        if (members) members.push(job);
        else groups.set(cluster, [job]);
    }

    const ordered = CLUSTER_ORDER.filter((c) => groups.has(c));
    const usable = Math.PI * 2 - TERRITORY_LAYOUT.GAP_RAD * ordered.length;

    // Sector spans proportional to job count, clamped to a minimum, then renormalized
    let spans = ordered.map((c) =>
        Math.max(TERRITORY_LAYOUT.MIN_SPAN_RAD, (usable * groups.get(c)!.length) / jobs.length)
    );
    const spanSum = spans.reduce((a, b) => a + b, 0);
    spans = spans.map((s) => (s * usable) / spanSum);

    let theta0 = 0;
    ordered.forEach((cluster, ci) => {
        const span = spans[ci];
        const members = [...groups.get(cluster)!].sort((a, b) => {
            const socA = MAP_TITLE_TO_SOC[a.title] ?? a.title;
            const socB = MAP_TITLE_TO_SOC[b.title] ?? b.title;
            return socA === socB ? a.title.localeCompare(b.title) : socA.localeCompare(socB);
        });

        let placed = 0;
        let r = TERRITORY_LAYOUT.R_MIN;
        while (placed < members.length) {
            const onOuterEdge = r >= TERRITORY_LAYOUT.R_MAX;
            const capacity = Math.max(1, Math.floor((span * r) / TERRITORY_LAYOUT.RING_SPACING));
            const ringCount = onOuterEdge
                ? members.length - placed // overflow safety: everything left goes on the outer arc
                : Math.min(capacity, members.length - placed);

            for (let k = 0; k < ringCount; k++) {
                const theta = theta0 + span * ((k + 0.5) / ringCount);
                const job = members[placed + k];
                positions.set(job.id, { x: r * Math.cos(theta), z: r * Math.sin(theta) });
            }
            placed += ringCount;
            r = Math.min(r + TERRITORY_LAYOUT.RING_SPACING, TERRITORY_LAYOUT.R_MAX);
        }

        theta0 += span + TERRITORY_LAYOUT.GAP_RAD;
    });

    return positions;
}

// One layout per jobs array instance (store replaces the array on data updates;
// ids/titles never change at runtime, so positions are stable across filtering).
const layoutCache = new WeakMap<readonly Job[], Map<string, { x: number; z: number }>>();

export const getTerrainPosition = (index: number, jobs: Job[]): { x: number, z: number } => {
    let layout = layoutCache.get(jobs);
    if (!layout) {
        layout = computeClusterTerritoryLayout(jobs);
        layoutCache.set(jobs, layout);
    }
    const job = jobs[index];
    return (job && layout.get(job.id)) || { x: 0, z: 0 };
};

// Gaussian function: A * exp( -dist^2 / (2*sigma^2) )
export const calculateGaussianHeight = (x: number, z: number, peaks: PeakData[]): number => {
    let totalHeight = 0;
    const sigmaSq2 = 2 * Math.pow(TERRAIN_CONFIG.PEAK_WIDTH, 2);

    peaks.forEach(peak => {
        const dx = x - peak.x;
        const dz = z - peak.z;
        const distSq = dx * dx + dz * dz;

        // Influence of this peak
        const influence = peak.height * Math.exp(-distSq / sigmaSq2);
        totalHeight += influence;
    });

    return totalHeight * TERRAIN_CONFIG.PEAK_HEIGHT_SCALE;
};

export const getVisualHeightForGrowth = (growthDelta: number): number => {
    const scaler = growthDelta >= 0 ? VISUAL_CONFIG.GROWTH_SCALER : VISUAL_CONFIG.DECLINE_SCALER;
    const impact = growthDelta * scaler;
    return Math.max(VISUAL_CONFIG.MIN_HEIGHT, Math.min(VISUAL_CONFIG.MAX_HEIGHT, VISUAL_CONFIG.BASE_HEIGHT + impact));
};

/**
 * Log-scaled height from employment count. Maps roughly:
 *   1,000 workers   → ~0.5  (short peak)
 *   100,000 workers → ~2.5  (medium peak)
 *   10M workers     → ~4.5  (tall peak)
 * Output is clamped to the same visual range as the growth-mode height.
 */
export const getVisualHeightForEmployment = (employment: number): number => {
    const safe = Math.max(1, employment);
    const logE = Math.log10(safe);
    const minLog = 3;  // log10(1,000)
    const maxLog = 7;  // log10(10,000,000)
    const normalized = (logE - minLog) / (maxLog - minLog);
    const clamped = Math.max(0, Math.min(1, normalized));
    return Math.max(VISUAL_CONFIG.MIN_HEIGHT, Math.min(VISUAL_CONFIG.MAX_HEIGHT, 0.5 + clamped * 4.0));
};

/**
 * Implied headcount at a given point on the forecast: baseline × (1 + cumulative%/100).
 * Shared by the Workers-mode terrain height below and the job popup's Workers stat —
 * both must derive the same number from the same forecast sample.
 */
export function impliedEmploymentAtYear(
    baselineEmployment: number,
    cumulativePctFromBaseline: number,
): number {
    return Math.max(1, baselineEmployment * (1 + cumulativePctFromBaseline / 100));
}

/**
 * Workers mode: mostly log-scaled **implied** headcount (baseline × (1 + cumulative%/100)),
 * with amplified delta from baseline employment height, plus a small blend of the same
 * Growth-mode height mapping so the year scrub reads clearly. Cumulative % in data is unchanged.
 */
export function getVisualHeightForWorkersAtYear(
    baselineEmployment: number,
    cumulativePctFromBaseline: number,
): number {
    const implied = impliedEmploymentAtYear(baselineEmployment, cumulativePctFromBaseline);
    const hBase = getVisualHeightForEmployment(baselineEmployment);
    const hImplied = getVisualHeightForEmployment(implied);
    const delta = hImplied - hBase;
    const hEmploymentLed = hBase + delta * SHADER.WORKERS_HEIGHT_DELTA_AMPLIFIER;

    const hGrowthLed = getVisualHeightForGrowth(cumulativePctFromBaseline);
    const b = SHADER.WORKERS_GROWTH_STYLE_BLEND;
    const mixed = hEmploymentLed * (1 - b) + hGrowthLed * b;

    return Math.max(VISUAL_CONFIG.MIN_HEIGHT, Math.min(VISUAL_CONFIG.MAX_HEIGHT, mixed));
}

export const getDeclineTintStrength = (growthDelta: number): number => {
    if (growthDelta >= 0) return 0;
    return Math.min(VISUAL_CONFIG.DECLINE_TINT_MAX, Math.abs(growthDelta) * 0.08);
};

export const getCurrentYearGrowth = (job: Job, year: number): { value: number; source: 'ai' | 'baseline' } => {
    if (job.yearlyForecast && job.yearlyForecast.length > 0) {
        const t = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
        const y1 = Math.floor(t);
        const y2 = Math.ceil(t);
        const f = t - y1;
        const item1 = job.yearlyForecast.find((x) => x.year === y1);
        const item2 = job.yearlyForecast.find((x) => x.year === y2);
        // Year 2025 is the baseline (0% change by definition) when Claude
        // didn't include it; other years that Claude didn't include fall back
        // to whichever value is available.
        const val1 = item1 ? item1.growthImpact : (y1 === YEAR_MIN ? 0 : (item2?.growthImpact ?? 0));
        const val2 = item2 ? item2.growthImpact : (y2 === YEAR_MIN ? 0 : (item1?.growthImpact ?? 0));
        return { value: val1 * (1 - f) + val2 * f, source: 'ai' };
    }

    const t = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
    const span = YEAR_MAX - YEAR_MIN;
    const frac = span > 0 ? (t - YEAR_MIN) / span : 0;
    const cumulative = job.projectedGrowth * frac;

    return { value: cumulative, source: 'baseline' };
};

/**
 * Integer-year growth % table — same layout Terrain.tsx uploads before fractional
 * interpolation in useFrame (must stay in lockstep with the GPU path).
 */
export function buildGrowthForecastFlatArray(filteredJobs: Job[]): Float32Array {
    const forecasts = new Float32Array(SHADER.FORECAST_ARRAY_SIZE);
    filteredJobs.forEach((job, jobIdx) => {
        if (jobIdx >= SHADER.MAX_JOBS) return;
        for (let year = YEAR_MIN; year <= YEAR_MAX; year++) {
            const yearIdx = year - YEAR_MIN;
            const flatIdx = jobIdx * YEAR_COUNT + yearIdx;
            const fallbackImpact = getCurrentYearGrowth(job, year).value;
            if (job.yearlyForecast) {
                const item = job.yearlyForecast.find((f) => f.year === year);
                forecasts[flatIdx] = item ? item.growthImpact : fallbackImpact;
            } else {
                forecasts[flatIdx] = fallbackImpact;
            }
        }
    });
    return forecasts;
}

/**
 * Fractional-year interpolation over {@link buildGrowthForecastFlatArray} —
 * must match Terrain useFrame growth sampling (and Growth-mode shader height).
 */
export function growthAtYearFromForecastFlat(
    forecasts: ArrayLike<number>,
    jobIndex: number,
    year: number,
): number {
    const t = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
    const y1 = Math.floor(t);
    const y2 = Math.ceil(t);
    const offset1 = y1 - YEAR_MIN;
    const offset2 = y2 - YEAR_MIN;
    const idx1 = jobIndex * YEAR_COUNT + offset1;
    const idx2 = jobIndex * YEAR_COUNT + offset2;
    const val1 = Number(forecasts[idx1] ?? 0);
    const val2 = Number(forecasts[idx2] ?? 0);
    const f = t - y1;
    return val1 * (1 - f) + val2 * f;
}
