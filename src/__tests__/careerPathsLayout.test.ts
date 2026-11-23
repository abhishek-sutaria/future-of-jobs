/**
 * The desktop Career Paths picture (utils/careerPathsLayout) for EVERY job
 * with O*NET links: no two cards or headings overlap, no arrow runs under a
 * card or heading, no two arrows cross, nothing leaves the canvas, and there
 * is exactly one arrow per card, in O*NET order within each group. Cards are
 * as tall as their full titles need (cardHeightFor), and an empty group has no
 * lane and no heading. Checked at the content width of a 1200, 1280 and 1440
 * wide window (the view pads 32px each side, a scroll bar may take 15px more),
 * and at the narrowest width that still gets this layout, for the first 10
 * links, the first 20, and all; and once more with every card four lines tall.
 */

import { describe, it, expect } from 'vitest';
import { CAREER_PATHS_COVERAGE, getCareerPaths } from '../utils/careerPaths';
import { OCCUPATION_INDEX } from '../utils/occupationIndex';
import {
    CARD_LINE_H,
    CARD_MIN_H,
    CENTRE_H,
    CENTRE_NOTE_H,
    cardHeightFor,
    centreHeightFor,
    DESKTOP_MIN_WIDTH,
    desktopLayout,
    layoutProblems,
    linesFor,
    roughMeasure,
} from '../utils/careerPathsLayout';
import { DEFAULT_SHOWN, groupOf, SHOW_MORE_STEP, titleOf, type CareerGroupId } from '../utils/careerPathsView';

const WIDTHS = [1200 - 64 - 15, 1280 - 64 - 15, 1440 - 64, DESKTOP_MIN_WIDTH];
/** Any pay chip is at most this wide ("pay: no data"). */
const CHIP = 'pay: no data';

async function allGroups() {
    const out: { soc: string; shown: number; levels: boolean; groups: Record<CareerGroupId, string[]> }[] = [];
    for (const { soc } of OCCUPATION_INDEX.occupations) {
        const cp = await getCareerPaths(soc);
        if (!cp) continue;
        for (const shown of [DEFAULT_SHOWN, DEFAULT_SHOWN + SHOW_MORE_STEP, cp.links.length]) {
            const groups: Record<CareerGroupId, string[]> = { up: [], same: [], down: [], none: [] };
            for (const l of cp.links.slice(0, shown)) groups[groupOf(l)].push(l.to);
            out.push({ soc, shown, levels: cp.jobZone != null, groups });
        }
    }
    return out;
}

const realHeights = (soc: string) => ({
    cardHeight: (s: string, w: number) => cardHeightFor(titleOf(s), CHIP, w),
    centreHeight: (w: number) => centreHeightFor(titleOf(soc), w, true),
});

