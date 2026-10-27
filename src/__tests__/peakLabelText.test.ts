/**
 * Every peak label shows its occupation's full title (professor's review:
 * "Home Health and Personal Care …" was cut off). The chip wraps instead of
 * truncating, so no class or style on the title, or around it, may clip it.
 * Line counts need a browser, so they were measured in Chrome (Oct 2026) by
 * rendering this component for all 833 peaks: at most 2 lines at 1470px
 * (widest chip 391px), at most 3 at 390px (widest 250px), none overflowing.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PeakLabel } from '../components/world/WorldMarkers';
import { buildWorldScene } from '../components/world/worldScene';
import { useStore } from '../store';

const CLIPPING = /(^|\s)(truncate|text-ellipsis|text-clip|line-clamp-\d+|whitespace-nowrap|max-md:whitespace-nowrap|max-md:truncate)(\s|$)/;

describe('peak labels show the whole title', () => {
    const scene = buildWorldScene(useStore.getState().jobs);

    it.each([false, true])('on every peak (hover card open: %s)', (expanded) => {
        expect(scene.peaks.length).toBeGreaterThan(800);
        for (const peak of scene.peaks) {
            const html = renderToStaticMarkup(createElement(PeakLabel, { peak, expanded, year: 2025 }));
            const doc = new JSDOM(html).window.document;
            const title = [...doc.querySelectorAll('span')].find((s) => s.textContent === peak.entry.title);
            expect(title, peak.entry.title).toBeTruthy();
            for (let el: Element | null = title!; el; el = el.parentElement) {
                expect(el.getAttribute('class') ?? '', `${peak.entry.title}: <${el.tagName}>`).not.toMatch(CLIPPING);
                expect(el.getAttribute('style') ?? '').not.toMatch(/text-overflow|line-clamp/);
            }
        }
    });

    it('includes the titles the review found cut off', () => {
        const titles = new Set(scene.peaks.map((p) => p.entry.title));
        for (const t of ['Home Health and Personal Care Aides', 'Medical and Health Services Managers', 'Farmers, Ranchers, and Other Agricultural Managers']) {
            expect(titles.has(t), t).toBe(true);
        }
    });
});
