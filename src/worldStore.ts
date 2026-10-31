import { create } from 'zustand';
import { useStore } from './store';
import { BROAD_LABELS, type LabelDecision } from './utils/labelLevel';
import { loadContinentFile, type ContinentFile } from './utils/occupationIndex';
import type { RoleEntry } from './utils/roles';

/**
 * Navigation state for the 22-continent world: which region is zoomed, the
 * Kelley-roles highlight, and the open unscored occupation. Kept apart from
 * the main store so the 50 Kelley roles' state (jobs, scores, selectedJob) is
 * untouched: a Kelley role still opens through useStore.setSelectedJob, and
 * its panel is the one it has always been.
 */
interface WorldState {
    /** Two-digit SOC major code of the zoomed region, or null for the whole world. */
    focusedContinent: string | null;
    /** Bumped on every focus request, so asking for the same region again re-frames it. */
    focusRequestId: number;
    focusContinent: (code: string | null) => void;
    /** Where the next flight goes when no region is zoomed; null is the whole world. */
    flyTo: { kind: 'family'; id: number } | { kind: 'fields' } | null;
    /** Fly to one BLS job family, which brings up its field names. Leaves no region zoomed. */
    focusFamily: (id: number) => void;

    /** Which labels the camera's zoom calls for. Written by world/CameraRig. */
    labels: LabelDecision;

    /** Highlight only the 50 Kelley roles (their peaks, labels and colours). */
    kelleyOnly: boolean;
    setKelleyOnly: (on: boolean) => void;

    /** SOC of the open unscored occupation panel. Never set for a Kelley role. */
    selectedOccupationSoc: string | null;
    closeOccupation: () => void;

    /** Continent files loaded so far, by code. */
    continentFiles: Record<string, ContinentFile>;
    continentErrors: Record<string, string>;
    loadContinent: (code: string) => Promise<ContinentFile | null>;

    /** Fly to the role's region and open its panel. */
    openRole: (entry: RoleEntry) => void;
}

const inFlight = new Map<string, Promise<ContinentFile | null>>();

export const useWorldStore = create<WorldState>((set, get) => ({
    focusedContinent: null,
    focusRequestId: 0,
    focusContinent: (code) => {
        set((s) => ({ focusedContinent: code, flyTo: null, focusRequestId: s.focusRequestId + 1 }));
        if (code) void get().loadContinent(code);
    },
    flyTo: null,
    focusFamily: (id) => set((s) => ({ focusedContinent: null, flyTo: { kind: 'family', id }, focusRequestId: s.focusRequestId + 1 })),

    labels: BROAD_LABELS,

    kelleyOnly: false,
    // Kelley labels are job labels, which the broad view never shows: turning
    // the filter on there zooms in far enough for them. Otherwise it leaves the
    // camera where the user put it.
    setKelleyOnly: (on) => set((s) => (
        on && !s.labels.fields
            ? { kelleyOnly: on, flyTo: { kind: 'fields' }, focusRequestId: s.focusRequestId + 1 }
            : { kelleyOnly: on }
    )),

    selectedOccupationSoc: null,
    closeOccupation: () => set({ selectedOccupationSoc: null }),

    continentFiles: {},
    continentErrors: {},
    loadContinent: (code) => {
        const loaded = get().continentFiles[code];
        if (loaded) return Promise.resolve(loaded);
        const pending = inFlight.get(code);
        if (pending) return pending;
        const p = loadContinentFile(code)
            .then((file) => {
                set((s) => {
                    const errors = { ...s.continentErrors };
                    delete errors[code];
                    return { continentFiles: { ...s.continentFiles, [code]: file }, continentErrors: errors };
                });
                return file;
            })
            .catch((err: unknown) => {
                console.error(`[World] Could not load occupations for continent ${code}`, err);
                set((s) => ({ continentErrors: { ...s.continentErrors, [code]: 'Could not load this field’s occupations.' } }));
                return null;
            })
            .finally(() => inFlight.delete(code));
        inFlight.set(code, p);
        return p;
    },

    openRole: (entry) => {
        get().focusContinent(entry.continent);
        if (entry.kind === 'kelley') {
            const job = useStore.getState().jobs.find((j) => j.id === entry.jobId);
            set({ selectedOccupationSoc: null });
            if (job) useStore.getState().setSelectedJob(job);
            return;
        }
        useStore.getState().setSelectedJob(null);
        set({ selectedOccupationSoc: entry.soc });
    },
}));

// A Kelley panel opened from anywhere (Tasks view, a label) closes an open
// unscored panel, so the two can never stack.
useStore.subscribe((state, prev) => {
    if (state.selectedJob && state.selectedJob !== prev.selectedJob && useWorldStore.getState().selectedOccupationSoc) {
        useWorldStore.setState({ selectedOccupationSoc: null });
    }
});
