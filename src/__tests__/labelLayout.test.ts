import { describe, it, expect } from 'vitest';
import {
    HIDDEN_LABEL_POSITION,
    isHiddenLabelPosition,
    resolveLabelPosition,
    layoutLabels,
    labelsCollide,
    type LabelCandidate,
    type LabelBand,
} from '../utils/labelLayout';

const BAND: LabelBand = { top: 180, bottom: 140 };

describe('resolveLabelPosition', () => {
    it('centres a label on an anchor that already fits', () => {
        expect(resolveLabelPosition(200, 400, 40, 10, 393, 852, BAND)).toEqual([200, 400]);
    });

    it('nudges a near-edge anchor just enough to keep the box on screen', () => {
        // anchor at x=30, halfW=40 → left would be -10; margin=4 so centre moves to 44
        const [cx] = resolveLabelPosition(30, 400, 40, 10, 393, 852, BAND);
        expect(cx).toBe(44);
        expect(Math.abs(cx - 30)).toBeLessThanOrEqual(40);
    });

    it('hides when the anchor sits under the header band', () => {
        expect(resolveLabelPosition(200, 100, 40, 10, 393, 852, BAND)).toEqual(HIDDEN_LABEL_POSITION);
    });

    it('hides when the anchor sits under the year slider', () => {
        expect(resolveLabelPosition(200, 800, 40, 10, 393, 852, BAND)).toEqual(HIDDEN_LABEL_POSITION);
    });

    it('hides when the anchor is off the left edge', () => {
        expect(resolveLabelPosition(-10, 400, 40, 10, 393, 852, BAND)).toEqual(HIDDEN_LABEL_POSITION);
    });

    it('never detaches: an in-band anchor that fits always keeps the tip inside the box', () => {
        // Math of the half-size cap: if the anchor is inside the band and the
        // label is smaller than the band, the required edge nudge is always
        // ≤ half-size, so resolveLabelPosition never has to choose between
        // pinning and hiding — it places. (Hiding on detach is layoutLabels'
        // job, when collision forces a nudge past the cap.)
        const pos = resolveLabelPosition(200, BAND.top + 1, 40, 50, 393, 852, BAND);
        expect(isHiddenLabelPosition(pos)).toBe(false);
        expect(Math.abs(pos[0] - 200)).toBeLessThanOrEqual(40);
        expect(Math.abs(pos[1] - (BAND.top + 1))).toBeLessThanOrEqual(50);
    });

    it('hides when the label is taller than the usable band', () => {
        // usable height = 852 - 180 - 140 = 532; halfH=300 → 600 > 532
        expect(resolveLabelPosition(200, 400, 40, 300, 393, 852, BAND)).toEqual(HIDDEN_LABEL_POSITION);
    });

    it('keeps the anchor inside the label box for every in-band anchor', () => {
        const halfW = 50, halfH = 12;
        for (let x = BAND.top; x < 393; x += 17) {
            for (let y = BAND.top; y < 852 - BAND.bottom; y += 23) {
                const pos = resolveLabelPosition(x, y, halfW, halfH, 393, 852, BAND);
                if (isHiddenLabelPosition(pos)) continue;
                expect(Math.abs(pos[0] - x)).toBeLessThanOrEqual(halfW + 0.001);
                expect(Math.abs(pos[1] - y)).toBeLessThanOrEqual(halfH + 0.001);
            }
        }
    });

    it('reports hidden positions via isHiddenLabelPosition', () => {
        expect(isHiddenLabelPosition(HIDDEN_LABEL_POSITION)).toBe(true);
        expect(isHiddenLabelPosition([200, 400])).toBe(false);
    });
});

describe('labelsCollide', () => {
    it('detects overlapping centres within half-extents + pad', () => {
        expect(labelsCollide(100, 100, 40, 10, 120, 100, 40, 10, 2)).toBe(true);
        expect(labelsCollide(100, 100, 40, 10, 200, 100, 40, 10, 2)).toBe(false);
    });
});

