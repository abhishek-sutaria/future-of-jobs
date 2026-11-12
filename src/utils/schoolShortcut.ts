/**
 * The hidden IU school filter's two ways in, as pure logic (components/
 * SchoolPicker and hooks/useSchoolShortcut wire them up):
 *
 *   - Keyboard: Cmd+S on Apple platforms, Ctrl+S everywhere else. The browser's
 *     own "Save page" is always prevented on this app, held-down repeats
 *     included; Shift or Alt with S is someone else's shortcut and left alone.
 *   - Touch: a long press (LONG_PRESS_MS) on the field picker. A short tap still
 *     opens the picker; the click that ends a long press is swallowed.
 */

/** Long-press length on the field picker. */
export const LONG_PRESS_MS = 600;
/** A finger that moves further than this is scrolling or dragging, not pressing. */
export const LONG_PRESS_SLOP_PX = 10;

interface NavigatorLike {
    userAgent?: string;
    platform?: string;
    userAgentData?: { platform?: string } | null;
}

const APPLE = /mac|iphone|ipad|ipod/i;

/**
 * Apple keyboard (Cmd) or not (Ctrl). User-Agent Client Hints first, where the
 * browser has them; then the user agent string (iPadOS Safari reports itself as
 * a Mac, which is right here: its keyboard has Cmd); the deprecated
 * navigator.platform only when neither says anything.
 */
export function isApplePlatform(nav: NavigatorLike | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
    if (!nav) return false;
    const hint = nav.userAgentData?.platform;
    if (hint) return APPLE.test(hint) || /^macos$/i.test(hint);
    if (nav.userAgent) return APPLE.test(nav.userAgent);
    return APPLE.test(nav.platform ?? '');
}

export interface ShortcutKey {
    key: string;
    code?: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    repeat: boolean;
}

/**
 * What a keydown means for the school filter:
 *   'toggle' prevent the browser's Save and show or hide the filter
 *   'block'  prevent the browser's Save only (a held-down key repeating)
 *   null     not ours: leave it to the browser and the page
 */
export function schoolShortcutAction(e: ShortcutKey, apple: boolean): 'toggle' | 'block' | null {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // The letter S on this layout; on a layout without Latin letters, the key where S is.
    const isS = key === 's' || (!/^[a-z]$/.test(key) && e.code === 'KeyS');
    if (!isS) return null;
    const command = apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!command || e.shiftKey || e.altKey) return null;
    return e.repeat ? 'block' : 'toggle';
}

export interface LongPressOptions {
    onLongPress: () => void;
    delayMs?: number;
    slopPx?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (id: unknown) => void;
}

export interface PressPoint {
    pointerType: string;
    clientX: number;
    clientY: number;
    pointerId?: number;
}

/**
 * A long press on a touch screen or pen. Mouse presses never count: a mouse
 * user has a keyboard. Feed it the button's pointer events; ask
 * `consumeClick()` in the click handler, which says true (once) for the click
 * that ends a long press, so the picker does not also open.
 */
export function createLongPress(opts: LongPressOptions) {
    const delay = opts.delayMs ?? LONG_PRESS_MS;
    const slop = opts.slopPx ?? LONG_PRESS_SLOP_PX;
    const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimer = opts.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    let timer: unknown = null;
    let start: { x: number; y: number } | null = null;
    let fired = false;

    const cancel = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
        start = null;
    };

    return {
        down(e: PressPoint): void {
            cancel();
            fired = false;
            if (e.pointerType === 'mouse') return;
            start = { x: e.clientX, y: e.clientY };
            timer = setTimer(() => {
                timer = null;
                start = null;
                fired = true;
                opts.onLongPress();
            }, delay);
        },
        move(e: PressPoint): void {
            if (!start) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > slop) cancel();
        },
        up(): void {
            cancel();
        },
        cancel,
        /** True once if the press that just ended was a long press. */
        consumeClick(): boolean {
            const was = fired;
            fired = false;
            return was;
        },
        get pending(): boolean {
            return timer !== null;
        },
    };
}
