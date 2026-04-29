import { SHADER, YEAR_MIN, YEAR_MAX } from '../config/constants';
import type { Job } from '../types';

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

export const getDeclineTintStrength = (growthDelta: number): number => {
    if (growthDelta >= 0) return 0;
    return Math.min(VISUAL_CONFIG.DECLINE_TINT_MAX, Math.abs(growthDelta) * 0.08);
};

export const getFallbackYearlyImpact = (job: Job, year: number): number => {
    if (year <= YEAR_MIN) return 0;

    const progress = (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
    const baselineGrowth = job.projectedGrowth * progress;

    // Use globally-scored AI risk to create overview decline even before a per-job
    // detailed yearly forecast is generated. The drag ramps up later in the
    // timeline so jobs can rise early, then flatten or decline near 2030.
    const attenuation = baselineGrowth * job.automationCostIndex * progress * 1.4;
    const declinePressure = job.automationCostIndex * 8 * Math.pow(progress, 2);
    const result = baselineGrowth - attenuation - declinePressure;
    if (job.id === 'job-15' || job.id === 'job-2') {
        // #region agent log
        fetch('http://127.0.0.1:7252/ingest/46718283-b9ba-4afd-b6a8-059ca781fa06',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9fe126'},body:JSON.stringify({sessionId:'9fe126',runId:'post-fix',hypothesisId:'H2',location:'terrainMath.ts:88',message:'fallback_growth_computed',data:{jobId:job.id,title:job.title,year,projectedGrowth:job.projectedGrowth,automationCostIndex:job.automationCostIndex,baselineGrowth,attenuation,declinePressure,result},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
    }
    return result;
};

export const getCurrentYearGrowth = (job: Job, year: number): { value: number; source: 'ai' | 'baseline' } => {
    if (job.yearlyForecast) {
        const t = Math.max(YEAR_MIN, Math.min(YEAR_MAX, year));
        const y1 = Math.floor(t);
        const y2 = Math.ceil(t);
        const f = t - y1;
        const item1 = job.yearlyForecast.find((x) => x.year === y1);
        const item2 = job.yearlyForecast.find((x) => x.year === y2);
        const fallbackValue = getFallbackYearlyImpact(job, t);
        const val1 = item1 ? item1.growthImpact : fallbackValue;
        const val2 = item2 ? item2.growthImpact : fallbackValue;
        return { value: val1 * (1 - f) + val2 * f, source: 'ai' };
    }

    return { value: getFallbackYearlyImpact(job, year), source: 'baseline' };
};