describe('desktop layout', () => {
    it('has no overlaps or crossings for any job, with full-height titles, at 1200, 1280, 1440 and the narrowest desktop width', async () => {
        const cases = await allGroups();
        expect(new Set(cases.map((c) => c.soc)).size).toBe(CAREER_PATHS_COVERAGE.withLinks);
        const problems: string[] = [];
        for (const { soc, shown, levels, groups } of cases) {
            if (!levels) expect(groups.up.length + groups.same.length + groups.down.length, soc).toBe(0);
            for (const width of WIDTHS) {
                const l = desktopLayout(groups, width, { levels, ...realHeights(soc) });
                for (const p of layoutProblems(l)) problems.push(`${soc} first ${shown} at ${width}px: ${p}`);
                // One arrow per card, every card once, each group in O*NET order.
                const n = groups.up.length + groups.same.length + groups.down.length + groups.none.length;
                expect(l.cards).toHaveLength(n);
                expect(l.arrows.map((a) => a.soc).sort()).toEqual(l.cards.map((c) => c.soc).sort());
                for (const g of ['up', 'same', 'down', 'none'] as const) {
                    // A mixed centre job lists its left lane (1st, 3rd, ...) before its right lane (2nd, 4th, ...).
                    const want = levels ? groups[g] : [...groups[g].filter((_, i) => i % 2 === 0), ...groups[g].filter((_, i) => i % 2 === 1)];
                    expect(l.cards.filter((c) => c.group === g).map((c) => c.soc)).toEqual(want);
                    // No heading for a group with no card.
                    if (groups[g].length === 0) expect(l.headings.some((h) => h.group === g)).toBe(false);
                }
                // Every card is at least as tall as its own full title needs at its width.
                for (const c of l.cards) expect(c.rect.h).toBeGreaterThanOrEqual(cardHeightFor(titleOf(c.soc), CHIP, c.rect.w));
            }
            if (problems.length > 20) break;
        }
        expect(problems.slice(0, 20)).toEqual([]);
    }, 300_000);

    it('still has none with every card four title lines tall', async () => {
        const cases = (await allGroups()).filter((_, i) => i % 3 === 2); // all links of each job
        const tall = { cardHeight: () => CARD_MIN_H + 3 * CARD_LINE_H, centreHeight: () => CENTRE_H + 2 * 28 + CENTRE_NOTE_H };
        const problems: string[] = [];
        for (const { soc, levels, groups } of cases) {
            for (const p of layoutProblems(desktopLayout(groups, WIDTHS[1], { levels, ...tall }))) problems.push(`${soc}: ${p}`);
        }
        expect(problems.slice(0, 10)).toEqual([]);
    }, 120_000);

    it('puts Step down on the left, Step up on the right, Same level under the centre card', () => {
        const l = desktopLayout({ up: ['a'], same: ['b', 'c'], down: ['d'], none: ['e'] }, 1376);
        const at = (soc: string) => l.cards.find((c) => c.soc === soc)!.rect;
        expect(at('d').x + at('d').w).toBeLessThan(l.centre.x);
        expect(at('a').x).toBeGreaterThan(l.centre.x + l.centre.w);
        for (const s of ['b', 'c']) {
            expect(at(s).y).toBeGreaterThan(l.centre.y + l.centre.h);
            expect(at(s).x).toBeGreaterThanOrEqual(l.centre.x);
            expect(at(s).x + at(s).w).toBeLessThanOrEqual(l.centre.x + l.centre.w);
        }
        // "Level not available" joins the shorter side lane (a tie goes right).
        expect(l.noneSide).toBe('right');
        expect(at('e').x).toBe(at('a').x);
        expect(desktopLayout({ up: ['a', 'x'], same: [], down: ['d'], none: ['e'] }, 1376).noneSide).toBe('left');
    });

    it('gives an empty group no lane and no heading; the rest are centred and the middle lane widens', () => {
        const both = desktopLayout({ up: ['a'], same: ['b'], down: ['d'], none: [] }, 1376);
        const noUp = desktopLayout({ up: [], same: ['b'], down: ['d'], none: [] }, 1376);
        expect(noUp.headings.map((h) => h.group).sort()).toEqual(['down', 'same']);
        expect(noUp.centre.w).toBeGreaterThan(both.centre.w);
        // Centred: the space left over is split evenly either side.
        const right = noUp.centre.x + noUp.centre.w;
        const leftEdge = Math.min(...noUp.cards.map((c) => c.rect.x));
        expect(Math.abs(leftEdge - (1376 - right))).toBeLessThanOrEqual(1);
        // No side lane at all: the centre card alone, centred, no wider than MID_MAX.
        const none = desktopLayout({ up: [], same: ['b', 'c'], down: [], none: [] }, 1376);
        expect(none.headings.map((h) => h.group)).toEqual(['same']);
        expect(Math.abs(none.centre.x - (1376 - none.centre.x - none.centre.w))).toBeLessThanOrEqual(1);
        expect(layoutProblems(noUp)).toEqual([]);
        expect(layoutProblems(none)).toEqual([]);
    });

    it('a centre job with no level (mixed): every card is "Level not available", split over both side lanes, no level headings', () => {
        const l = desktopLayout({ up: [], same: [], down: [], none: ['a', 'b', 'c'] }, 1376, { levels: false });
        expect(l.headings.map((h) => [h.group, h.x < l.centre.x ? 'left' : 'right', h.count])).toEqual([['none', 'left', 2], ['none', 'right', 1]]);
        expect(l.cards.map((c) => [c.soc, c.rect.x < l.centre.x ? 'left' : 'right'])).toEqual([['a', 'left'], ['c', 'left'], ['b', 'right']]);
        expect(layoutProblems(l)).toEqual([]);
    });

    it('cards grow with their titles: full names, no "..."', () => {
        const long = 'First-Line Supervisors of Transportation and Material Moving Workers, Except Aircraft Cargo Handling Supervisors';
        expect(linesFor('Tax Preparers', 200, 'card', roughMeasure)).toBe(1);
        expect(linesFor(long, 160, 'card', roughMeasure)).toBeGreaterThanOrEqual(5);
        expect(cardHeightFor(long, '+$12k', 220)).toBeGreaterThan(cardHeightFor('Tax Preparers', '+$12k', 220));
        // The two Same level cards of a row share the taller height.
        const l = desktopLayout({ up: [], same: ['short', 'long'], down: [], none: [] }, 1376, { cardHeight: (s) => (s === 'long' ? 140 : 60) });
        expect(l.cards.map((c) => c.rect.h)).toEqual([140, 140]);
        // The centre card grows too, and makes room for the muted line.
        expect(centreHeightFor(long, 500, false)).toBeGreaterThan(CENTRE_H);
        expect(centreHeightFor('Electricians', 500, true)).toBe(CENTRE_H + CENTRE_NOTE_H);
    });

    it('finds a crossing or an overlap when there is one (the check itself works)', () => {
        const l = desktopLayout({ up: ['a', 'b'], same: ['c'], down: [], none: [] }, 1376);
        const moved = { ...l, cards: l.cards.map((c) => (c.soc === 'b' ? { ...c, rect: { ...c.rect, y: l.cards.find((x) => x.soc === 'a')!.rect.y + 10 } } : c)) };
        expect(layoutProblems(moved)).toContain('a overlaps b');
        const crossing = {
            ...l,
            arrows: [
                { ...l.arrows[0], soc: 'p', points: [{ x: 100, y: 0 }, { x: 200, y: 100 }] },
                { ...l.arrows[0], soc: 'q', points: [{ x: 100, y: 100 }, { x: 200, y: 0 }] },
            ],
        };
        expect(layoutProblems(crossing)).toContain('arrows to p and q cross');
        const under = { ...l, arrows: [{ ...l.arrows[0], soc: 'r', points: [{ x: l.centre.x + 10, y: l.centre.y + 10 }] }] };
        expect(layoutProblems(under)).toContain('arrow to r runs under centre');
    });
});