describe('layoutLabels', () => {
    const out = () => new Map<string, [number, number]>();
    const offsets = () => new Map<string, [number, number]>();

    function item(
        id: string,
        ax: number,
        ay: number,
        hw = 40,
        hh = 10,
        inFront = true,
    ): LabelCandidate {
        return { id, anchorX: ax, anchorY: ay, halfWidth: hw, halfHeight: hh, inFront };
    }

    it('places a lone label on its anchor', () => {
        const placements = out();
        layoutLabels([item('a', 200, 400)], 393, 852, BAND, placements, offsets());
        expect(placements.get('a')).toEqual([200, 400]);
    });

    it('hides a label whose anchor is behind the camera', () => {
        const placements = out();
        layoutLabels([item('a', 200, 400, 40, 10, false)], 393, 852, BAND, placements, offsets());
        expect(isHiddenLabelPosition(placements.get('a')!)).toBe(true);
    });

    it('hides a label whose anchor is under the header', () => {
        const placements = out();
        layoutLabels([item('a', 200, 50)], 393, 852, BAND, placements, offsets());
        expect(isHiddenLabelPosition(placements.get('a')!)).toBe(true);
    });

    it('nudges a second label so it does not cover the first', () => {
        // Partly overlapping on X: centre placement collides, but a halfW nudge clears.
        const placements = out();
        layoutLabels(
            [item('a', 200, 400), item('b', 250, 400)],
            393,
            852,
            BAND,
            placements,
            offsets(),
            2,
        );
        const a = placements.get('a')!;
        const b = placements.get('b')!;
        expect(isHiddenLabelPosition(a)).toBe(false);
        expect(isHiddenLabelPosition(b)).toBe(false);
        expect(labelsCollide(a[0], a[1], 40, 10, b[0], b[1], 40, 10, 2)).toBe(false);
        // Anchor stays inside each box.
        expect(Math.abs(a[0] - 200)).toBeLessThanOrEqual(40);
        expect(Math.abs(b[0] - 250)).toBeLessThanOrEqual(40);
    });

    it('hides a label when every nudge collides with an earlier one', () => {
        // Fill the 9-nudge neighbourhood around a shared anchor with earlier labels
        // that already claim those spots. A late arrival at the same anchor has nowhere to go.
        const placements = out();
        const first = item('keep', 200, 400, 40, 10);
        // Pre-seed by placing many labels that carpet the area around (200,400)
        const blockers: LabelCandidate[] = [first];
        for (let i = 0; i < 20; i++) {
            blockers.push(item(`b${i}`, 200 + (i % 5) * 8, 400 + Math.floor(i / 5) * 6, 40, 10));
        }
        blockers.push(item('late', 200, 400, 40, 10));
        layoutLabels(blockers, 393, 852, BAND, placements, offsets(), 2);
        // At least the first stays; the late one must be hidden once the neighbourhood is full.
        expect(isHiddenLabelPosition(placements.get('keep')!)).toBe(false);
        expect(isHiddenLabelPosition(placements.get('late')!)).toBe(true);
    });

    it('keeps every placed label\'s anchor inside its box', () => {
        const placements = out();
        const items = [
            item('a', 200, 400),
            item('b', 210, 410),
            item('c', 180, 390),
            item('d', 250, 500),
            item('e', 100, 300),
        ];
        layoutLabels(items, 393, 852, BAND, placements, offsets());
        for (const it of items) {
            const pos = placements.get(it.id)!;
            if (isHiddenLabelPosition(pos)) continue;
            expect(Math.abs(pos[0] - it.anchorX)).toBeLessThanOrEqual(it.halfWidth + 0.001);
            expect(Math.abs(pos[1] - it.anchorY)).toBeLessThanOrEqual(it.halfHeight + 0.001);
        }
    });

    it('never lets two placed labels overlap', () => {
        const placements = out();
        const items: LabelCandidate[] = [];
        for (let i = 0; i < 30; i++) {
            items.push(item(`j${i}`, 120 + (i % 6) * 30, 250 + Math.floor(i / 6) * 40));
        }
        layoutLabels(items, 393, 852, BAND, placements, offsets(), 2);
        const visible = items
            .map((it) => ({ it, pos: placements.get(it.id)! }))
            .filter(({ pos }) => !isHiddenLabelPosition(pos));
        for (let i = 0; i < visible.length; i++) {
            for (let j = i + 1; j < visible.length; j++) {
                const a = visible[i], b = visible[j];
                expect(
                    labelsCollide(
                        a.pos[0], a.pos[1], a.it.halfWidth, a.it.halfHeight,
                        b.pos[0], b.pos[1], b.it.halfWidth, b.it.halfHeight,
                        2,
                    ),
                ).toBe(false);
            }
        }
    });

    it('reuses the previous offset when it is still legal (hysteresis)', () => {
        const placements = out();
        const offs = offsets();
        layoutLabels([item('a', 200, 400), item('b', 250, 400)], 393, 852, BAND, placements, offs, 2);
        const firstB = placements.get('b')!;
        expect(isHiddenLabelPosition(firstB)).toBe(false);
        // Same inputs again — b must stay put rather than picking another equally-valid nudge.
        layoutLabels([item('a', 200, 400), item('b', 250, 400)], 393, 852, BAND, placements, offs, 2);
        expect(placements.get('b')).toEqual(firstB);
    });
});
