import { useMemo } from 'react';
import { useStore } from '../../store';
import type { Job } from '../../types';
import { getRoleEntries, type RoleEntry } from '../../utils/roles';
import { buildWorldLayout, type WorldLayout } from '../../utils/worldLayout';
import { epLevelAtYear, getVisualHeightForEpEmployment, TERRAIN_CONFIG } from '../../utils/terrainMath';
import { buildRiskScale, normalizeRisk, riskBandColor, riskColorRGB, RISK_UNSCORED_HEX, RISK_UNSCORED_RGB } from '../../config/theme';
import { SHADER } from '../../config/constants';


export interface ScenePeak {
    entry: RoleEntry;
    /** Index within its region's instanced mesh. */
    index: number;
    x: number;
    z: number;
    radius: number;
    color: [number, number, number];
    pipColor: string;
    job: Job | null;
}

export interface WorldScene {
    entries: RoleEntry[];
    layout: WorldLayout;
    peaks: ScenePeak[];
    peaksByContinent: Map<string, ScenePeak[]>;
    peakByKey: Map<string, ScenePeak>;
}

// Positions depend only on which roles exist, never on scores, so one layout
// serves every jobs array the store produces.
let cachedLayout: { signature: string; layout: WorldLayout } | null = null;
function layoutFor(entries: RoleEntry[]): WorldLayout {
    const signature = entries.map((e) => e.key).join('|');
    if (cachedLayout?.signature !== signature) cachedLayout = { signature, layout: buildWorldLayout(entries) };
    return cachedLayout.layout;
}

export function useWorldScene(): WorldScene {
    const jobs = useStore((s) => s.jobs);
    return useMemo(() => buildWorldScene(jobs), [jobs]);
}

export function buildWorldScene(jobs: readonly Job[]): WorldScene {
    const entries = getRoleEntries(jobs);
    const layout = layoutFor(entries);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const entryByKey = new Map(entries.map((e) => [e.key, e]));
    // Same basis as the old terrain: graded across all 50 Kelley roles.
    const riskScale = buildRiskScale(jobs.map((j) => j.automationCostIndex));
    const peaks: ScenePeak[] = [];
    const peaksByContinent = new Map<string, ScenePeak[]>();
    const peakByKey = new Map<string, ScenePeak>();
    for (const [continent, placements] of layout.peaksByContinent) {
        const list: ScenePeak[] = [];
        placements.forEach((p, index) => {
            const entry = entryByKey.get(p.key)!;
            const job = entry.jobId ? jobById.get(entry.jobId) ?? null : null;
            const scored = !!job && entry.scored;
            const peak: ScenePeak = {
                entry,
                index,
                x: p.x,
                z: p.z,
                radius: p.radius,
                color: scored ? riskColorRGB(normalizeRisk(job!.automationCostIndex, riskScale)) : RISK_UNSCORED_RGB,
                pipColor: scored ? riskBandColor(job!.automationCostIndex, riskScale) : RISK_UNSCORED_HEX,
                job,
            };
            list.push(peak);
            peaks.push(peak);
            peakByKey.set(entry.key, peak);
        });
        peaksByContinent.set(continent, list);
    }
    return { entries, layout, peaks, peaksByContinent, peakByKey };
}

/** BLS EP employment for the role at the slider year (straight line 2025→2035). */
export function peakEmploymentAt(entry: RoleEntry, year: number): number {
    if (entry.ep2025 == null || entry.ep2035 == null) return 1;
    return epLevelAtYear(entry.ep2025, entry.ep2035, year);
}

/** Peak height in world units above the ground. */
export function peakHeightAt(entry: RoleEntry, year: number): number {
    return getVisualHeightForEpEmployment(peakEmploymentAt(entry, year)) * SHADER.HEIGHT_SCALE;
}

export const GROUND_Y = TERRAIN_CONFIG.TERRAIN_OFFSET_Y;

/**
 * Inside a zoomed field, peaks are drawn to that field's own scale: its
 * largest occupation in the slider year is FIELD_PEAK_MAX world units tall and
 * every other peak is linear to it. Only heights change; every number on
 * labels and panels stays the published one. The world view keeps the single
 * national scale (peakHeightAt).
 */
export const FIELD_PEAK_MAX = 3 * SHADER.HEIGHT_SCALE;

/** The largest EP employment among a field's peaks in `year`. */
export function fieldMaxEmploymentAt(peaks: readonly ScenePeak[], year: number): number {
    let max = 0;
    for (const p of peaks) max = Math.max(max, peakEmploymentAt(p.entry, year));
    return max;
}

/** Peak height on the field scale, in world units above the ground. */
export function fieldPeakHeightAt(entry: RoleEntry, year: number, fieldMax: number): number {
    const min = SHADER.HEIGHT_CLAMP_MIN * SHADER.HEIGHT_SCALE;
    if (!(fieldMax > 0)) return min;
    return min + (peakEmploymentAt(entry, year) / fieldMax) * (FIELD_PEAK_MAX - min);
}

/** The height a peak is drawn at right now: field scale inside the zoomed field, national scale elsewhere. */
export function displayedPeakHeight(peak: ScenePeak, year: number, focused: string | null, fieldMax: number): number {
    return focused && peak.entry.continent === focused
        ? fieldPeakHeightAt(peak.entry, year, fieldMax)
        : peakHeightAt(peak.entry, year);
}
