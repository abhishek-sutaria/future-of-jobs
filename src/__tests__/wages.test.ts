/**
 * Guards src/data/national_wages.json, the national BLS OEWS May 2025 pay
 * shown on the role panel (extracted by scripts/extract_oews_wages.py from
 * data/national_M2025_dl.xlsx). These are published numbers: each must trace
 * to one workbook row and one BLS series, share the employment vintage, and
 * never be split, converted or filled in.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import nationalEmployment from '../data/national_employment.json';
import { DATA_SOURCES } from '../config/constants';
import { MAP_TITLE_TO_SOC } from '../utils/onet';
import { initialJobs } from '../data';
import { jobSourceProvenanceChips, panelSourceList } from '../utils/provenance';
import {
    WAGES_BY_SOC,
    WAGES_META,
    WIDER_BLS_GROUP_TITLES,
    formatAnnualWage,
    formatHourlyWage,
    paySummary,
    payScopeNote,
    wageForTitle,
    wageText,
    type StoredWageMeasure,
    type WageEntry,
    type WageMeasure,
} from '../utils/wages';

const SHOWN: WageMeasure[] = ['annualMedian', 'annualMean', 'hourlyMedian', 'hourlyMean'];
const STORED: StoredWageMeasure[] = [...SHOWN, 'annualPct10', 'annualPct90'];
const DATATYPE: Record<WageMeasure, string> = { annualMedian: '13', annualMean: '04', hourlyMedian: '08', hourlyMean: '03' };
const employment = nationalEmployment as unknown as Record<string, { employment: number }> & {
    _meta: { bls_release: string; api_vintage: string };
};
const socs = [...new Set(Object.values(MAP_TITLE_TO_SOC))];

describe('the source workbook', () => {
    it('still matches the SHA-256 recorded in _meta', () => {
        const bytes = readFileSync(resolve(__dirname, '../../data/national_M2025_dl.xlsx'));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(WAGES_META.sha256);
    });

    it('_meta records the source, method and cap text', () => {
        expect(WAGES_META.source).toBe('BLS OEWS May 2025, national_M2025_dl.xlsx');
        expect(WAGES_META.source_url).toBe('https://www.bls.gov/oes/special-requests/oesm25nat.zip');
        expect(WAGES_META.method).toBe('workbook');
        expect(WAGES_META.topcode.text).toMatch(/equal to or greater than \$[\d,.]+ per hour or \$[\d,]+ per year/);
    });
});

describe('coverage', () => {
    it('has an entry for every SOC in MAP_TITLE_TO_SOC, and nothing else', () => {
        expect(Object.keys(WAGES_BY_SOC).sort()).toEqual([...socs].sort());
    });

    it('every stored measure is a value or an explicit null with a reason', () => {
        for (const [soc, entry] of Object.entries(WAGES_BY_SOC)) {
            for (const m of STORED) {
                if (entry[m] === null) {
                    expect(entry.nullReasons[m], `${soc} ${m} null without a reason`).toMatch(/\S/);
                } else {
                    expect(Number.isFinite(entry[m]), `${soc} ${m}`).toBe(true);
                    expect(entry.nullReasons[m], `${soc} ${m} has a value and a null reason`).toBeUndefined();
                    expect(entry.topcoded[m], `${soc} ${m} has a value and is top-coded`).toBe(false);
                }
            }
        }
    });

    it('every role on the map has a wage entry', () => {
        for (const job of initialJobs) expect(wageForTitle(job.title), job.title).not.toBeNull();
    });
});

describe('traceability', () => {
    it('every SOC cites its workbook row(s) and columns', () => {
        for (const [soc, entry] of Object.entries(WAGES_BY_SOC)) {
            expect(entry.source.sheet).toBe('national_M2025_dl');
            expect(entry.source.rows.length, soc).toBeGreaterThan(0);
            for (const m of STORED) expect(entry.source.columns[m], `${soc} ${m}`).toMatch(/^[A-Z]{1,2}$/);
        }
    });

    it('every shown measure carries a national cross-industry series ID for its own SOC and datatype', () => {
        for (const [soc, entry] of Object.entries(WAGES_BY_SOC)) {
            for (const m of SHOWN) {
                expect(entry.seriesIds[m], `${soc} ${m}`).toMatch(/^OEUN0000000000000\d{6}(03|04|08|13)$/);
                expect(entry.seriesIds[m]).toBe(`OEUN0000000000000${soc.replace('-', '')}${DATATYPE[m]}`);
            }
        }
    });
});

describe('vintage', () => {
    it('matches national_employment.json', () => {
        expect(WAGES_META.bls_release).toBe(employment._meta.bls_release);
        expect(WAGES_META.api_vintage).toBe(employment._meta.api_vintage);
    });

    it('matches DATA_SOURCES.BLS_OES and DATA_SOURCES.BLS_OES_WAGES', () => {
        const year = DATA_SOURCES.BLS_OES.match(/^BLS-OES-(\d{4})$/)?.[1];
        expect(year).toBeDefined();
        expect(WAGES_META.bls_release).toBe(`OEWS May ${year}`);
        expect(WAGES_META.api_vintage).toBe(`${year} A01`);
        expect(DATA_SOURCES.BLS_OES_WAGES).toBe(`BLS-OES-Wages-${year}`);
    });
});

describe('sanity bounds', () => {
    it('reads a positive annual cap from the workbook notes', () => {
        expect(WAGES_META.topcode.annual).toBeGreaterThan(0);
        expect(WAGES_META.topcode.text).toContain(WAGES_META.topcode.annual.toLocaleString('en-US'));
    });

    it('every non-null annual median is between $15,000 and the BLS cap (catches hourly/annual mix-ups)', () => {
        for (const [soc, entry] of Object.entries(WAGES_BY_SOC)) {
            if (entry.annualMedian === null) continue;
            expect(entry.annualMedian, soc).toBeGreaterThanOrEqual(15_000);
            expect(entry.annualMedian, soc).toBeLessThanOrEqual(WAGES_META.topcode.annual);
        }
    });

    it('hourly medians are hourly, not annual', () => {
        for (const [soc, entry] of Object.entries(WAGES_BY_SOC)) {
            if (entry.hourlyMedian === null) continue;
            expect(entry.hourlyMedian, soc).toBeGreaterThan(7);
            expect(entry.hourlyMedian, soc).toBeLessThanOrEqual(WAGES_META.topcode.hourly);
        }
    });
});

describe('titles that share a SOC', () => {
    const bySoc = new Map<string, string[]>();
    for (const [title, soc] of Object.entries(MAP_TITLE_TO_SOC)) bySoc.set(soc, [...(bySoc.get(soc) ?? []), title]);
    const aliasGroups = [...bySoc.values()].filter((titles) => titles.length > 1);

    it('the three known alias pairs are present', () => {
        for (const pair of [
            ['Marketing Manager', 'Brand Manager'],
            ['Wholesale & Retail Buyer', 'Purchasing Agent'],
            ['Business Intelligence Analyst', 'Data Scientist'],
        ]) {
            expect(aliasGroups.some((g) => pair.every((t) => g.includes(t))), pair.join(' / ')).toBe(true);
        }
    });

    it('every alias pair shows identical wages (never split)', () => {
        for (const titles of aliasGroups) {
            const [first, ...rest] = titles.map((t) => wageForTitle(t)!.entry);
            for (const other of rest) expect(other).toEqual(first);
            for (const t of titles) expect(payScopeNote(t), t).toMatch(/^Combined BLS code/);
        }
    });

    it('roles on an "All Other" or broader BLS code say the pay covers the wider group', () => {
        expect([...WIDER_BLS_GROUP_TITLES].sort()).toEqual(['Account Executive', 'IT Project Manager', 'Risk Specialist']);
        for (const t of WIDER_BLS_GROUP_TITLES) {
            expect(MAP_TITLE_TO_SOC[t], t).toBeDefined();
            expect(payScopeNote(t), t).toMatch(/^Pay covers the wider BLS group/);
        }
        expect(payScopeNote('Software Developer')).toBeNull();
    });
});

describe('display', () => {
    const meta = { ...WAGES_META, topcode: { ...WAGES_META.topcode } };
    const entry = (over: Partial<WageEntry>): WageEntry => ({
        occTitle: 'Test',
        source: { sheet: 'national_M2025_dl', rows: [2], oGroups: ['detailed'], columns: {} },
        seriesIds: { annualMedian: '', annualMean: '', hourlyMedian: '', hourlyMean: '' },
        annualMedian: null, annualMean: null, hourlyMedian: null, hourlyMean: null, annualPct10: null, annualPct90: null,
        annualOnly: false,
        hourlyOnly: false,
        topcoded: { annualMedian: false, annualMean: false, hourlyMedian: false, hourlyMean: false, annualPct10: false, annualPct90: false },
        nullReasons: {},
        ...over,
    });

    it('formats annual as whole dollars and hourly with two decimals, no "k"', () => {
        expect(formatAnnualWage(157620)).toBe('$157,620');
        expect(formatHourlyWage(75.8)).toBe('$75.80');
        expect(formatHourlyWage(50)).toBe('$50.00');
    });

    it('headline is the annual median, labelled median, with the annual mean as secondary', () => {
        const s = paySummary(entry({ annualMedian: 50000, annualMean: 60000, hourlyMedian: 24.04, hourlyMean: 28.85 }));
        expect(s.label).toBe('Median annual pay');
        expect(s.label).not.toMatch(/average/i);
        expect(s.headline.text).toBe('$50,000');
        expect(s.mean).toBe('$60,000');
    });

    it('shows a top-coded measure as "≥ cap", with the cap taken from _meta', () => {
        const e = entry({
            topcoded: { annualMedian: true, annualMean: false, hourlyMedian: true, hourlyMean: false, annualPct10: false, annualPct90: false },
            nullReasons: { annualMedian: 'Top-coded', hourlyMedian: 'Top-coded' },
        });
        const cap = WAGES_META.topcode;
        expect(wageText(e, 'annualMedian')).toMatchObject({ text: `≥ ${formatAnnualWage(cap.annual)}`, topcoded: true });
        expect(wageText(e, 'hourlyMedian')).toMatchObject({ text: `≥ ${formatHourlyWage(cap.hourly)}`, topcoded: true });
        // Not hardcoded: a different cap in _meta changes the text.
        meta.topcode.annual = 300000;
        expect(wageText(e, 'annualMedian', meta).text).toBe('≥ $300,000');
    });

    it('the real cap reads "≥ $239,200" for this release', () => {
        expect(formatAnnualWage(WAGES_META.topcode.annual)).toBe('$239,200');
    });

    it('an hourly-only occupation shows the hourly median, never an annualised figure', () => {
        const s = paySummary(entry({ hourlyOnly: true, hourlyMedian: 23.5, hourlyMean: 30.1, nullReasons: { annualMedian: 'x', annualMean: 'x' } }));
        expect(s.label).toBe('Median hourly pay');
        expect(s.headline.text).toBe('$23.50');
        expect(s.mean).toBe('$30.10/hr');
    });

    it('an annual-only occupation shows the annual median and leaves hourly null', () => {
        const e = entry({ annualOnly: true, annualMedian: 64000, annualMean: 66000, nullReasons: { hourlyMedian: 'x', hourlyMean: 'x' } });
        expect(paySummary(e).headline.text).toBe('$64,000');
        expect(wageText(e, 'hourlyMedian').text).toBeNull();
    });

    it('a measure BLS did not publish has no text, only its reason', () => {
        const t = wageText(entry({ nullReasons: { annualMedian: 'Not available: "*"' } }), 'annualMedian');
        expect(t.text).toBeNull();
        expect(t.reason).toBe('Not available: "*"');
    });
});

describe('panel provenance', () => {
    it('every role gets the Pay chip and the wage source in the footer', () => {
        for (const job of initialJobs) {
            expect(jobSourceProvenanceChips(job).map((c) => c.key), job.title).toContain('pay');
            expect(panelSourceList(job)).toContain(DATA_SOURCES.BLS_OES_WAGES);
        }
    });
});
