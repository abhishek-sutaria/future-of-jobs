/**
 * What the Career Paths screen shows for a job, worked out from stored data
 * only (utils/careerPaths: O*NET 30.1 Related Occupations and Job Zones, BLS
 * OEWS May 2025 median annual wages, this site's published AI Exposure). Pure:
 * no React, no network, no Claude. components/careerPaths/CareerPathsView
 * renders it; careerPathsView.test.tsx checks the screen against it.
 *
 * NOTHING INVENTED. Every card is one stored O*NET link, in O*NET's order; a
 * missing wage is "no data", an unscored job "not scored", a job with no Job
 * Zone (or a mixed one) "Level not available". Never a guess.
 */

import { RISK_BAND_COLORS, RISK_UNSCORED_HEX } from '../config/theme';
import { aiExposureFor, JOB_ZONE_NAMES, payChange, wageFieldsFor, type CareerAiExposure, type CareerLink, type CareerPaths, type PayChange } from './careerPaths';
import { INDEX_OCCUPATION_BY_SOC } from './occupationIndex';
import type { RoleScale } from './roleScale';
import { percentOf } from './scoreRounding';
import { formatAnnualWage, WAGES_META } from './wages';

/** The four groups. "none" holds links with no direction: either job has no Job Zone, or a mixed one. */
export type CareerGroupId = 'up' | 'same' | 'down' | 'none';

export const GROUP_LABEL: Readonly<Record<CareerGroupId, string>> = {
    up: 'Step up',
    same: 'Same level',
    down: 'Step down',
    none: 'Level not available',
};

/** How a card's screen reader label names its group. */
export const GROUP_SPOKEN: Readonly<Record<CareerGroupId, string>> = {
    up: 'step up',
    same: 'same level',
    down: 'step down',
    none: 'level not available',
};

/** One line under each group heading: what the level means, in O*NET's terms. */
export const GROUP_HINT: Readonly<Record<CareerGroupId, string>> = {
    up: 'More preparation (higher O*NET Job Zone)',
    same: 'Same O*NET Job Zone',
    down: 'Less preparation (lower O*NET Job Zone)',
    none: 'O*NET gives no single Job Zone for one of the two jobs',
};

/** Phone order, top to bottom (the spec's order). */
export const PHONE_GROUP_ORDER: readonly CareerGroupId[] = ['up', 'same', 'down', 'none'];

/** Cards shown at first (Primary-Short, then Primary-Long, in O*NET order), and how many "Show more" adds. */
export const DEFAULT_SHOWN = 10;
export const SHOW_MORE_STEP = 10;

/** The words the screen uses. Fixed here so the test reads the same strings. */
export const CAREER_PATHS_TITLE = 'Career Paths';
export const CAREER_PATHS_SUBTITLE = 'Similar jobs you could move to';
export const CAREER_PATHS_SOURCE_LINE =
    'Related jobs and levels: O*NET 30.1 (similar skills and work, not records of actual job moves). Pay: BLS OEWS May 2025 median annual wage. AI Exposure: this site\'s scores.';
export const NO_RELATED_TEXT = 'O*NET lists no related jobs for this one.';
export const NO_DATA = 'no data';
export const NOT_SCORED = 'not scored';

export const groupOf = (link: Pick<CareerLink, 'direction'>): CareerGroupId => link.direction ?? 'none';

/** The panel's own names for the three map bands. */
const BAND_WORD = { safe: 'green', hybrid: 'amber', high: 'red' } as const;

export interface AiView {
    /** "green" | "amber" | "red" | "not scored" */
    band: 'green' | 'amber' | 'red' | typeof NOT_SCORED;
    color: string;
    /** "38%" (whole hundredths, as every % on screen), or "not scored". */
    percentText: string;
}

export function aiView(ai: CareerAiExposure): AiView {
    if (ai === 'not scored') return { band: NOT_SCORED, color: RISK_UNSCORED_HEX, percentText: NOT_SCORED };
    return { band: BAND_WORD[ai.band], color: RISK_BAND_COLORS[ai.band], percentText: `${percentOf(ai.risk)}%` };
}

const MINUS = '−';
const signOf = (d: number) => (d > 0 ? '+' : d < 0 ? MINUS : '');

/** "+$28k", "−$7k", "+$430", "$0". */
export function payChangeShort(d: number): string {
    const a = Math.abs(d);
    if (a === 0) return '$0';
    return a >= 1000 ? `${signOf(d)}$${Math.round(a / 1000)}k` : `${signOf(d)}$${a}`;
}

/** "+$82,890", "−$7,120", "$0". */
export const payChangeExact = (d: number): string => `${signOf(d)}${formatAnnualWage(Math.abs(d))}`;

