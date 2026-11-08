/**
 * public/student-guide.html (and the PDF printed from it) must say what the
 * in-app Student Guide says, word for word, so its coverage counts come from
 * the data (studentGuideFeatures → utils/blsScores) and cannot drift.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { FEATURES } from '../components/Modals/studentGuideFeatures';
import { SCORE_COVERAGE } from '../utils/blsScores';

const ROOT = path.resolve(__dirname, '../..');
const doc = new JSDOM(fs.readFileSync(path.join(ROOT, 'public/student-guide.html'), 'utf-8')).window.document;
const cards = [...doc.querySelectorAll('.feature')];

describe('public/student-guide.html', () => {
    it('has every feature card of the in-app guide, in order, word for word', () => {
        expect(cards).toHaveLength(FEATURES.length);
        FEATURES.forEach((f, i) => {
            const card = cards[i];
            expect(card.querySelector('.num')!.textContent).toBe(String(i + 1).padStart(2, '0'));
            expect(card.querySelector('.icon')!.textContent, f.title).toBe(f.emoji);
            expect(card.querySelector('h2')!.textContent).toBe(f.title);
            expect(card.querySelector('p')!.textContent, f.title).toBe(f.description);
            expect(card.querySelector('.tip')!.textContent, f.title).toBe(`Student tip: ${f.tip}`);
            expect(card.classList.contains(`c-${f.color}`), f.title).toBe(true);
        });
    });

    it('states the coverage from the data and says why the rest are not scored', () => {
        const text = doc.body.textContent!;
        expect(text).toContain(SCORE_COVERAGE.sentence);
        if (SCORE_COVERAGE.unscoredReason) expect(text).toContain(SCORE_COVERAGE.unscoredReason);
        expect(text).not.toMatch(/Business & Finance occupation|coming soon/);
    });

    it('is set in Inter, from font files in public/, so the PDF does not fall back to a system font', () => {
        const css = doc.querySelector('style')!.textContent!;
        const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]);
        expect(faces.length).toBeGreaterThan(0);
        for (const face of faces) {
            expect(face).toContain('font-family: "Inter"');
            const url = face.match(/url\("([^"]+)"\)/)![1];
            expect(fs.existsSync(path.join(ROOT, 'public', url)), url).toBe(true);
        }
        expect(css).toMatch(/body\s*{[^}]*font-family: "Inter"/);
    });
});
