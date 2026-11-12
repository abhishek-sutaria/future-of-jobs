/**
 * After a new deploy, a tab that was already open still asks for the old
 * build's file names (each field's occupations and scores are separate
 * chunks), which no longer exist. The only cure is to load the new build, so
 * the app reloads once by itself instead of showing an error. A reload in the
 * last minute means the files really are unreachable: then it does not reload
 * again, and the caller shows its error with Try again.
 */
const RELOAD_KEY = 'foj_stale_build_reload_at';
const RELOAD_GUARD_MS = 60_000;

/** The browser's words for a module chunk it could not fetch (Chrome, Safari, Firefox). */
export function isChunkLoadError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg);
}

/** Reload once to pick up the new build. False (no reload) if one already ran in the last minute. */
export function reloadForNewBuild(now: number = Date.now()): boolean {
    try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
        if (now - last < RELOAD_GUARD_MS) return false;
        sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
        return false;
    }
    window.location.reload();
    return true;
}
