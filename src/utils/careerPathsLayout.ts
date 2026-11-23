/**
 * Where every card and arrow of the desktop Career Paths screen goes. Pure
 * geometry from the cards, their heights and the width, so the same input
 * always draws the same picture, and careerPathsLayout.test.ts can prove for
 * every job that no two cards overlap, no arrow runs under a card or heading,
 * no two arrows cross and nothing leaves the canvas.
 *
 *   Step down        |        centre card         |        Step up
 *   (left lane)      |   Same level, two columns  |     (right lane)
 *                    |   either side of a channel |
 *
 * Left to right is the O*NET Job Zone. The centre card heads the middle lane,
 * as wide as it. "Level not available" is a fourth small group at the foot of
 * the shorter side lane. A group with no card gets no lane and no heading
 * (the view says "No step-up jobs listed" on the centre card instead); the
 * lanes left are centred, and the middle lane takes the room, up to MID_MAX.
 *
 * Heights: a card is as tall as its full title needs (no "..."): the caller
 * passes cardHeight(soc, width), worked out by cardHeightFor from the title's
 * measured width. The two Same level cards of a row share the taller height.
 *
 * Arrows, one per card (one stored O*NET link each):
 *   - side lanes: a curve from the centre card's side edge to the card's inner
 *     edge, entirely in the gutter between the lanes. Start points are spread
 *     down the centre's edge in the same order as the cards, and every curve
 *     in a gutter has the same x(t), so they never cross.
 *   - same level: from the centre card's bottom edge straight down its own
 *     lane in the channel, then a rounded turn into the card's channel-facing
 *     edge. The nearest row's lane is next to the cards, each farther row's
 *     one step further out, so a turn never cuts another lane.
 */

import type { CareerGroupId } from './careerPathsView';

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Point {
    x: number;
    y: number;
}

export type ArrowKind = 'side' | 'channel';

export interface LaidCard {
    soc: string;
    group: CareerGroupId;
    rect: Rect;
}

export interface LaidArrow {
    soc: string;
    group: CareerGroupId;
    kind: ArrowKind;
    /** The SVG path. */
    d: string;
    /** The path as a polyline, for hit tests and the overlap test. */
    points: Point[];
    /** Where the arrowhead points, and which way (+1 right, -1 left). */
    end: Point;
    dir: 1 | -1;
}

export interface LaidHeading {
    group: CareerGroupId;
    x: number;
    y: number;
    w: number;
    count: number;
}

export interface DesktopLayout {
    width: number;
    height: number;
    centre: Rect;
    cards: LaidCard[];
    arrows: LaidArrow[];
    headings: LaidHeading[];
    /** Which side lane holds "Level not available". */
    noneSide: 'left' | 'right';
}

/** Below this content width the screen uses the stacked (phone) layout. */
export const DESKTOP_MIN_WIDTH = 1080;

/** A card is never shorter than this (one title line), whatever its title. */
export const CARD_MIN_H = 60;
/** Card height without its title: 2 x 8px padding, 2px border, 2px gap, 16px pay/AI line. */
const CARD_BASE_H = 36;
/** One title line on a card (13px, leading 16px). */
export const CARD_LINE_H = 16;
export const CARD_GAP = 10;
export const HEADING_H = 40;
/** The centre card with a title of up to two lines. */
export const CENTRE_H = 206;
/** One centre title line (20px, leading-snug). */
const CENTRE_LINE_H = 28;
/** The muted "No step-up jobs listed" line on the centre card. */
export const CENTRE_NOTE_H = 24;
/** The middle lane never grows wider than this when a side lane is missing. */
export const MID_MAX = 780;
export const GUTTER = 76;
/** Space between the centre card and the Same level cards (their heading sits here). */
export const SAME_TOP_GAP = 52;
/** Between two groups in one side lane. */
export const GROUP_GAP = 22;
/** Space between two lanes in the channel; less when many Same level cards would squeeze the cards. */
const LANE_GAP = 7;
const LANE_GAP_MIN = 3;
/** A Same level card is never narrower than this. */
const SAME_MIN_W = 172;
const EDGE_PAD = 9;
const MID_GAP = 10;
const TURN_R = 6;
/** The part of the centre card's side edge the side arrows start from. */
const FAN_INSET = 26;

export interface GroupSocs {
    up: readonly string[];
    same: readonly string[];
    down: readonly string[];
    none: readonly string[];
}