export const medianText = (soc: string): string => {
    const w = wageFieldsFor(soc);
    if (w?.topcoded.annualMedian) return `≥ ${formatAnnualWage(WAGES_META.topcode.annual)}`;
    return w?.annualMedian != null ? formatAnnualWage(w.annualMedian) : NO_DATA;
};

export interface PayView {
    change: PayChange | null;
    /** On the card: "+$28k", "no data" or "top-coded". */
    short: string;
    /** In the screen reader label: "+$27,120", "no data" or "top-coded". */
    exact: string;
    /** The tooltip: both medians and the exact difference, or why there is none. */
    title: string;
}

export function payView(fromSoc: string, toSoc: string, toTitle: string, fromTitle: string): PayView {
    const change = payChange(wageFieldsFor(fromSoc), wageFieldsFor(toSoc));
    if (!change) {
        const missing = [wageFieldsFor(toSoc)?.annualMedian == null ? toTitle : null, wageFieldsFor(fromSoc)?.annualMedian == null ? fromTitle : null].filter(Boolean);
        return { change, short: NO_DATA, exact: NO_DATA, title: `Pay change: no data. BLS OEWS May 2025 publishes no median annual wage for ${missing.join(' or ')}.` };
    }
    if (change.kind === 'topcoded') {
        return { change, short: 'top-coded', exact: 'top-coded', title: `Pay change: no exact figure. BLS publishes this median only as at or above ${formatAnnualWage(change.cap)} a year.` };
    }
    const exact = payChangeExact(change.difference);
    return {
        change,
        short: payChangeShort(change.difference),
        exact,
        title: `Median annual pay ${formatAnnualWage(change.to)} vs ${formatAnnualWage(change.from)} for ${fromTitle}: ${exact} a year (BLS OEWS May 2025).`,
    };
}

export const titleOf = (soc: string): string => INDEX_OCCUPATION_BY_SOC.get(soc)?.title ?? soc;

export interface CareerCard {
    soc: string;
    title: string;
    group: CareerGroupId;
    tier: CareerLink['tier'];
    /** O*NET's Index on the link. */
    index: number;
    /** Position in the job's links, O*NET order (0 = most related). */
    rank: number;
    jobZone: number | null;
    median: string;
    pay: PayView;
    ai: AiView;
    /** "Financial Managers, same level, pay +$82,890, AI Exposure amber" */
    ariaLabel: string;
}

export function cardFor(centreSoc: string, link: CareerLink, rank: number, scale: RoleScale): CareerCard {
    const title = titleOf(link.to);
    const group = groupOf(link);
    const pay = payView(centreSoc, link.to, title, titleOf(centreSoc));
    const ai = aiView(aiExposureFor(link.to, scale));
    return {
        soc: link.to,
        title,
        group,
        tier: link.tier,
        index: link.index,
        rank,
        jobZone: link.jobZone,
        median: medianText(link.to),
        pay,
        ai,
        ariaLabel: `${title}, ${GROUP_SPOKEN[group]}, pay ${pay.exact}, AI Exposure ${ai.band}`,
    };
}

/** The first `shown` links as cards, in O*NET order. */
export function visibleCards(paths: CareerPaths, shown: number, scale: RoleScale): CareerCard[] {
    return paths.links.slice(0, shown).map((l, i) => cardFor(paths.soc, l, i, scale));
}

/** Cards by group, each in O*NET order. */
export function groupCards(cards: readonly CareerCard[]): Record<CareerGroupId, CareerCard[]> {
    const out: Record<CareerGroupId, CareerCard[]> = { up: [], same: [], down: [], none: [] };
    for (const c of cards) out[c.group].push(c);
    return out;
}

export interface CentreView {
    soc: string;
    title: string;
    median: string;
    ai: AiView;
    /** "Job Zone 4: Considerable Preparation Needed", "Job Zone: level not available", or "Job Zone: no data". */
    zoneText: string;
    zone: number | null;
}

/**
 * The centre card. `paths` is getCareerPaths(soc): null when O*NET has
 * nothing for the job, so its Job Zone is "no data".
 */
export function centreView(soc: string, paths: CareerPaths | null | undefined, scale: RoleScale): CentreView {
    const zone = paths?.jobZone ?? null;
    const name = zone != null ? JOB_ZONE_NAMES[String(zone)]?.replace(/^Job Zone \w+: /, '') : null;
    return {
        soc,
        title: titleOf(soc),
        median: medianText(soc),
        ai: aiView(aiExposureFor(soc, scale)),
        zone,
        zoneText: zone != null ? `Job Zone ${zone}${name ? `: ${name}` : ''}` : paths ? 'Job Zone: level not available' : `Job Zone: ${NO_DATA}`,
    };
}
