import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards Ray's Chrome/Android freeze path: the GL loop must pause under the
 * role panel (not only dashboard / US map / tab-hidden / mobile-idle), and
 * phones must drop the second fill light.
 */
describe('Landscape GL pause hardening', () => {
    const src = readFileSync(
        join(__dirname, '../components/Landscape.tsx'),
        'utf8',
    );

    it('pauses the frame loop while a role panel is open', () => {
        expect(src).toMatch(/selectedJob\s*!=\s*null/);
        expect(src).toMatch(/frameloop=\{pauseLoop \? 'never' : 'always'\}/);
    });

    it('wakes the mobile idle timer when selectedJob changes', () => {
        expect(src).toMatch(/bumpInteraction,\s*year,\s*heightMode,\s*mapView,\s*selectedJob/);
    });

    it('skips the second fill light on mobile', () => {
        expect(src).toMatch(/!isMobile\s*&&\s*<pointLight/);
    });
});
