/**
 * Zoomed into a field, peaks are drawn to that field's own scale (its largest
 * occupation in the slider year is full height); the world view keeps one
 * national scale. Heights only: the numbers shown never change.
 */

import { describe, it, expect } from 'vitest';
import { useStore } from '../store';
import {
    buildWorldScene, displayedPeakHeight, FIELD_PEAK_MAX, fieldMaxEmploymentAt, fieldPeakHeightAt,
    peakEmploymentAt, peakHeightAt,
} from '../components/world/worldScene';
import { SHADER } from '../config/constants';

const scene = buildWorldScene(useStore.getState().jobs);
const MIN = SHADER.HEIGHT_CLAMP_MIN * SHADER.HEIGHT_SCALE;

describe('field scale', () => {
    it("draws each field's largest occupation full height in every year, the rest in proportion", () => {
        for (const [code, peaks] of scene.peaksByContinent) {
            for (const year of [2025, 2029.5, 2035]) {
                const max = fieldMaxEmploymentAt(peaks, year);
                const heights = peaks.map((p) => fieldPeakHeightAt(p.entry, year, max));
                expect(Math.max(...heights), `${code} ${year}`).toBeCloseTo(FIELD_PEAK_MAX, 9);
                peaks.forEach((p, i) => {
                    expect((heights[i] - MIN) / (FIELD_PEAK_MAX - MIN)).toBeCloseTo(peakEmploymentAt(p.entry, year) / max, 9);
                });
            }
        }
    });

    it('lifts small fields: Arts & Media peaks are taller zoomed than on the national scale', () => {
        const arts = scene.peaksByContinent.get('27')!;
        const max = fieldMaxEmploymentAt(arts, 2025);
        for (const p of arts) expect(fieldPeakHeightAt(p.entry, 2025, max)).toBeGreaterThanOrEqual(peakHeightAt(p.entry, 2025) - 1e-9);
    });

    it('keeps the national scale in the world view and in every other field', () => {
        for (const p of scene.peaks) {
            expect(displayedPeakHeight(p, 2025, null, 0)).toBe(peakHeightAt(p.entry, 2025));
            const other = p.entry.continent === '27' ? '29' : '27';
            expect(displayedPeakHeight(p, 2025, other, 1e6)).toBe(peakHeightAt(p.entry, 2025));
        }
    });
});