const fmt = (n: number) => Math.round(n * 10) / 10;

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, steps = 24): Point[] {
    const out: Point[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = (1 - t) ** 3;
        const b = 3 * (1 - t) ** 2 * t;
        const c = 3 * (1 - t) * t ** 2;
        const e = t ** 3;
        out.push({ x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y });
    }
    return out;
}

/** A curve across a gutter, from the centre's side edge (x0) to a card's inner edge (x1). */
function sideArrow(soc: string, group: CareerGroupId, x0: number, y0: number, x1: number, y1: number): LaidArrow {
    const k = (x1 - x0) / 2;
    const p0 = { x: x0, y: y0 };
    const p1 = { x: x0 + k, y: y0 };
    const p2 = { x: x1 - k, y: y1 };
    const p3 = { x: x1, y: y1 };
    return {
        soc,
        group,
        kind: 'side',
        d: `M${fmt(x0)} ${fmt(y0)} C${fmt(p1.x)} ${fmt(p1.y)} ${fmt(p2.x)} ${fmt(p2.y)} ${fmt(x1)} ${fmt(y1)}`,
        points: cubic(p0, p1, p2, p3),
        end: p3,
        dir: x1 > x0 ? 1 : -1,
    };
}

/** Down a channel lane from the centre's bottom edge, then a rounded turn into the card (cardX = its channel-facing edge). */
function channelArrow(soc: string, laneX: number, y0: number, cardX: number, y1: number): LaidArrow {
    const dir: 1 | -1 = cardX > laneX ? 1 : -1;
    const r = Math.min(TURN_R, Math.abs(cardX - laneX) / 2, (y1 - y0) / 2);
    const turnY = y1 - r;
    const d = `M${fmt(laneX)} ${fmt(y0)} V${fmt(turnY)} Q${fmt(laneX)} ${fmt(y1)} ${fmt(laneX + dir * r)} ${fmt(y1)} H${fmt(cardX)}`;
    const points: Point[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) points.push({ x: laneX, y: y0 + ((turnY - y0) * i) / steps });
    for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        // Quadratic from (laneX, turnY) via (laneX, y1) to (laneX + dir r, y1).
        points.push({ x: laneX + dir * r * t * t, y: (1 - t) ** 2 * turnY + 2 * (1 - t) * t * y1 + t * t * y1 });
    }
    for (let i = 1; i <= 8; i++) points.push({ x: laneX + dir * r + ((cardX - (laneX + dir * r)) * i) / 8, y: y1 });
    return { soc, group: 'same', kind: 'channel', d, points, end: { x: cardX, y: y1 }, dir };
}

export interface LayoutOptions {
    /** False when the centre job itself has no Job Zone (mixed): see desktopLayout. */
    levels?: boolean;
    /** A card's height at a width (cardHeightFor with its title). Default: CARD_MIN_H. */
    cardHeight?: (soc: string, width: number) => number;
    /** The centre card's height at a width (centreHeightFor). Default: CENTRE_H. */
    centreHeight?: (width: number) => number;
}

/**
 * The desktop picture for one centre job. `width` is the content width
 * (DESKTOP_MIN_WIDTH or more). Cards are in the order given (O*NET order).
 * With `levels` false (the centre job has no Job Zone) every link is "Level
 * not available", split between the two side lanes (first, third, ... on the
 * left), with no Step up / Same level / Step down at all.
 */
