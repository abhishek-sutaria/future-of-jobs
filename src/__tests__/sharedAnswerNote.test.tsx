/**
 * The note under a saved shared answer (components/SharedAnswerNote) shows
 * the date the answer was saved: after an old answer is replaced, the new
 * row's created_at, which the gateway returns as shared.savedAt.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SharedAnswerNote } from '../components/SharedAnswerNote';

describe('SharedAnswerNote', () => {
    it('a saved answer (hit or just made) names the day it was saved', () => {
        const hit = renderToStaticMarkup(<SharedAnswerNote shared={{ hit: true, saved: true, savedAt: '2026-11-22T12:00:00.000Z' }} />);
        expect(hit).toContain('on November 22, 2026 and saved');
        expect(hit).toContain('data-hit="true"');
        // A replaced answer: a fresh Claude answer, saved with a new date.
        const replaced = renderToStaticMarkup(<SharedAnswerNote shared={{ hit: false, saved: true, savedAt: '2027-02-21T12:00:00.000Z' }} />);
        expect(replaced).toContain('on February 21, 2027 and saved');
        expect(replaced).toContain('data-hit="false"');
    });

    it('Supabase’s own time format (+00:00) reads the same', () => {
        const html = renderToStaticMarkup(<SharedAnswerNote shared={{ hit: true, saved: true, savedAt: '2026-11-22T12:00:00.123456+00:00' }} />);
        expect(html).toContain('on November 22, 2026 and saved');
    });

    it('not saved: says the next visitor gets a new answer', () => {
        const html = renderToStaticMarkup(<SharedAnswerNote shared={{ hit: false, saved: false, savedAt: null }} />);
        expect(html).toContain('Saving is not set up on this server');
    });
});
