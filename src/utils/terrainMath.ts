import { SHADER, YEAR_MIN, YEAR_MAX, YEAR_COUNT } from '../config/constants';
import type { Job } from '../types';

// Per-year growth values come from Claude's forecast (cumulative percent change
// from the 2025 baseline, grounded in real BLS + O*NET inputs). When Claude
// hasn't yet analyzed a job, the peak stays at neutral baseline (0% change)
// rather than fabricating an intermediate value.

// Constants for Landscape Generation
export const TERRAIN_CONFIG = {
    // Spatial Layout
    GRID_RADIUS_FACTOR: 4.5, // Keep outer peaks inside plane (70x70) — scaled for 50 jobs (max radius ~31.5)
    /** Golden angle (°) for Fibonacci sunflower spiral — optimal point distribution */
    GOLDEN_ANGLE: 137.5,

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

// Deterministic position (Spiral / Sunflower)
export const getTerrainPosition = (index: number): { x: number, z: number } => {
    const angle = index * TERRAIN_CONFIG.GOLDEN_ANGLE * (Math.PI / 180);
    const radius = TERRAIN_CONFIG.GRID_RADIUS_FACTOR * Math.sqrt(index);
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    return { x, z };
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
 * Workers mode: peak height follows **BLS headcount only** (log-scaled), same as
 * the static employment surface. Timeline scrub does not change Workers peak height;
 * cumulative AI forecast drives Growth mode and marker copy only.
 */
export function getVisualHeightForWorkersAtYear(
    baselineEmployment: number,
    _cumulativePctFromBaseline: number,
): number {
    return getVisualHeightForEmployment(baselineEmployment);
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

    // No Claude forecast yet for this job — peak stays at neutral baseline
    // (height = 1.0 in the shader). No invented intermediate values.
    return { value: 0, source: 'baseline' };
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
