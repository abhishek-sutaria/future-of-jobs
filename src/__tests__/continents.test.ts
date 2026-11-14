/**
 * The 22 regions on the 3D map. Region SIZE is data: each region's area must
 * be its share of the BLS Employment Projections 2025 summary row for its SOC
 * major group, read here straight from the committed EP workbook (SheetJS,
 * independent of scripts/build_occupations.py). Position and shape are layout.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { INDEX_CONTINENTS, OCCUPATION_INDEX } from '../utils/occupationIndex';
import { layoutRegions, rectArea, WORLD_BOUNDS, buildWorldLayout, orderedTreemap, type Rect } from '../utils/worldLayout';
import { getRoleEntries } from '../utils/roles';
import { useStore } from '../store';

const ROOT = resolve(__dirname, '../..');

// Raw EP Table 1.2 rows, keyed by matrix code, for "Summary" rows only.
const wb = XLSX.read(readFileSync(resolve(ROOT, 'data/bls_ep_occupation_2025_35.xlsx')), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Table 1.2'], { header: 1, raw: true });
const header = rows[1] as string[];
const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`EP header "${name}" missing`);
    return i;
};
const C = {
    title: col('2025 National Employment Matrix title'),
    code: col('2025 National Employment Matrix code'),
    type: col('Occupation type'),
    e2025: col('Employment, 2025'),
    e2035: col('Employment, 2035'),
    change: col('Employment change, numeric, 2025–35'),
    pct: col('Employment change, percent, 2025–35'),
};
const summary = new Map<string, unknown[]>();
for (const r of rows.slice(2)) {
    if (r[C.type] === 'Summary') summary.set(String(r[C.code]), r);
}

/** BLS thousands → persons, in decimal digits (no floating-point multiply). */
function persons(thousands: unknown): number {
    const [whole, frac = ''] = String(thousands).split('.');
    if (frac.length > 3) throw new Error(`${thousands} thousand is not a whole number of persons`);
    return Number(whole + frac.padEnd(3, '0'));
}

describe('region sizes are the EP summary rows', () => {
    it('stores each continent\'s EP summary row exactly as published', () => {
        expect(INDEX_CONTINENTS).toHaveLength(22);
        for (const c of INDEX_CONTINENTS) {
            const r = summary.get(c.soc);
            expect(r, c.soc).toBeTruthy();
            expect(c.ep.title).toBe(String(r![C.title]).trim());
            expect(c.ep.employment2025, c.soc).toBe(persons(r![C.e2025]));
            expect(c.ep.employment2035, c.soc).toBe(persons(r![C.e2035]));
            expect(c.ep.numericChange, c.soc).toBe(persons(r![C.change]));
            expect(c.ep.percentChange, c.soc).toBe(r![C.pct]);
        }
    });

    it('stores every minor group\'s EP summary row exactly as published', () => {
        let n = 0;
        for (const c of INDEX_CONTINENTS) {
            for (const g of c.minorGroups) {
                const r = summary.get(g.soc);
                expect(r, g.soc).toBeTruthy();
                expect(g.ep.employment2025, g.soc).toBe(persons(r![C.e2025]));
                expect(g.ep.employment2035, g.soc).toBe(persons(r![C.e2035]));
                expect(g.ep.numericChange, g.soc).toBe(persons(r![C.change]));
                expect(g.ep.percentChange, g.soc).toBe(r![C.pct]);
                n++;
            }
        }
        expect(n).toBe(94);
    });

    it('sizes every region by that row, so area shares equal employment shares', () => {
        const regions = layoutRegions();
        const totalEp = INDEX_CONTINENTS.reduce((a, c) => a + c.ep.employment2025, 0);
        const totalArea = rectArea(WORLD_BOUNDS);
        expect(regions.map((r) => r.code)).toEqual(INDEX_CONTINENTS.map((c) => c.code));
        regions.forEach((r, i) => {
            const raw = persons(summary.get(INDEX_CONTINENTS[i].soc)![C.e2025]);
            expect(r.ep2025).toBe(raw);
            expect(rectArea(r.rect) / totalArea).toBeCloseTo(raw / totalEp, 12);
        });
    });

    it('uses the published rows, which add up to the published all-occupations total', () => {
        const total = summary.get('00-0000')!;
        const sum = INDEX_CONTINENTS.reduce((a, c) => a + c.ep.employment2025, 0);
        expect(sum).toBe(persons(total[C.e2025]));
        expect(OCCUPATION_INDEX._meta.sources.ep.allOccupations.employment2025).toBe(persons(total[C.e2025]));
    });
});

describe('region layout', () => {
    const regions = layoutRegions();
    const inside = (r: Rect, b: Rect) => r.x0 >= b.x0 - 1e-9 && r.x1 <= b.x1 + 1e-9 && r.z0 >= b.z0 - 1e-9 && r.z1 <= b.z1 + 1e-9;
    const overlap = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 1e-9;

    it('tiles the world exactly: no gaps, no overlaps', () => {
        for (const r of regions) expect(inside(r.rect, WORLD_BOUNDS), r.code).toBe(true);
        for (let i = 0; i < regions.length; i++) {
            for (let j = i + 1; j < regions.length; j++) {
                expect(overlap(regions[i].rect, regions[j].rect), `${regions[i].code}/${regions[j].code}`).toBe(false);
            }
        }
        expect(regions.reduce((a, r) => a + rectArea(r.rect), 0)).toBeCloseTo(rectArea(WORLD_BOUNDS), 9);
    });

    it('keeps every region readable (no slivers)', () => {
        for (const r of regions) {
            const w = r.rect.x1 - r.rect.x0;
            const d = r.rect.z1 - r.rect.z0;
            expect(Math.max(w / d, d / w), r.code).toBeLessThan(4);
        }
    });

    it('is deterministic and keeps the order it is given', () => {
        expect(layoutRegions()).toEqual(regions);
        const rects = orderedTreemap([5, 1, 1, 3], { x0: 0, z0: 0, x1: 10, z1: 10 });
        expect(rects.map(rectArea).map((a) => Math.round(a * 1e9) / 1e9)).toEqual([50, 10, 10, 30]);
    });

    it('puts every role\'s peak inside its own region', () => {
        const entries = getRoleEntries(useStore.getState().jobs);
        const world = buildWorldLayout(entries);
        expect(world.peakByKey.size).toBe(entries.length);
        for (const e of entries) {
            const p = world.peakByKey.get(e.key)!;
            const r = world.regionByCode.get(e.continent)!.rect;
            expect(p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1, e.title).toBe(true);
        }
    });
});
