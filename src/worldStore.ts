import { create } from 'zustand';
import { useStore } from './store';
import { BROAD_LABELS, FIELD_LABELS, labelsAt, type LabelDecision } from './utils/labelLevel';
import { loadContinentFile, type ContinentFile } from './utils/occupationIndex';
import { loadBlsFieldScores } from './utils/blsScores';
import type { Stage } from './utils/stageLayout';
import type { RoleEntry } from './utils/roles';
import { familyLevel, fieldLevel, levelKind, levelUp, WORLD_LEVEL, type WorldLevel } from './utils/worldLevel';

/**
 * Navigation state for the 22-continent world: which level is on stage (the
 * whole world, one family or one field), the Kelley-roles highlight, and the
 * open unscored occupation. Kept apart from the main store so the 50 Kelley
 * roles' state (jobs, scores, selectedJob) is untouched: a Kelley role still
 * opens through useStore.setSelectedJob, and its panel is the one it has
 * always been.
 */
interface WorldState extends WorldLevel {
    /** Bumped on every level request, so asking for the same level again re-frames it. */
    focusRequestId: number;
    /** Go straight to a level. The rest of these are shorthand for it. */
    goToLevel: (level: WorldLevel) => void;
    /** Open a field, or the whole world for null. Its family comes along. */
    focusContinent: (code: string | null) => void;
    focusFamily: (id: number) => void;
    /** One level up: a field to its family, a family to the world. */
    goUp: () => void;
    /** Back to the world with no flight, for Reset view, which moves the camera itself. */
    resetLevel: () => void;
    /** The next flight to the world stops at the zoom that shows job labels, not the broad view. */
    kelleyZoom: boolean;
    /**
     * The stage on the mesh right now. Trails the level: the old one flattens
     * first, and labels and input follow what is drawn. Written by world/StageTerrain.
     */
    drawnStage: Stage | null;

    /** Which labels the level, and at the world the camera's zoom, call for. Kept current by world/CameraRig. */
    labels: LabelDecision;

    /** Highlight only the 50 Kelley roles (their peaks, labels and colours). */
    kelleyOnly: boolean;
    setKelleyOnly: (on: boolean) => void;

    /**
     * SOC of the open BLS occupation panel (any occupation that is not a Kelley
     * title). Scored ones open the common role panel, unscored ones the
     * numbers-only panel (UI.tsx). Never set for a Kelley role.
     */
    selectedOccupationSoc: string | null;
    closeOccupation: () => void;
    /** Open an occupation's panel where the user is, with no flight (task view, dashboard). */
    openOccupation: (soc: string) => void;

    /** Continent files loaded so far, by code. */
    continentFiles: Record<string, ContinentFile>;
    continentErrors: Record<string, string>;
    loadContinent: (code: string) => Promise<ContinentFile | null>;

    /** Fly to the role's region and open its panel. */
    openRole: (entry: RoleEntry) => void;
}

const inFlight = new Map<string, Promise<ContinentFile | null>>();

export const useWorldStore = create<WorldState>((set, get) => ({
    ...WORLD_LEVEL,
    focusRequestId: 0,
    goToLevel: (level) => {
        set((s) => {
            const kind = levelKind(level);
            // Job labels are what the Kelley filter is for, and the broad view has none.
            const arrival = s.kelleyOnly ? FIELD_LABELS : BROAD_LABELS;
            return {
                ...level,
                kelleyZoom: kind === 'world' && s.kelleyOnly,
                labels: kind === 'world' ? arrival : labelsAt(kind, NaN, s.labels),
                focusRequestId: s.focusRequestId + 1,
            };
        });
        if (level.focusedContinent) void get().loadContinent(level.focusedContinent);
    },
    focusContinent: (code) => get().goToLevel(code ? fieldLevel(code) : WORLD_LEVEL),
    focusFamily: (id) => get().goToLevel(familyLevel(id)),
    goUp: () => {
        const s = get();
        if (levelKind(s) !== 'world') s.goToLevel(levelUp(s));
    },
    resetLevel: () => set({ ...WORLD_LEVEL, kelleyZoom: false, labels: BROAD_LABELS }),
    kelleyZoom: false,
    drawnStage: null,

    labels: BROAD_LABELS,

    kelleyOnly: false,
    // Kelley labels are job labels, which the broad view never shows: turning
    // the filter on there zooms in far enough for them. Otherwise it leaves the
    // camera where the user put it, and inside a family or field it only
    // changes what is on stage.
    setKelleyOnly: (on) => set((s) => (
        on && levelKind(s) === 'world' && !s.labels.fields
            ? { kelleyOnly: on, kelleyZoom: true, focusRequestId: s.focusRequestId + 1 }
            : { kelleyOnly: on }
    )),

    selectedOccupationSoc: null,
    closeOccupation: () => set({ selectedOccupationSoc: null }),
    openOccupation: (soc) => {
        useStore.getState().setSelectedJob(null);
        set({ selectedOccupationSoc: soc });
        void get().loadContinent(soc.slice(0, 2));
    },

    continentFiles: {},
    continentErrors: {},
    loadContinent: (code) => {
        const loaded = get().continentFiles[code];
        if (loaded) return Promise.resolve(loaded);
        const pending = inFlight.get(code);
        if (pending) return pending;
        // The field's published AI scores load with it, so a panel that has
        // the occupation file also has its scores (utils/blsScores).
        const p = Promise.all([loadContinentFile(code), loadBlsFieldScores(code)])
            .then(([file]) => {
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
