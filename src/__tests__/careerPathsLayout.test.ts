/**
 * The desktop Career Paths picture (utils/careerPathsLayout) for EVERY job
 * with O*NET links: no two cards or headings overlap, no arrow runs under a
 * card or heading, no two arrows cross, nothing leaves the canvas, and there
 * is exactly one arrow per card, in O*NET order within each group. Checked at
 * the content width of a 1280 and a 1440 wide window (the view pads 32px
 * each side, and a scroll bar may take 15px more), and at the narrowest width
 * that still gets this layout, for the first 10 links, the first 20, and all.
 */

import { describe, it, expect } from 'vitest';
import { CAREER_PATHS_COVERAGE, getCareerPaths } from '../utils/careerPaths';
import { OCCUPATION_INDEX } from '../utils/occupationIndex';
import { DESKTOP_MIN_WIDTH, desktopLayout, layoutProblems } from '../utils/careerPathsLayout';
import { DEFAULT_SHOWN, groupOf, SHOW_MORE_STEP, type CareerGroupId } from '../utils/careerPathsView';

const WIDTHS = [1280 - 64 - 15, 1440 - 64, DESKTOP_MIN_WIDTH];

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

describe('desktop layout', () => {
    it('has no overlaps or crossings for any job, at 1280 and 1440 and the narrowest desktop width', async () => {
        const cases = await allGroups();
        expect(new Set(cases.map((c) => c.soc)).size).toBe(CAREER_PATHS_COVERAGE.withLinks);
        const problems: string[] = [];
        for (const { soc, shown, levels, groups } of cases) {
            if (!levels) expect(groups.up.length + groups.same.length + groups.down.length, soc).toBe(0);
            for (const width of WIDTHS) {
                const l = desktopLayout(groups, width, levels);
                for (const p of layoutProblems(l)) problems.push(`${soc} first ${shown} at ${width}px: ${p}`);
                // One arrow per card, every card once, each group in O*NET order.
                const n = groups.up.length + groups.same.length + groups.down.length + groups.none.length;
                expect(l.cards).toHaveLength(n);
                expect(l.arrows.map((a) => a.soc).sort()).toEqual(l.cards.map((c) => c.soc).sort());
                for (const g of ['up', 'same', 'down', 'none'] as const) {
                    // A mixed centre job lists its left lane (1st, 3rd, ...) before its right lane (2nd, 4th, ...).
                    const want = levels ? groups[g] : [...groups[g].filter((_, i) => i % 2 === 0), ...groups[g].filter((_, i) => i % 2 === 1)];
                    expect(l.cards.filter((c) => c.group === g).map((c) => c.soc)).toEqual(want);
                }
            }
            if (problems.length > 20) break;
        }
        expect(problems.slice(0, 20)).toEqual([]);
    }, 240_000);

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

    it('a centre job with no level (mixed): every card is "Level not available", split over both side lanes, no level headings', () => {
        const l = desktopLayout({ up: [], same: [], down: [], none: ['a', 'b', 'c'] }, 1376, false);
        expect(l.headings.map((h) => [h.group, h.x === 0 ? 'left' : 'right', h.count])).toEqual([['none', 'left', 2], ['none', 'right', 1]]);
        expect(l.cards.map((c) => [c.soc, c.rect.x === 0 ? 'left' : 'right'])).toEqual([['a', 'left'], ['c', 'left'], ['b', 'right']]);
        expect(layoutProblems(l)).toEqual([]);
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
