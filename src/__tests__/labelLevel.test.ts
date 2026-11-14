import { describe, it, expect } from 'vitest';
import { BROAD_LABELS, decideLabels, FAMILY_LEVEL_LABELS, FIELD_ARRIVAL_ZOOM, FIELD_LABELS, FIELD_LABEL_ZOOM, FIELD_LABEL_ZOOM_BUFFER, FIELD_LEVEL_LABELS, labelsAt } from '../utils/labelLevel';

const IN = FIELD_LABEL_ZOOM + FIELD_LABEL_ZOOM_BUFFER;
const OUT = FIELD_LABEL_ZOOM - FIELD_LABEL_ZOOM_BUFFER;

describe('decideLabels', () => {
    it('shows only the family names at the default view', () => {
        expect(decideLabels(1, BROAD_LABELS)).toEqual({ level: 'broad', families: true, fields: false, jobs: false });
    });

    it('stays broad when zoomed out past the default view', () => {
        expect(decideLabels(0.4, BROAD_LABELS)).toBe(BROAD_LABELS);
    });

    it('shows the field names, and allows job labels, once zoomed in', () => {
        expect(decideLabels(2, BROAD_LABELS)).toEqual({ level: 'fields', families: false, fields: true, jobs: true });
    });

    it('never shows families and fields together, at any zoom from either side', () => {
        for (let z = 0.3; z < 6; z += 0.01) {
            for (const from of [BROAD_LABELS, FIELD_LABELS]) {
                const d = decideLabels(z, from);
                expect(d.families).not.toBe(d.fields);
                if (d.families) expect(d.jobs).toBe(false);
            }
        }
    });

    it('holds the current set everywhere inside the buffer', () => {
        for (const z of [OUT + 0.001, FIELD_LABEL_ZOOM, IN - 0.001]) {
            expect(decideLabels(z, BROAD_LABELS)).toBe(BROAD_LABELS);
            expect(decideLabels(z, FIELD_LABELS)).toBe(FIELD_LABELS);
        }
    });

    it('switches in at the top of the buffer and out at the bottom, not before', () => {
        expect(decideLabels(IN, BROAD_LABELS)).toBe(FIELD_LABELS);
        expect(decideLabels(IN - 0.001, BROAD_LABELS)).toBe(BROAD_LABELS);
        expect(decideLabels(OUT, FIELD_LABELS)).toBe(BROAD_LABELS);
        expect(decideLabels(OUT + 0.001, FIELD_LABELS)).toBe(FIELD_LABELS);
    });

    it('does not flicker when zoom wobbles around the threshold', () => {
        let d = decideLabels(IN, BROAD_LABELS);
        for (const z of [FIELD_LABEL_ZOOM, FIELD_LABEL_ZOOM - 0.01, FIELD_LABEL_ZOOM + 0.01, FIELD_LABEL_ZOOM]) {
            d = decideLabels(z, d);
            expect(d).toBe(FIELD_LABELS);
        }
    });

    it('returns to family names only when zooming back out', () => {
        const zoomed = decideLabels(3, BROAD_LABELS);
        const back = decideLabels(1, zoomed);
        expect(back).toBe(BROAD_LABELS);
        expect(back.fields).toBe(false);
        expect(back.jobs).toBe(false);
    });

    it('keeps the current set rather than trusting a bad zoom', () => {
        expect(decideLabels(NaN, FIELD_LABELS)).toBe(FIELD_LABELS);
        expect(decideLabels(Infinity, BROAD_LABELS)).toBe(BROAD_LABELS);
    });

    it('lands flights clear of the buffer', () => {
        expect(FIELD_ARRIVAL_ZOOM).toBeGreaterThan(IN);
    });
});

describe('labelsAt', () => {
    it('follows the zoom at the world, exactly as decideLabels does', () => {
        for (const z of [0.5, 1, OUT, FIELD_LABEL_ZOOM, IN, 2, 4]) {
            for (const from of [BROAD_LABELS, FIELD_LABELS]) expect(labelsAt('world', z, from)).toBe(decideLabels(z, from));
        }
    });

    it('never looks at the zoom inside a family or a field, at any zoom', () => {
        for (let z = 0.2; z < 6; z += 0.05) {
            expect(labelsAt('family', z, BROAD_LABELS)).toBe(FAMILY_LEVEL_LABELS);
            expect(labelsAt('field', z, FIELD_LABELS)).toBe(FIELD_LEVEL_LABELS);
        }
    });

    it('shows field names and no job labels in a family, and both in a field', () => {
        expect(FAMILY_LEVEL_LABELS).toMatchObject({ families: false, fields: true, jobs: false });
        expect(FIELD_LEVEL_LABELS).toMatchObject({ families: false, fields: true, jobs: true });
    });

    it('does not carry a family or field set back to the world: inside the buffer it falls back to the broad set', () => {
        expect(labelsAt('world', FIELD_LABEL_ZOOM, FAMILY_LEVEL_LABELS)).toBe(BROAD_LABELS);
        expect(labelsAt('world', FIELD_LABEL_ZOOM, FIELD_LEVEL_LABELS)).toBe(BROAD_LABELS);
    });
});
