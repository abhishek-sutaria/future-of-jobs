import { create } from 'zustand';
import { useStore } from './store';
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
        set((s) => ({ focusedContinent: code, focusRequestId: s.focusRequestId + 1 }));
        if (code) void get().loadContinent(code);
    },

    kelleyOnly: false,
    setKelleyOnly: (on) => set((s) => ({ kelleyOnly: on, focusRequestId: s.focusRequestId + 1 })),

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
