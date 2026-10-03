import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards Ray's July "STALE" / quota-badge complaint: the role panel must not
 * surface Bundled-data or live-BLS-age chrome that implies published OES
 * employment is a degraded fallback.
 */
describe('role panel has no STALE / Bundled-data badges', () => {
    const panelSrc = readFileSync(
        join(__dirname, '../components/JobDetailPanel.tsx'),
        'utf8',
    );

    it('does not render a Bundled data or STALE badge', () => {
        expect(panelSrc).not.toMatch(/Bundled data/);
        expect(panelSrc).not.toMatch(/>\s*STALE\s*</);
        expect(panelSrc).not.toMatch(/job\.isStale/);
        expect(panelSrc).not.toMatch(/blsSource === 'cache'/);
    });

    it('still exposes the OES provenance chip path', () => {
        expect(panelSrc).toMatch(/jobSourceProvenanceChips|ProvenanceBadge/);
    });
});
