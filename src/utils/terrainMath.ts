

// Constants for Landscape Generation
export const TERRAIN_CONFIG = {
    // Spatial Layout
    GRID_RADIUS_FACTOR: 6.0, // Reduced from 6.0 to keep outer peaks inside plane (70x70)

    // Gaussian Shape
    PEAK_WIDTH: 2.5, // Sigma (Spread) -> Sharpened from 5.0
    PEAK_HEIGHT_SCALE: 1.2, // Increased height for impact

    // World Position
    TERRAIN_OFFSET_Y: -3.0, // Move terrain down so peaks rise up
};

export interface PeakData {
    x: number;
    z: number;
    height: number; // 0 to 1 normalized
}

// Deterministic position (Spiral / Sunflower)
export const getTerrainPosition = (index: number): { x: number, z: number } => {
    const angle = index * 137.5 * (Math.PI / 180);
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
