import { describe, it, expect } from 'vitest';
import { clampLabelCenterX, clampLabelCenterY } from '../utils/labelLayout';

describe('clampLabelCenterX', () => {
    it('leaves a label that already fits exactly where it is', () => {
        expect(clampLabelCenterX(200, 60, 393)).toBe(200);
    });

    it('pushes a label off the left edge back into view', () => {
        // the real case from production: centre 50, half-width 65 -> left: -15
        expect(clampLabelCenterX(50, 65, 393)).toBe(69);
    });

    it('pushes a label off the right edge back into view', () => {
        expect(clampLabelCenterX(380, 65, 393)).toBe(324);
    });

    it('keeps the whole box inside for every position across the viewport', () => {
        const vw = 393, half = 70, margin = 4;
        for (let x = -200; x <= 600; x += 7) {
            const c = clampLabelCenterX(x, half, vw, margin);
            expect(c - half).toBeGreaterThanOrEqual(margin - 0.001);
            expect(c + half).toBeLessThanOrEqual(vw - margin + 0.001);
        }
    });

    it('centres a label too wide to fit rather than pinning it to an edge', () => {
        expect(clampLabelCenterX(10, 300, 393)).toBe(196.5);
    });
});

describe('clampLabelCenterY', () => {
    it('keeps a label clear of the top and bottom edges', () => {
        expect(clampLabelCenterY(2, 10, 852)).toBe(14);
        expect(clampLabelCenterY(900, 10, 852)).toBe(838);
    });

    it('centres when taller than the viewport', () => {
        expect(clampLabelCenterY(0, 500, 852)).toBe(426);
    });
});
