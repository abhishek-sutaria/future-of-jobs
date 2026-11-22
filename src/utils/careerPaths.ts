/**
 * Career paths: the jobs O*NET 30.1 lists as related to a job ("Similar jobs
 * you could move to (O*NET, by similar skills and work)", never "where people
 * actually moved"), with the step up / same / down from O*NET Job Zones.
 * Built by scripts/build_career_paths.ts, checked by
 * scripts/verify_career_paths.py, method in docs/career-paths.md.
 *
 * Only this module imports the chunks (import.meta.glob, lazy): one links file
 * per BLS major group (src/data/career_paths/<NN>.json) and one zones file
 * (zones.json). Only the small index.json (label, source, coverage) would be
 * in the main bundle.
 *
 * Pay and AI Exposure are not in the chunks: payChange and aiExposureFor read
 * the data the app already shows (BLS OEWS May 2025 wages, published AI
 * scores). Missing data is null / "not scored", never estimated.
 */

import indexJson from '../data/career_paths/index.json';
import type { RiskBand } from '../config/theme';
import { BLS_SCORE_RISK, KELLEY_SOC_SCORES } from './blsScores';
import { INDEX_OCCUPATION_BY_SOC, type OccupationEntry } from './occupationIndex';
import { bandFor, type RoleScale } from './roleScale';
import { WAGES_BY_SOC, WAGES_META } from './wages';

export type CareerTier = 'Primary-Short' | 'Primary-Long' | 'Supplemental';
export type CareerDirection = 'up' | 'same' | 'down';

interface StoredLink {
    to: string;
    tier: CareerTier;
    index: number;
    rows: number[];
}

interface StoredJob {
    jobZone: number | null;
    jobZoneRule: '.00' | 'sub-codes' | 'combined' | 'mixed';
    jobZoneRows: number[];
    onetCodes: string[];
    links: StoredLink[];
}

interface FieldChunk {
    socs: Record<string, StoredJob>;
}

interface ZonesChunk {
    zones: Record<string, number>;
}

interface CareerPathsIndex {
    _meta: {
        label: string;
        notMeaning: string;
        source: { name: string; version: string; release: string; url: string; license: string; licenseUrl: string; attribution: string };
        tiers: CareerTier[];
        jobZoneNames: Record<string, string>;
    };
    coverage: { jobs: number; withLinks: number; withFivePlus: number; noData: number; withJobZone: number; mixedZones: string[] };
}

const INDEX = indexJson as CareerPathsIndex;

/** The words the screen must use for these links. */
export const CAREER_PATHS_LABEL: string = INDEX._meta.label;
/** Source, license and attribution to show with the data. */
export const CAREER_PATHS_SOURCE: Readonly<CareerPathsIndex['_meta']['source']> = INDEX._meta.source;
/** O*NET's official Job Zone names, "1" to "5". */
export const JOB_ZONE_NAMES: Readonly<Record<string, string>> = INDEX._meta.jobZoneNames;
/** How many of the 830 jobs have links, and which have mixed zones (docs/career-paths.md). */
export const CAREER_PATHS_COVERAGE: Readonly<CareerPathsIndex['coverage']> = INDEX.coverage;

// Lazy chunks. The [0-9][0-9] pattern keeps index.json (imported above) and zones.json out of the first glob.
const FIELD_LOADERS = import.meta.glob<FieldChunk>('../data/career_paths/[0-9][0-9].json', { import: 'default' });
const ZONES_LOADERS = import.meta.glob<ZonesChunk>('../data/career_paths/zones.json', { import: 'default' });

const fieldLoads = new Map<string, Promise<FieldChunk | null>>();
let zonesLoad: Promise<Record<string, number>> | null = null;

function loadField(code: string): Promise<FieldChunk | null> {
    const load = FIELD_LOADERS[`../data/career_paths/${code}.json`];
    if (!load) return Promise.resolve(null);
    let p = fieldLoads.get(code);
    if (!p) {
        p = load();
        p.catch(() => fieldLoads.delete(code));
        fieldLoads.set(code, p);
    }
    return p;
}

function loadZones(): Promise<Record<string, number>> {
    if (!zonesLoad) {
        const load = ZONES_LOADERS['../data/career_paths/zones.json'];
        if (!load) return Promise.reject(new Error('Career paths: zones.json is missing'));
        zonesLoad = load().then((f) => f.zones);
        zonesLoad.catch(() => {
            zonesLoad = null;
        });
    }
    return zonesLoad;
}

/** Field codes that have a career paths chunk (all 22). */
export const CAREER_PATHS_FIELDS: readonly string[] = Object.keys(FIELD_LOADERS)
    .map((k) => k.slice(-7, -5))
    .sort();

/** Step up, same level or step down, from the Job Zone difference. Null if either zone is missing. */
export function directionFor(fromZone: number | null | undefined, toZone: number | null | undefined): CareerDirection | null {
    if (fromZone == null || toZone == null) return null;
    return toZone > fromZone ? 'up' : toZone < fromZone ? 'down' : 'same';
}

