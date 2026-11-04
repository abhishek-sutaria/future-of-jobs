/**
 * The all-occupations dataset (src/data/occupations/, built by
 * scripts/build_occupations.py and checked cell by cell by
 * scripts/verify_occupations.py).
 *
 * Only index.json is bundled: it holds the 22 continents (BLS SOC major
 * groups, with their EP summary rows) and one small row per occupation, which
 * is all the world view needs. Each continent's full file (descriptions, pay,
 * O*NET tasks, source cells) is a separate chunk, loaded by
 * loadContinentFile() when its region is opened.
 */

import indexJson from '../data/occupations/index.json';

/** One BLS Employment Projections Table 1.2 row. Employment in persons. */
export interface EpBlock {
    title: string;
    employment2025: number;
    employment2035: number;
    numericChange: number;
    percentChange: number;
}

export interface OccupationTask {
    id: number;
    text: string;
    type: string;
    onetCode: string;
    line: number;
    alsoIn?: string[];
}

/** A detailed occupation as stored in a continent file. */
export interface OccupationEntry {
    soc: string;
    title: string;
    major: string;
    minor: string;
    broad: string | null;
    oewsRows: number[];
    oewsOGroups: string[];
    employment: number | null;
    annualMedian: number | null;
    annualMean: number | null;
    hourlyMedian: number | null;
    hourlyMean: number | null;
    annualPct10: number | null;
    annualPct90: number | null;
    annualOnly: boolean;
    hourlyOnly: boolean;
    topcoded: Partial<Record<string, boolean>>;
    ep: EpBlock | null;
    onetCode: string | null;
    onetTaskSource: '.00' | 'sub-codes' | 'none';
    onetSubCodes: { code: string; title: string; taskCount: number }[];
    description: string | null;
    tasks: OccupationTask[];
    dedupedTasks: number;
    aiStatus: string;
    kelleyTracks?: string[];
    kelleyTitles?: string[];
    sources: Record<string, string>;
    nullReasons: Partial<Record<string, string>>;
}

export interface ContinentFile {
    _meta: { continent: string; title: string; extracted: string };
    broadGroups: { soc: string; title: string; minor: string; employment: number; sources: Record<string, string> }[];
    occupations: Record<string, OccupationEntry>;
}

export interface IndexMinorGroup {
    soc: string;
    title: string;
    employment: number;
    ep: EpBlock;
    sources: Record<string, string>;
    socs: string[];
}

export interface IndexContinent {
    soc: string;
    /** Two-digit SOC major code, e.g. "27". */
    code: string;
    /** Official BLS OEWS title of the major group. */
    title: string;
    /** OEWS May 2025 payroll employment for the major group. */
    employment: number;
    /** The EP Table 1.2 "Summary" row for the major group (includes self-employed). */
    ep: EpBlock;
    sources: Record<string, string>;
    file: string;
    occupationCount: number;
    minorGroups: IndexMinorGroup[];
}

export interface IndexOccupation {
    soc: string;
    title: string;
    minor: string;
    employment: number | null;
    annualMedian: number | null;
    epEmployment2025: number | null;
    epEmployment2035: number | null;
    epPercentChange: number | null;
    taskCount: number;
    kelleyTracks?: string[];
}

export interface OccupationIndex {
    _meta: {
        extracted: string;
        sources: {
            oews: { vintage: string; topcode: { symbol: string; text: string; hourly: number; annual: number } };
            ep: { vintage: string; allOccupations: EpBlock & { sources: Record<string, string> }; summaryNote: string };
            onet: { vintage: string };
        };
        counts: Record<string, number>;
    };
    continents: IndexContinent[];
    occupations: IndexOccupation[];
}

export const OCCUPATION_INDEX = indexJson as unknown as OccupationIndex;

/** The 22 continents in SOC order. */
export const INDEX_CONTINENTS: readonly IndexContinent[] = OCCUPATION_INDEX.continents;

export const INDEX_CONTINENT_BY_CODE: ReadonlyMap<string, IndexContinent> = new Map(
    INDEX_CONTINENTS.map((c) => [c.code, c]),
);

export const INDEX_OCCUPATION_BY_SOC: ReadonlyMap<string, IndexOccupation> = new Map(
    OCCUPATION_INDEX.occupations.map((o) => [o.soc, o]),
);

/** Two-digit continent code for any SOC ("27-1011" → "27"). */
export const continentOf = (soc: string): string => soc.slice(0, 2);

/**
 * Largest EP employment any single occupation reaches on the 2025→2035 path
 * (Home Health and Personal Care Aides, 2035). Peak height is linear up to
 * this value, so no peak is ever capped.
 */
export const EP_PATH_MAX: number = OCCUPATION_INDEX.occupations.reduce(
    (m, o) => Math.max(m, o.epEmployment2025 ?? 0, o.epEmployment2035 ?? 0),
    0,
);

// One lazy chunk per continent file. The [0-9][0-9] pattern keeps index.json
// (already bundled above) out of the glob.
const CONTINENT_LOADERS = import.meta.glob<ContinentFile>('../data/occupations/[0-9][0-9].json', {
    import: 'default',
});

export function hasContinentFile(code: string): boolean {
    return `../data/occupations/${code}.json` in CONTINENT_LOADERS;
}

export function loadContinentFile(code: string): Promise<ContinentFile> {
    const load = CONTINENT_LOADERS[`../data/occupations/${code}.json`];
    if (!load) return Promise.reject(new Error(`No occupations file for continent ${code}`));
    return load();
}
