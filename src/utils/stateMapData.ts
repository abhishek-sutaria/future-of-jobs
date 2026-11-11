/**
 * State employment and location quotient for every one of the 830 jobs, from
 * the BLS OEWS May 2025 state file (scripts/build_state_map.ts, report in
 * docs/state-map.md). One chunk per field (src/data/state_map/<field>.json),
 * loaded with the field (worldStore.loadContinent) or by the Map view for the
 * fields it shows (worldStore.loadStateMap). Only the 54 areas and their
 * display centroids are in the main bundle. Only this module imports the chunks.
 */

import areasJson from '../data/state_map/areas.json';
import type { GeoLocation } from './mapAggregation';

interface AreaEntry {
    code: string;
    name: string;
    lat: number;
    lng: number;
}

interface StateMapFieldFile {
    socs: Record<string, [string, number, number][]>;
}

interface AreasFile {
    areas: AreaEntry[];
    coverage: { jobs: number; full: number; partial: number; none: number; noStateData: string[] };
}

const AREAS_FILE = areasJson as AreasFile;

const AREAS: ReadonlyMap<string, AreaEntry> = new Map(AREAS_FILE.areas.map((a) => [a.code, a]));

/**
 * How many jobs BLS publishes in every area, in some, or in none, and which
 * jobs have no state data at all (docs/state-map.md), for the app's text.
 */
export const STATE_MAP_COVERAGE: Readonly<AreasFile['coverage']> = AREAS_FILE.coverage;

// One lazy chunk per field. The [0-9][0-9] pattern keeps areas.json (bundled above) out.
const FIELD_LOADERS = import.meta.glob<StateMapFieldFile>('../data/state_map/[0-9][0-9].json', { import: 'default' });

const rowsBySoc = new Map<string, GeoLocation[]>();
const fieldLoads = new Map<string, Promise<void>>();
const loadedFields = new Set<string>();

/** Field codes that have a state-map chunk (all 22). */
export const STATE_MAP_FIELDS: readonly string[] = Object.keys(FIELD_LOADERS)
    .map((k) => k.slice(-7, -5))
    .sort();

/**
 * Loads one field's state rows. Resolves at once once loaded; a failed load
 * can be retried. A field with no chunk resolves with nothing.
 */
export function loadStateMapField(code: string): Promise<void> {
    const load = FIELD_LOADERS[`../data/state_map/${code}.json`];
    if (!load) return Promise.resolve();
    let p = fieldLoads.get(code);
    if (!p) {
        p = load().then((file) => {
            for (const [soc, rows] of Object.entries(file.socs)) {
                rowsBySoc.set(
                    soc,
                    rows.map(([area, employment, lq]) => {
                        const a = AREAS.get(area);
                        if (!a) throw new Error(`State map: unknown area ${area} for ${soc}`);
                        return { name: a.name, lat: a.lat, lng: a.lng, employment, lq };
                    }),
                );
            }
            loadedFields.add(code);
        });
        p.catch(() => fieldLoads.delete(code));
        fieldLoads.set(code, p);
    }
    return p;
}

/**
 * A job's published state rows, largest employment first: undefined until its
 * field is loaded, and an empty list when BLS publishes no state data for it.
 */
export const stateRowsFor = (soc: string): readonly GeoLocation[] | undefined => rowsBySoc.get(soc);

/** True once this field's chunk is in. */
export const isStateMapFieldLoaded = (code: string): boolean => loadedFields.has(code);
