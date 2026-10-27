import { useMemo } from 'react';
import type { RoleEntry } from '../../utils/roles';
import {
    buildContinentMesh,
    buildGlobeLayout,
    LAND_RADIUS,
    unitVector,
    type ContinentMesh,
    type GlobeContinent,
    type GlobeLayout,
} from '../../utils/globeLayout';
import { peakHeightAt, type ScenePeak, type WorldScene } from './worldScene';

/**
 * The globe draws the single national height scale of the flat world view,
 * shrunk by this one factor so the tallest peak (about 12 units flat) stands
 * about a quarter of the globe's radius. Every peak shrinks alike, so heights
 * still compare across continents.
 */
export const GLOBE_PEAK_SCALE = 0.42;
/** How far a peak label's anchor floats above its peak, world units. */
export const GLOBE_PEAK_LABEL_LIFT = 1.6;
/** How far a continent's name floats above its centre, world units. */
export const GLOBE_REGION_LABEL_LIFT = 0.4;

export interface GlobePeak {
    peak: ScenePeak;
    lon: number;
    sinLat: number;
    /** Unit normal at the peak's centre. */
    dir: [number, number, number];
    /** Footprint radius, world units. */
    radius: number;
}

export interface GlobeScene {
    layout: GlobeLayout;
    mesh: ContinentMesh;
    /** Continent index (SOC order) by code: the land shader's region number. */
    continentIndex: Map<string, number>;
    /** Per continent, in the same order (and index) as WorldScene.peaksByContinent. */
    peaksByContinent: Map<string, GlobePeak[]>;
    peakByKey: Map<string, GlobePeak>;
}

// Like the flat layout, positions depend only on which roles exist.
let cached: { signature: string; layout: GlobeLayout; mesh: ContinentMesh } | null = null;
function layoutFor(entries: readonly RoleEntry[]) {
    const signature = entries.map((e) => e.key).join('|');
    if (cached?.signature !== signature) {
        const layout = buildGlobeLayout(entries);
        cached = { signature, layout, mesh: buildContinentMesh(layout.continents) };
    }
    return cached;
}

export function buildGlobeScene(scene: WorldScene): GlobeScene {
    const { layout, mesh } = layoutFor(scene.entries);
    const continentIndex = new Map(layout.continents.map((c, i) => [c.code, i]));
    const peaksByContinent = new Map<string, GlobePeak[]>();
    const peakByKey = new Map<string, GlobePeak>();
    for (const [code, peaks] of scene.peaksByContinent) {
        const placements = new Map((layout.peaksByContinent.get(code) ?? []).map((p) => [p.key, p]));
        const list = peaks.map((peak) => {
            const p = placements.get(peak.entry.key)!;
            const g: GlobePeak = { peak, lon: p.lon, sinLat: p.sinLat, dir: unitVector(p.lon, p.sinLat), radius: p.radius };
            peakByKey.set(peak.entry.key, g);
            return g;
        });
        peaksByContinent.set(code, list);
    }
    return { layout, mesh, continentIndex, peaksByContinent, peakByKey };
}

export function useGlobeScene(scene: WorldScene): GlobeScene {
    return useMemo(() => buildGlobeScene(scene), [scene]);
}

/** Peak height on the globe, world units above the land. */
export function globePeakHeightAt(entry: RoleEntry, year: number): number {
    return peakHeightAt(entry, year) * GLOBE_PEAK_SCALE;
}

/** Where a continent's name sits: above its centre. */
export function continentLabelPoint(c: GlobeContinent): [number, number, number] {
    const [x, y, z] = unitVector(c.lon, c.sinLat);
    const r = LAND_RADIUS + GLOBE_REGION_LABEL_LIFT;
    return [x * r, y * r, z * r];
}