export interface CareerLink {
    /** The related job's SOC. */
    to: string;
    tier: CareerTier;
    /** O*NET's Index (1 = most related). */
    index: number;
    /** The Related Occupations.txt lines this link comes from. */
    rows: readonly number[];
    /** The related job's Job Zone, or null (no zone, or mixed). */
    jobZone: number | null;
    direction: CareerDirection | null;
}

export interface CareerPaths {
    soc: string;
    /** This job's Job Zone, or null (mixed). */
    jobZone: number | null;
    jobZoneRule: StoredJob['jobZoneRule'];
    /** In O*NET's order: tier, then Index. */
    links: CareerLink[];
}

/**
 * A job's related jobs, each with its direction. Null when O*NET has nothing
 * for the job (the screen says "no data"), or the SOC is not an app job.
 */
export async function getCareerPaths(soc: string): Promise<CareerPaths | null> {
    const [field, zones] = await Promise.all([loadField(soc.slice(0, 2)), loadZones()]);
    const job = field?.socs[soc];
    if (!job) return null;
    return {
        soc,
        jobZone: job.jobZone,
        jobZoneRule: job.jobZoneRule,
        links: job.links.map((l) => {
            const jobZone = zones[l.to] ?? null;
            return { to: l.to, tier: l.tier, index: l.index, rows: l.rows, jobZone, direction: directionFor(job.jobZone, jobZone) };
        }),
    };
}

// ---------------------------------------------------------------- pay

/** The wage fields this needs: a national_wages.json entry and an occupation file entry both have them. */
export interface AnnualMedianFields {
    annualMedian: number | null;
    topcoded: Partial<Record<string, boolean>>;
}

export type PayChange =
    | { kind: 'change'; from: number; to: number; difference: number }
    /** At least one median is at or above BLS's cap: no exact difference exists. */
    | { kind: 'topcoded'; fromTopcoded: boolean; toTopcoded: boolean; cap: number };

/**
 * Target's median annual wage minus the current job's (BLS OEWS May 2025).
 * Null if either wage is missing (not published, or hourly only). If either is
 * top-coded, a flag with BLS's cap, never a made-up exact difference.
 */
export function payChange(
    from: AnnualMedianFields | null | undefined,
    to: AnnualMedianFields | null | undefined,
    cap: number = WAGES_META.topcode.annual,
): PayChange | null {
    if (!from || !to) return null;
    const fromTop = from.topcoded.annualMedian === true;
    const toTop = to.topcoded.annualMedian === true;
    if ((!fromTop && from.annualMedian == null) || (!toTop && to.annualMedian == null)) return null;
    if (fromTop || toTop) return { kind: 'topcoded', fromTopcoded: fromTop, toTopcoded: toTop, cap };
    return { kind: 'change', from: from.annualMedian!, to: to.annualMedian!, difference: to.annualMedian! - from.annualMedian! };
}

/**
 * A job's median annual wage, from the figures the role panel's pay line
 * shows: national_wages.json for the Kelley codes, else the job's occupation
 * file entry when it is loaded (it carries BLS's top-code flags), else the
 * bundled occupations index. The index has no flags; it is safe because no
 * OEWS May 2025 annual median is top-coded (careerPaths.test.ts fails if one
 * is), and a top-coded wage is stored as null, so it could never become a
 * number here. Null for a SOC that is not an app job.
 */
export function wageFieldsFor(soc: string, entry?: Pick<OccupationEntry, 'annualMedian' | 'topcoded'> | null): AnnualMedianFields | null {
    const kelley = WAGES_BY_SOC[soc];
    if (kelley) return { annualMedian: kelley.annualMedian, topcoded: kelley.topcoded };
    if (entry) return { annualMedian: entry.annualMedian, topcoded: entry.topcoded };
    const occ = INDEX_OCCUPATION_BY_SOC.get(soc);
    return occ ? { annualMedian: occ.annualMedian, topcoded: {} } : null;
}

/** payChange between two app jobs by SOC. */
export const payChangeFor = (fromSoc: string, toSoc: string): PayChange | null => payChange(wageFieldsFor(fromSoc), wageFieldsFor(toSoc));

// ---------------------------------------------------------------- AI Exposure

/** A job's published Automation Risk (ai_scores_bls.json, in the main bundle), or undefined if not scored. */
export const publishedRiskFor = (soc: string): number | undefined => BLS_SCORE_RISK.get(soc) ?? KELLEY_SOC_SCORES.get(soc)?.automationCostIndex;

export type CareerAiExposure = { band: RiskBand; risk: number } | 'not scored';

/**
 * The job's AI Exposure band on the map's own scale (pass roleScaleFor(jobs),
 * as the role panel does), or "not scored".
 */
export function aiExposureFor(soc: string, scale: RoleScale): CareerAiExposure {
    const risk = publishedRiskFor(soc);
    return risk === undefined ? 'not scored' : { band: bandFor(risk, scale), risk };
}
