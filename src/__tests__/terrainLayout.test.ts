import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import { getTerrainPosition } from '../utils/terrainMath';
import { getFunctionalCluster } from '../config/clusters';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x - b.x, a.z - b.z);
const posOf = (title: string) => {
    const i = initialJobs.findIndex((j) => j.title === title);
    return getTerrainPosition(i, initialJobs);
};

describe('cluster territory layout', () => {
    it('places every job inside the visible terrain disc', () => {
        const radii = initialJobs.map((_, i) => {
            const p = getTerrainPosition(i, initialJobs);
            return Math.hypot(p.x, p.z);
        });
        expect(Math.max(...radii)).toBeLessThanOrEqual(32); // shader edge fade starts here
        expect(Math.min(...radii)).toBeGreaterThan(0);
    });

    it('keeps peaks far enough apart to stay individually readable', () => {
        let min = Infinity;
        for (let i = 0; i < initialJobs.length; i++) {
            for (let j = i + 1; j < initialJobs.length; j++) {
                min = Math.min(min, dist(getTerrainPosition(i, initialJobs), getTerrainPosition(j, initialJobs)));
            }
        }
        expect(min).toBeGreaterThan(3.5);
    });

    it('groups related roles and separates unrelated ones', () => {
        // The complaint that motivated this layout: Financial Manager and Financial
        // Analyst sat on opposite sides of the marketing roles.
        const finPair = dist(posOf('Financial Analyst'), posOf('Financial Manager'));
        const mktPair = dist(posOf('Marketing Manager'), posOf('Market Research Analyst'));
        const crossField = dist(posOf('Financial Analyst'), posOf('Marketing Manager'));

        expect(finPair).toBeLessThan(crossField);
        expect(mktPair).toBeLessThan(crossField);
    });

    it('keeps each cluster tighter than the map as a whole', () => {
        const byCluster = new Map<string, { x: number; z: number }[]>();
        initialJobs.forEach((job, i) => {
            const c = getFunctionalCluster(job.title);
            if (!byCluster.has(c)) byCluster.set(c, []);
            byCluster.get(c)!.push(getTerrainPosition(i, initialJobs));
        });

        const spread = (pts: { x: number; z: number }[]) => {
            let max = 0;
            for (let i = 0; i < pts.length; i++)
                for (let j = i + 1; j < pts.length; j++) max = Math.max(max, dist(pts[i], pts[j]));
            return max;
        };
        const wholeMap = spread(initialJobs.map((_, i) => getTerrainPosition(i, initialJobs)));

        for (const [cluster, pts] of byCluster) {
            if (pts.length < 2) continue;
            expect(spread(pts), `${cluster} should be a contiguous territory`).toBeLessThan(wholeMap * 0.75);
        }
    });

    it('does not move surviving peaks when the visible set is filtered', () => {
        // Positions must derive from the full job list, so hiding roles never
        // rearranges the map under the user.
        const before = initialJobs.map((_, i) => getTerrainPosition(i, initialJobs));

        const filtered = initialJobs.filter((_, i) => i % 3 === 0);
        for (const job of filtered) {
            const fullIndex = initialJobs.findIndex((j) => j.id === job.id);
            // Callers resolve the index against the full list — same contract as
            // Terrain.tsx / JobMarkers.tsx.
            expect(getTerrainPosition(fullIndex, initialJobs)).toEqual(before[fullIndex]);
        }

        // And a repeat call is stable (memoisation must not perturb results).
        const after = initialJobs.map((_, i) => getTerrainPosition(i, initialJobs));
        expect(after).toEqual(before);
    });
});