export function desktopLayout(groups: GroupSocs, width: number, opts: LayoutOptions = {}): DesktopLayout {
    const levels = opts.levels ?? true;
    const cardHeight = opts.cardHeight ?? (() => CARD_MIN_H);
    // "Level not available" joins the shorter side lane (the right one on a tie).
    const noneSide: 'left' | 'right' = groups.down.length < groups.up.length ? 'left' : 'right';
    type LaneGroup = { group: CareerGroupId; socs: readonly string[] };
    const wanted: Record<'left' | 'right', LaneGroup[]> = levels
        ? {
              left: [{ group: 'down', socs: groups.down }, ...(noneSide === 'left' ? [{ group: 'none' as const, socs: groups.none }] : [])],
              right: [{ group: 'up', socs: groups.up }, ...(noneSide === 'right' ? [{ group: 'none' as const, socs: groups.none }] : [])],
          }
        : { left: [{ group: 'none', socs: groups.none.filter((_, i) => i % 2 === 0) }], right: [{ group: 'none', socs: groups.none.filter((_, i) => i % 2 === 1) }] };
    // A group with no card gets no lane, no heading and no space.
    const left = wanted.left.filter((g) => g.socs.length > 0);
    const right = wanted.right.filter((g) => g.socs.length > 0);

    const sideW = Math.round(Math.min(300, Math.max(220, width * 0.22)));
    const sides = (left.length > 0 ? 1 : 0) + (right.length > 0 ? 1 : 0);
    const midW = Math.min(MID_MAX, width - sides * (sideW + GUTTER));
    const x0 = Math.round((width - midW - sides * (sideW + GUTTER)) / 2);
    const leftX = x0;
    const midX = x0 + (left.length > 0 ? sideW + GUTTER : 0);
    const rightX = midX + midW + GUTTER;
    const centre: Rect = { x: midX, y: 0, w: midW, h: Math.max(CENTRE_H, opts.centreHeight?.(midW) ?? CENTRE_H) };
    const cards: LaidCard[] = [];
    const arrows: LaidArrow[] = [];
    const headings: LaidHeading[] = [];

    let height = centre.h;
    for (const lane of [{ side: 'left' as const, x: leftX, list: left }, { side: 'right' as const, x: rightX, list: right }]) {
        let y = 0;
        const placed: LaidCard[] = [];
        lane.list.forEach(({ group, socs }, i) => {
            if (i > 0) y += GROUP_GAP;
            headings.push({ group, x: lane.x, y, w: sideW, count: socs.length });
            y += HEADING_H;
            for (const soc of socs) {
                const h = Math.max(CARD_MIN_H, cardHeight(soc, sideW));
                placed.push({ soc, group, rect: { x: lane.x, y, w: sideW, h } });
                y += h + CARD_GAP;
            }
        });
        height = Math.max(height, y);
        // Fan the start points down the centre's side edge in card order.
        const top = centre.y + FAN_INSET;
        const span = centre.h - 2 * FAN_INSET;
        placed.forEach((c, i) => {
            const y0 = placed.length === 1 ? centre.y + centre.h / 2 : top + (span * i) / (placed.length - 1);
            const xa = lane.side === 'left' ? centre.x : centre.x + centre.w;
            const xb = lane.side === 'left' ? c.rect.x + c.rect.w : c.rect.x;
            arrows.push(sideArrow(c.soc, c.group, xa, y0, xb, c.rect.y + c.rect.h / 2));
            cards.push(c);
        });
    }

    // Same level: two columns either side of the channel, filled left, right, left, ...
    const same = levels ? groups.same : [];
    if (same.length > 0) {
        const lanesPerSide = Math.ceil(same.length / 2);
        const roomy = ((midW - 2 * SAME_MIN_W - MID_GAP) / 2 - EDGE_PAD) / lanesPerSide;
        const laneGap = Math.max(LANE_GAP_MIN, Math.min(LANE_GAP, roomy));
        const channelW = 2 * (EDGE_PAD + lanesPerSide * laneGap) + MID_GAP;
        const subW = (midW - channelW) / 2;
        const chLeft = midX + subW;
        const chRight = chLeft + channelW;
        const sameTop = centre.h + SAME_TOP_GAP;
        headings.push({ group: 'same', x: midX, y: sameTop - HEADING_H, w: subW, count: same.length });
        let y = sameTop;
        for (let row = 0; row * 2 < same.length; row++) {
            const pair = same.slice(row * 2, row * 2 + 2);
            const h = Math.max(CARD_MIN_H, ...pair.map((soc) => cardHeight(soc, subW)));
            pair.forEach((soc, k) => {
                const isLeft = k === 0;
                const rect: Rect = { x: isLeft ? midX : chRight, y, w: subW, h };
                cards.push({ soc, group: 'same', rect });
                const laneX = isLeft ? chLeft + EDGE_PAD + row * laneGap : chRight - EDGE_PAD - row * laneGap;
                arrows.push(channelArrow(soc, laneX, centre.y + centre.h, isLeft ? chLeft : chRight, y + h / 2));
            });
            y += h + CARD_GAP;
        }
        height = Math.max(height, y - CARD_GAP);
    }

    return { width, height: Math.ceil(height), centre, cards, arrows, headings, noneSide };
}

// ---------------------------------------------------------------- heights from the titles

