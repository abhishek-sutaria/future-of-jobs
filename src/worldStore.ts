import { create } from 'zustand';
import { useStore } from './store';
import { BROAD_LABELS, FIELD_LABELS, labelsAt, type LabelDecision } from './utils/labelLevel';
import { loadContinentFile, type ContinentFile } from './utils/occupationIndex';
import { loadBlsFieldScores } from './utils/blsScores';
import { loadStateMapField } from './utils/stateMapData';
import { isChunkLoadError, reloadForNewBuild } from './utils/staleBuild';
import type { Stage } from './utils/stageLayout';
import type { RoleEntry } from './utils/roles';
import type { SchoolFilter } from './utils/iuSchools';
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
     * The hidden IU school filter (components/SchoolPicker): shown by Cmd+S on
     * a Mac, Ctrl+S elsewhere, or a long press on the field picker. Never saved
     * anywhere, so a reload starts hidden with no school.
     */
    schoolsRevealed: boolean;
    /** The school whose jobs stand out; null for none. Works with the field (level) and the Kelley filter. */
    school: SchoolFilter | null;
    setSchool: (school: SchoolFilter | null) => void;
    /** Show the school picker, or hide it and drop its school. */
    toggleSchools: () => void;
    hideSchools: () => void;
    /** The field picker is on screen (WorldBar mounted), so the shortcut has somewhere to open. */
    fieldPickerMounted: boolean;
    setFieldPickerMounted: (on: boolean) => void;

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

    /**
     * Fields whose BLS state rows (utils/stateMapData) are loaded, by code.
     * A field's rows load with the field (loadContinent) or when the Map view
     * needs them (loadStateMap); the Map view re-renders on this.
     */
    stateMapFields: Record<string, true>;
    stateMapErrors: Record<string, string>;
    loadStateMap: (code: string) => Promise<void>;

    /** Fly to the role's region and open its panel. */
    openRole: (entry: RoleEntry) => void;

    /**
     * The Career Paths view (components/careerPaths), a full-screen page over
     * everything, separate from the 3D landscape (which pauses while it is
     * open). Its trail of SOCs survives closing, so reopening returns to the
     * same job; opening it on a job that is not the trail's last starts a new
     * trail there. Opening it makes no Claude call.
     */
    careerPathsOpen: boolean;
    /** The path walked so far, oldest first; the last SOC is the centre. Empty: nothing picked yet. */
    careerTrail: string[];
    /** The role (RoleEntry key) "Open job details" opens for the centre, when the view was opened from one. */
    careerRoleKey: string | null;
    /** Open the view, on `soc` if given. Focus goes back to the element that had it when the view closes (takeCareerPathsOpener). */
    openCareerPaths: (soc?: string | null, roleKey?: string | null) => void;
    closeCareerPaths: (opts?: { restoreFocus?: boolean }) => void;
    /** Replace the trail (walk, go back, search). `roleKey`: the role "Open job details" should open for the new centre. */
    setCareerTrail: (trail: string[], roleKey?: string | null) => void;
}

const inFlight = new Map<string, Promise<ContinentFile | null>>();
/** The element that had focus when the Career Paths view opened (not state: never rendered). */
let careerPathsOpener: HTMLElement | null = null;

/**
 * The element to give focus back to once the Career Paths view has closed, at
 * most once (components/careerPaths/CareerPathsHost calls it after the page
 * behind the view is no longer inert). Null after "Open job details".
 */
export function takeCareerPathsOpener(): HTMLElement | null {
    const el = careerPathsOpener;
    careerPathsOpener = null;
    return el;
}
const stateMapInFlight = new Map<string, Promise<void>>();

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

    schoolsRevealed: false,
    school: null,
    setSchool: (school) => set({ school }),
    toggleSchools: () => (get().schoolsRevealed ? get().hideSchools() : set({ schoolsRevealed: true })),
    hideSchools: () => set({ schoolsRevealed: false, school: null }),
    fieldPickerMounted: false,
    setFieldPickerMounted: (on) => set({ fieldPickerMounted: on }),

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
        // Its state-map rows load alongside, on their own: the Map view waits
        // for them, and a failure there never holds up the field.
        void get().loadStateMap(code);
        // The field's published AI scores load with it, so a panel that has
        // the occupation file also has its scores (utils/blsScores).
        const attempt = () => Promise.all([loadContinentFile(code), loadBlsFieldScores(code)]);
        // One quiet retry for a brief network or edge hiccup; if the chunk is
        // gone because a new build was deployed, reload once to pick it up.
        const p = attempt()
            .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(attempt))
            .catch((err: unknown) => {
                if (isChunkLoadError(err) && reloadForNewBuild()) return new Promise<never>(() => {});
                throw err;
            })
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

    stateMapFields: {},
    stateMapErrors: {},
    loadStateMap: (code) => {
        if (get().stateMapFields[code]) return Promise.resolve();
        const pending = stateMapInFlight.get(code);
        if (pending) return pending;
        const p = loadStateMapField(code)
            .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(() => loadStateMapField(code)))
            .catch((err: unknown) => {
                if (isChunkLoadError(err) && reloadForNewBuild()) return new Promise<never>(() => {});
                throw err;
            })
            .then(() => {
                set((s) => {
                    const errors = { ...s.stateMapErrors };
                    delete errors[code];
                    return { stateMapFields: { ...s.stateMapFields, [code]: true as const }, stateMapErrors: errors };
                });
            })
            .catch((err: unknown) => {
                console.error(`[World] Could not load state data for field ${code}`, err);
                set((s) => ({ stateMapErrors: { ...s.stateMapErrors, [code]: 'Could not load the BLS state data.' } }));
            })
            .finally(() => stateMapInFlight.delete(code));
        stateMapInFlight.set(code, p);
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

    careerPathsOpen: false,
    careerTrail: [],
    careerRoleKey: null,
    openCareerPaths: (soc, roleKey = null) => {
        const s = get();
        if (!s.careerPathsOpen) {
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            careerPathsOpener = active instanceof HTMLElement && active !== document.body ? active : null;
        }
        const keep = !soc || s.careerTrail[s.careerTrail.length - 1] === soc;
        set({
            careerPathsOpen: true,
            careerTrail: keep ? s.careerTrail : [soc],
            careerRoleKey: keep && !roleKey ? s.careerRoleKey : roleKey,
        });
    },
    closeCareerPaths: ({ restoreFocus = true } = {}) => {
        if (!get().careerPathsOpen) return;
        if (!restoreFocus) careerPathsOpener = null;
        set({ careerPathsOpen: false });
    },
    setCareerTrail: (trail, roleKey) => set((s) => ({
        careerTrail: trail,
        // The preferred role only stands while its job is the centre.
        careerRoleKey: roleKey !== undefined ? roleKey : trail[trail.length - 1] === s.careerTrail[s.careerTrail.length - 1] ? s.careerRoleKey : null,
    })),
}));

// A Kelley panel opened from anywhere (Tasks view, a label) closes an open
// unscored panel, so the two can never stack.
useStore.subscribe((state, prev) => {
    if (state.selectedJob && state.selectedJob !== prev.selectedJob && useWorldStore.getState().selectedOccupationSoc) {
        useWorldStore.setState({ selectedOccupationSoc: null });
    }
});
