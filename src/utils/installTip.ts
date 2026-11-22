/**
 * When to show the small "Add to Home Screen" tip.
 *
 * iPhone and iPad Safari never offer to install a site, so the app says how,
 * once, until the visitor closes the tip. Android Chrome has its own install
 * prompt from the manifest, so it gets no tip, and neither does a desktop.
 * Already installed (standalone) means no tip either.
 *
 * Pure: the component (components/InstallTip) passes in what the browser reports.
 */

export const INSTALL_TIP_STORAGE_KEY = 'foj_install_tip_dismissed';

/** IntroModal fires this on window when it closes, so the tip never shows under it. */
export const INTRO_CLOSED_EVENT = 'foj:intro-closed';

/** Room the tip needs between the chrome above it and the slider/legend below. */
export const INSTALL_TIP_ROOM_PX = 72;

export interface InstallTipEnv {
    userAgent: string;
    /** navigator.platform: iPadOS Safari reports 'MacIntel' with a desktop user agent. */
    platform: string;
    maxTouchPoints: number;
    /** navigator.standalone (iOS only: true when opened from the home screen). */
    navigatorStandalone?: boolean;
    /** matchMedia('(display-mode: standalone)').matches */
    displayModeStandalone: boolean;
}

/** iPhone, iPod or iPad, including iPadOS Safari's desktop-class user agent. */
export function isAppleTouchDevice(env: Pick<InstallTipEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
    if (/\b(iPhone|iPod|iPad)\b/.test(env.userAgent)) return true;
    return env.platform === 'MacIntel' && env.maxTouchPoints > 1 && /\bMacintosh\b/.test(env.userAgent);
}

/** Other browsers and in-app views on iOS: their menus differ from Safari's, or have no Add to Home Screen. */
const NOT_SAFARI = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|DuckDuckGo|YaBrowser|Brave|FBAN|FBAV|FBIOS|Instagram|LinkedInApp|Line|Twitter|Snapchat|TikTok|MicroMessenger)\b/;

/** Safari itself: carries Safari's own Version/x and Safari/x tokens, and no other browser's. */
export function isSafari(userAgent: string): boolean {
    return /\bVersion\/[\d.]+\b/.test(userAgent) && /\bSafari\/[\d.]+\b/.test(userAgent) && !NOT_SAFARI.test(userAgent);
}

export function isStandalone(env: Pick<InstallTipEnv, 'navigatorStandalone' | 'displayModeStandalone'>): boolean {
    return env.navigatorStandalone === true || env.displayModeStandalone;
}

/** The tip shows only in iPhone/iPad Safari, not yet installed, not yet closed. */
export function shouldOfferInstallTip(env: InstallTipEnv, dismissed: boolean): boolean {
    if (dismissed) return false;
    if (isStandalone(env)) return false;
    return isAppleTouchDevice(env) && isSafari(env.userAgent);
}

/** Reads the live browser. Safe where window or localStorage is missing (tests, private mode). */
export function readInstallTipEnv(): { env: InstallTipEnv; dismissed: boolean } | null {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
    let dismissed = false;
    try {
        dismissed = window.localStorage.getItem(INSTALL_TIP_STORAGE_KEY) != null;
    } catch {
        dismissed = false;
    }
    return {
        env: {
            userAgent: navigator.userAgent ?? '',
            platform: navigator.platform ?? '',
            maxTouchPoints: navigator.maxTouchPoints ?? 0,
            navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
            displayModeStandalone: typeof window.matchMedia === 'function'
                && window.matchMedia('(display-mode: standalone)').matches,
        },
        dismissed,
    };
}

export function rememberInstallTipDismissed(): void {
    try {
        window.localStorage.setItem(INSTALL_TIP_STORAGE_KEY, '1');
    } catch {
        // Private mode with storage off: the tip just comes back next visit.
    }
}