/** The text's width in px for one of the screen's three title styles. */
export type MeasureText = (text: string, style: 'card' | 'chip' | 'centre') => number;

/**
 * A width estimate with no canvas (tests, jsdom): per character, wider than
 * Inter and Outfit really are, so it counts too many lines rather than too few.
 */
export const roughMeasure: MeasureText = (text, style) => text.length * (style === 'centre' ? 11.5 : style === 'chip' ? 7.6 : 7.4);

/** How many lines `text` takes at `width`, wrapping at spaces like the browser does (a word wider than a line takes as many as it needs). */
export function linesFor(text: string, width: number, style: 'card' | 'centre', measure: MeasureText): number {
    const space = measure(' ', style);
    let lines = 1;
    let line = 0;
    for (const word of text.split(/\s+/).filter(Boolean)) {
        const w = measure(word, style);
        if (line === 0) {
            lines += Math.max(0, Math.ceil(w / width) - 1);
            line = w > width ? w % width : w;
        } else if (line + space + w <= width) {
            line += space + w;
        } else {
            lines += Math.ceil(w / width);
            line = w > width ? w % width : w;
        }
    }
    return lines;
}

/** Padding, border, the AI dot and the gaps beside a card's title, plus 4px to spare. */
const CARD_SIDE_PX = 24 + 2 + 8 + 8 + 8 + 4;

/** A card's height at `width`: its full title wrapped beside the pay chip. */
export function cardHeightFor(title: string, chip: string, width: number, measure: MeasureText = roughMeasure): number {
    const lines = linesFor(title, width - CARD_SIDE_PX - measure(chip, 'chip'), 'card', measure);
    return Math.max(CARD_MIN_H, CARD_BASE_H + lines * CARD_LINE_H);
}

/** Padding, border and the "Open job details" button beside the centre title, plus 4px to spare. */
const CENTRE_SIDE_PX = 48 + 2 + 168 + 4;

/** The centre card's height at `width`: its full title, and the muted absence line when there is one. */
export function centreHeightFor(title: string, width: number, withNote: boolean, measure: MeasureText = roughMeasure): number {
    const lines = linesFor(title, width - CENTRE_SIDE_PX, 'centre', measure);
    return CENTRE_H + Math.max(0, lines - 2) * CENTRE_LINE_H + (withNote ? CENTRE_NOTE_H : 0);
}

// ---------------------------------------------------------------- checks (used by the test)

const inside = (p: Point, r: Rect, pad = 0.5) => p.x > r.x + pad && p.x < r.x + r.w - pad && p.y > r.y + pad && p.y < r.y + r.h - pad;

export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
    const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = o(c, d, a);
    const d2 = o(c, d, b);
    const d3 = o(a, b, c);
    const d4 = o(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Every problem in a layout: overlapping cards or headings, an arrow under either, two crossing arrows, a card off the canvas. */
export function layoutProblems(l: DesktopLayout): string[] {
    const out: string[] = [];
    const rects = [
        { soc: 'centre', rect: l.centre },
        ...l.cards,
        ...l.headings.map((h) => ({ soc: `${h.group} heading`, rect: { x: h.x, y: h.y, w: h.w, h: HEADING_H - 4 } })),
    ];
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i].rect;
        if (r.x < 0 || r.x + r.w > l.width + 0.01 || r.y < 0 || r.y + r.h > l.height + 0.01) out.push(`${rects[i].soc} is off the canvas`);
        for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(r, rects[j].rect)) out.push(`${rects[i].soc} overlaps ${rects[j].soc}`);
    }
    for (const a of l.arrows) {
        for (const { soc, rect } of rects) {
            if (a.points.some((p) => inside(p, rect))) out.push(`arrow to ${a.soc} runs under ${soc}`);
        }
    }
    for (let i = 0; i < l.arrows.length; i++) {
        for (let j = i + 1; j < l.arrows.length; j++) {
            const A = l.arrows[i].points;
            const B = l.arrows[j].points;
            let crossed = false;
            for (let s = 1; s < A.length && !crossed; s++) {
                for (let t = 1; t < B.length; t++) {
                    if (segmentsCross(A[s - 1], A[s], B[t - 1], B[t])) {
                        crossed = true;
                        break;
                    }
                }
            }
            if (crossed) out.push(`arrows to ${l.arrows[i].soc} and ${l.arrows[j].soc} cross`);
        }
    }
    return out;
}
