/**
 * Opening a role from the globe (search, a Kelley peak) waits for the camera:
 * the globe turns, closes in, lands in the field, and only then does the
 * panel open. Without the 3D view (tests, the 2D views) it opens at once,
 * through the same openRole path, so the unscored-roles guarantees in
 * unscoredNoClaude.test.tsx still cover it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { useWorldStore } from '../worldStore';
import { useStore } from '../store';
import { getRoleEntries } from '../utils/roles';
import { worldCamera } from '../components/world/worldCamera';

const entries = getRoleEntries(useStore.getState().jobs);
const unscored = entries.find((e) => e.kind === 'bls')!;
const kelley = entries.find((e) => e.kind === 'kelley')!;
const defaultWhenArrived = worldCamera.whenArrived;

afterEach(() => {
    worldCamera.whenArrived = defaultWhenArrived;
    useWorldStore.setState({ selectedOccupationSoc: null, focusedContinent: null });
    useStore.getState().setSelectedJob(null);
});

describe('opening a role from the globe', () => {
    it('opens at once when no camera flight is pending (no 3D view)', () => {
        useWorldStore.getState().openRole(unscored);
        expect(useWorldStore.getState().focusedContinent).toBe(unscored.continent);
        expect(useWorldStore.getState().selectedOccupationSoc).toBe(unscored.soc);
    });

    it('focuses the field at once but waits for the camera to land before opening the panel', () => {
        const queued: Array<{ code: string; open: () => void }> = [];
        worldCamera.whenArrived = (code, open) => queued.push({ code, open });

        useWorldStore.getState().openRole(kelley);
        expect(useWorldStore.getState().focusedContinent).toBe(kelley.continent);
        expect(useStore.getState().selectedJob).toBeNull();
        expect(queued.map((q) => q.code)).toEqual([kelley.continent]);

        queued[0].open();
        expect(useStore.getState().selectedJob?.id).toBe(kelley.jobId);
        expect(useWorldStore.getState().selectedOccupationSoc).toBeNull();
    });

    it('still routes an unscored occupation to its own panel, never selectedJob', () => {
        const queued: Array<() => void> = [];
        worldCamera.whenArrived = (_code, open) => queued.push(open);
        useWorldStore.getState().openRole(unscored);
        queued[0]();
        expect(useWorldStore.getState().selectedOccupationSoc).toBe(unscored.soc);
        expect(useStore.getState().selectedJob).toBeNull();
    });
});
