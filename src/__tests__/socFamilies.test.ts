/**
 * The five job families on the map are the BLS high-level aggregation:
 * 2018 SOC User Guide, Table 6 (page 17), read here from the committed PDF
 * (data/bls_soc_2018_user_guide.pdf) with pdf.js, not from memory.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { familyOf, SOC_FAMILIES } from '../config/socFamilies';
import { INDEX_CONTINENTS } from '../utils/occupationIndex';
import { layoutFamilies, layoutRegions, rectArea, WORLD_BOUNDS, type Rect } from '../utils/worldLayout';

const PDF = resolve(__dirname, '../../data/bls_soc_2018_user_guide.pdf');
const PDF_SHA256 = '53729e652bd04f16a0d27648fed3d1f3008a4dfc3d6bae353804f50de577dc83';

async function pageText(page: number): Promise<string> {
    const doc = await getDocument({ data: new Uint8Array(readFileSync(PDF)), useWorkerFetch: false, isEvalSupported: false, verbosity: 0 }).promise;
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    await doc.destroy();
    // pdf.js splits words across runs; one space between tokens, en dash kept.
    return text.replace(/\s+/g, ' ');
}

/** Table 6 rows: "<n> <first>–<last> <title>" or "<n> <code> <title>". */
function table6(text: string) {
    const start = text.indexOf('Table 6. High-level aggregation to 6 groups, 2018 SOC');
    expect(start, 'Table 6 heading on page 17').toBeGreaterThanOrEqual(0);
    const body = text.slice(start);
    const rows: { id: number; first: string; last: string; title: string }[] = [];
    const re = /(\d)\s+(\d{2})(?:\s*[–-]\s*(\d{2}))?\s+([A-Z][A-Za-z,\s]+?Occupations)/g;
    for (let m = re.exec(body); m && rows.length < 6; m = re.exec(body)) {
        rows.push({ id: Number(m[1]), first: m[2], last: m[3] ?? m[2], title: m[4].replace(/\s+/g, ' ').trim() });
    }
    return rows;
}

describe('the five BLS job families', () => {
    it('reads the committed BLS SOC User Guide', () => {
        expect(createHash('sha256').update(readFileSync(PDF)).digest('hex')).toBe(PDF_SHA256);
    });

    it('match Table 6 of the 2018 SOC User Guide exactly', async () => {
        const rows = table6(await pageText(17));
        expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
        // Family 6 is Military Specific (55), which OEWS and EP do not publish; it is not a field.
        expect(rows[5]).toMatchObject({ first: '55', last: '55', title: 'Military Specific Occupations' });
        expect(SOC_FAMILIES.map((f) => ({ id: f.id, first: f.majors[0], last: f.majors[1], title: f.title }))).toEqual(rows.slice(0, 5));
    });

    it('puts Healthcare Practitioners (29) in Management, Business, Science, and Arts', () => {
        expect(familyOf('29').title).toBe('Management, Business, Science, and Arts Occupations');
        expect(familyOf('31').title).toBe('Service Occupations');
    });

    it('covers every one of the 22 fields, each in exactly one family', () => {
        const byFamily = new Map<number, string[]>();
        for (const c of INDEX_CONTINENTS) byFamily.set(familyOf(c.code).id, [...(byFamily.get(familyOf(c.code).id) ?? []), c.code]);
        expect(Object.fromEntries(byFamily)).toEqual({
            1: ['11', '13', '15', '17', '19', '21', '23', '25', '27', '29'],
            2: ['31', '33', '35', '37', '39'],
            3: ['41', '43'],
            4: ['45', '47', '49'],
            5: ['51', '53'],
        });
    });
});

describe('two-level layout', () => {
    const families = layoutFamilies();
    const regions = layoutRegions();
    const total = INDEX_CONTINENTS.reduce((a, c) => a + c.ep.employment2025, 0);
    const inside = (r: Rect, b: Rect) => r.x0 >= b.x0 - 1e-9 && r.x1 <= b.x1 + 1e-9 && r.z0 >= b.z0 - 1e-9 && r.z1 <= b.z1 + 1e-9;

    it('sizes each family block by the sum of its fields\' EP 2025 summary rows', () => {
        expect(families).toHaveLength(5);
        for (const f of families) {
            const sum = INDEX_CONTINENTS.filter((c) => familyOf(c.code).id === f.family.id).reduce((a, c) => a + c.ep.employment2025, 0);
            expect(f.ep2025).toBe(sum);
            expect(rectArea(f.rect) / rectArea(WORLD_BOUNDS)).toBeCloseTo(sum / total, 12);
        }
    });

    it('lays each family\'s fields inside its block, in SOC order, filling it exactly', () => {
        for (const f of families) {
            const own = regions.filter((r) => r.family === f.family.id);
            expect(own.map((r) => r.code)).toEqual(f.codes);
            for (const r of own) expect(inside(r.rect, f.rect), r.code).toBe(true);
            expect(own.reduce((a, r) => a + rectArea(r.rect), 0)).toBeCloseTo(rectArea(f.rect), 9);
        }
    });
});
