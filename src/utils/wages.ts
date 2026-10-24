/**
 * National pay for each role, from the bundled BLS OEWS May 2025 workbook
 * extract in src/data/national_wages.json (scripts/extract_oews_wages.py).
 *
 * Published numbers only: nothing here computes, converts or estimates a wage.
 * Hourly is never turned into annual, a top-coded wage shows BLS's own cap
 * as "≥ $X", and a measure BLS did not publish stays null and is shown as
 * such. Titles that share a SOC get the same entry; wages are never split the
 * way employment is.
 */

import wagesJson from '../data/national_wages.json';
import { MAP_TITLE_TO_SOC, socPartnerTitles } from './onet';

/** Shown on the panel. annualPct10/annualPct90 are stored but not shown yet. */
export type WageMeasure = 'annualMedian' | 'annualMean' | 'hourlyMedian' | 'hourlyMean';
export type StoredWageMeasure = WageMeasure | 'annualPct10' | 'annualPct90';

export interface WageEntry {
    /** BLS OCC_TITLE for the SOC the role maps to. */
    occTitle: string;
    /** Where in the workbook each value was read from. */
    source: { sheet: string; rows: number[]; oGroups: string[]; columns: Record<string, string> };
    /** Equivalent api.bls.gov series, for scripts/verify_wages.mjs. */
    seriesIds: Record<WageMeasure, string>;
    annualMedian: number | null;
    annualMean: number | null;
    hourlyMedian: number | null;
    hourlyMean: number | null;
    annualPct10: number | null;
    annualPct90: number | null;
    /** Workbook ANNUAL / HOURLY = TRUE: BLS releases only that kind of wage. */
    annualOnly: boolean;
    hourlyOnly: boolean;
    topcoded: Record<StoredWageMeasure, boolean>;
    nullReasons: Partial<Record<StoredWageMeasure, string>>;
}

export interface WagesMeta {
    source: string;
    source_url: string;
    sha256: string;
    method: string;
    bls_release: string;
    api_vintage: string;
    extracted: string;
    /** Cap read from the workbook's notes sheet. */
    topcode: { symbol: string; text: string; hourly: number; annual: number };
}

const { _meta, ...entries } = wagesJson as unknown as { _meta: WagesMeta } & Record<string, WageEntry>;

export const WAGES_META: WagesMeta = _meta;
export const WAGES_BY_SOC: Record<string, WageEntry> = entries;

/**
 * Roles mapped to a BLS code that covers more than the title itself: an
 * "All Other" residual or a broader occupation. Their pay is the whole BLS
 * group's, which the panel says.
 */
export const WIDER_BLS_GROUP_TITLES: ReadonlySet<string> = new Set([
    'IT Project Manager',   // 15-1299 Computer Occupations, All Other
    'Risk Specialist',      // 13-2099 Financial Specialists, All Other
    'Account Executive',    // 41-3091 Sales Representatives of Services, Except Advertising, Insurance, Financial Services, and Travel
]);

export function wageForTitle(title: string): { soc: string; entry: WageEntry } | null {
    const soc = MAP_TITLE_TO_SOC[title];
    const entry = soc ? WAGES_BY_SOC[soc] : undefined;
    return soc && entry ? { soc, entry } : null;
}

const isAnnual = (m: WageMeasure) => m === 'annualMedian' || m === 'annualMean';

/** $1,234 — whole dollars, no "k". */
export const formatAnnualWage = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** $12.34 */
export const formatHourlyWage = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface WageText {
    /** Display string: "$1,234", "≥ $239,200", or null when BLS published nothing. */
    text: string | null;
    topcoded: boolean;
    reason?: string;
}

/** How one measure reads on screen, exactly as BLS published it. */
export function wageText(entry: WageEntry, measure: WageMeasure, meta: WagesMeta = WAGES_META): WageText {
    const fmt = isAnnual(measure) ? formatAnnualWage : formatHourlyWage;
    if (entry.topcoded[measure]) {
        return { text: `≥ ${fmt(isAnnual(measure) ? meta.topcode.annual : meta.topcode.hourly)}`, topcoded: true };
    }
    const v = entry[measure];
    if (v == null) return { text: null, topcoded: false, reason: entry.nullReasons[measure] };
    return { text: fmt(v), topcoded: false };
}

export interface PaySummary {
    /** "Median annual pay", or "Median hourly pay" for an hourly-only occupation. */
    label: string;
    headline: WageText;
    /** Secondary mean in the same unit as the headline, when BLS published one. */
    mean: string | null;
}

/**
 * Headline is the annual median. For an occupation BLS publishes only hourly
 * wages for, the headline says so and shows the hourly median instead, never
 * an annualised hourly figure.
 */
export function paySummary(entry: WageEntry, meta: WagesMeta = WAGES_META): PaySummary {
    if (entry.hourlyOnly) {
        const hourlyMean = wageText(entry, 'hourlyMean', meta).text;
        return {
            label: 'Median hourly pay',
            headline: wageText(entry, 'hourlyMedian', meta),
            mean: hourlyMean ? `${hourlyMean}/hr` : null,
        };
    }
    return {
        label: 'Median annual pay',
        headline: wageText(entry, 'annualMedian', meta),
        mean: wageText(entry, 'annualMean', meta).text,
    };
}

/**
 * SOCs that BLS itself publishes as a combined code. Read from the workbook:
 * OEWS lists an occupation it only publishes at the broad level on a "broad"
 * row (and again as "detailed"). Today that is 13-1020 Buyers and Purchasing
 * Agents alone. Other shared codes (11-2021, 15-2051) are ordinary detailed
 * BLS occupations that two of our titles happen to map to.
 */
export const BLS_COMBINED_SOCS: ReadonlySet<string> = new Set(
    Object.entries(WAGES_BY_SOC)
        .filter(([, entry]) => entry.source.oGroups.includes('broad'))
        .map(([soc]) => soc)
);

/** The small mapping note under the pay line, or null when the code is the role's own. */
export function payScopeNote(title: string): string | null {
    const found = wageForTitle(title);
    if (!found) return null;
    const { soc, entry } = found;
    const partners = socPartnerTitles(title);
    if (partners.length > 0) {
        return BLS_COMBINED_SOCS.has(soc)
            ? `Combined BLS code ${soc}, shared with ${partners.join(', ')}.`
            : `Shares BLS code ${soc} with ${partners.join(', ')}.`;
    }
    if (WIDER_BLS_GROUP_TITLES.has(title)) {
        return `Pay covers the wider BLS group ${soc} (${entry.occTitle}).`;
    }
    return null;
}
