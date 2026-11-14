// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForNewBuild } from '../utils/staleBuild';

afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
});

describe('a tab left open across a deploy recovers by itself', () => {
    it('recognises each browser’s missing-chunk error, and nothing else', () => {
        expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/43-DidAuXKr.js'))).toBe(true);
        expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
        expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
        expect(isChunkLoadError(new Error('No occupations file for continent 99'))).toBe(false);
    });

    it('reloads once, then not again within a minute (no reload loop)', () => {
        const reload = vi.fn();
        vi.stubGlobal('location', { ...window.location, reload });
        expect(reloadForNewBuild(1_000_000)).toBe(true);
        expect(reloadForNewBuild(1_030_000)).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(reloadForNewBuild(1_070_000)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(2);
    });
});
