// @vitest-environment jsdom
/**
 * The hidden IU school filter's ways in: Cmd+S on Apple platforms and Ctrl+S
 * elsewhere (Shift/Alt and held repeats aside, the browser's Save always
 * prevented), and a long press on the field picker on a touch screen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createLongPress, isApplePlatform, LONG_PRESS_MS, schoolShortcutAction, type ShortcutKey } from '../utils/schoolShortcut';
import { useSchoolShortcut } from '../hooks/useSchoolShortcut';
import { useWorldStore } from '../worldStore';
import { useStore } from '../store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const key = (over: Partial<ShortcutKey>): ShortcutKey => ({
    key: 's', code: 'KeyS', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, ...over,
});

describe('platform', () => {
    it('reads User-Agent Client Hints first', () => {
        expect(isApplePlatform({ userAgentData: { platform: 'macOS' }, userAgent: 'Windows NT', platform: 'Win32' })).toBe(true);
        expect(isApplePlatform({ userAgentData: { platform: 'Windows' }, userAgent: 'Macintosh', platform: 'MacIntel' })).toBe(false);
        expect(isApplePlatform({ userAgentData: { platform: 'Linux' } })).toBe(false);
    });

    it('falls back to the user agent (iPadOS reports a Mac), and only then to navigator.platform', () => {
        expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari' })).toBe(true);
        expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(true);
        expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome' })).toBe(false);
        expect(isApplePlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox' })).toBe(false);
        expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
        expect(isApplePlatform({ platform: 'Win32' })).toBe(false);
        expect(isApplePlatform(undefined)).toBe(false);
    });
});

describe('the shortcut', () => {
    it('is Cmd+S on a Mac and Ctrl+S elsewhere, not the other way round', () => {
        expect(schoolShortcutAction(key({ metaKey: true }), true)).toBe('toggle');
        expect(schoolShortcutAction(key({ ctrlKey: true }), true)).toBeNull();
        expect(schoolShortcutAction(key({ ctrlKey: true }), false)).toBe('toggle');
        expect(schoolShortcutAction(key({ metaKey: true }), false)).toBeNull();
        expect(schoolShortcutAction(key({ metaKey: true, ctrlKey: true }), true)).toBeNull();
        expect(schoolShortcutAction(key({}), true)).toBeNull();
    });

    it('leaves Shift or Alt with S to the browser', () => {
        expect(schoolShortcutAction(key({ metaKey: true, shiftKey: true, key: 'S' }), true)).toBeNull();
        expect(schoolShortcutAction(key({ metaKey: true, altKey: true, key: 'ß' }), true)).toBeNull();
        expect(schoolShortcutAction(key({ ctrlKey: true, shiftKey: true, key: 'S' }), false)).toBeNull();
        expect(schoolShortcutAction(key({ ctrlKey: true, altKey: true }), false)).toBeNull();
    });

    it('prevents Save on a held-down repeat but does not toggle again', () => {
        expect(schoolShortcutAction(key({ metaKey: true, repeat: true }), true)).toBe('block');
        expect(schoolShortcutAction(key({ ctrlKey: true, repeat: true }), false)).toBe('block');
    });

    it('finds S with Caps Lock on, and by position on a layout with no Latin letters', () => {
        expect(schoolShortcutAction(key({ metaKey: true, key: 'S' }), true)).toBe('toggle');
        expect(schoolShortcutAction(key({ ctrlKey: true, key: 'ы' }), false)).toBe('toggle');
        // A Latin layout where the S position types another letter: that letter decides.
        expect(schoolShortcutAction(key({ ctrlKey: true, key: 'o' }), false)).toBeNull();
        expect(schoolShortcutAction(key({ ctrlKey: true, key: 'p', code: 'KeyP' }), false)).toBeNull();
    });
});

describe('long press', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const touch = { pointerType: 'touch', clientX: 10, clientY: 10 };

    it('fires after LONG_PRESS_MS of a finger resting, and swallows the click that ends it once', () => {
        const onLongPress = vi.fn();
        const lp = createLongPress({ onLongPress });
        lp.down(touch);
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
        expect(onLongPress).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onLongPress).toHaveBeenCalledTimes(1);
        lp.up();
        expect(lp.consumeClick()).toBe(true);
        expect(lp.consumeClick()).toBe(false);
    });

    it('a normal tap is a click as before', () => {
        const onLongPress = vi.fn();
        const lp = createLongPress({ onLongPress });
        lp.down(touch);
        vi.advanceTimersByTime(150);
        lp.up();
        vi.advanceTimersByTime(1000);
        expect(onLongPress).not.toHaveBeenCalled();
        expect(lp.consumeClick()).toBe(false);
    });

    it('a finger that moves is scrolling, not pressing; a mouse never long-presses', () => {
        const onLongPress = vi.fn();
        const lp = createLongPress({ onLongPress });
        lp.down(touch);
        lp.move({ pointerType: 'touch', clientX: 14, clientY: 13 });
        expect(lp.pending).toBe(true);
        lp.move({ pointerType: 'touch', clientX: 30, clientY: 10 });
        expect(lp.pending).toBe(false);
        vi.advanceTimersByTime(1000);
        lp.down({ pointerType: 'mouse', clientX: 0, clientY: 0 });
        vi.advanceTimersByTime(1000);
        expect(onLongPress).not.toHaveBeenCalled();
        lp.down({ pointerType: 'pen', clientX: 0, clientY: 0 });
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(onLongPress).toHaveBeenCalledTimes(1);
    });
});

describe('useSchoolShortcut', () => {
    let root: Root;
    let container: HTMLDivElement;
    const Host = () => {
        useSchoolShortcut();
        return <input aria-label="anything" />;
    };
    const setPlatform = (platform: string) => Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform } });
    const fire = (init: KeyboardEventInit, target: EventTarget) => {
        const e = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true, cancelable: true, ...init });
        act(() => { target.dispatchEvent(e); });
        return e;
    };

    beforeEach(async () => {
        setPlatform('macOS');
        useWorldStore.setState({ schoolsRevealed: false, school: null, fieldPickerMounted: true });
        useStore.setState({ route: 'map' as never });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<Host />));
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.body.innerHTML = '';
        delete (navigator as unknown as { userAgentData?: unknown }).userAgentData;
    });

    it('toggles from inside a control and always prevents the browser\'s Save', () => {
        const input = container.querySelector('input')!;
        input.focus();
        const e = fire({ metaKey: true }, input);
        expect(e.defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(true);
        expect(fire({ metaKey: true, repeat: true }, input).defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(true);
        expect(fire({ metaKey: true }, input).defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
    });

    it('uses Ctrl on Windows and leaves Cmd alone there', () => {
        setPlatform('Windows');
        expect(fire({ metaKey: true }, document.body).defaultPrevented).toBe(false);
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
        expect(fire({ ctrlKey: true }, document.body).defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(true);
    });

    it('ignores Shift and Alt: not prevented, nothing toggles', () => {
        expect(fire({ metaKey: true, shiftKey: true, key: 'S' }, document.body).defaultPrevented).toBe(false);
        expect(fire({ metaKey: true, altKey: true }, document.body).defaultPrevented).toBe(false);
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
    });

    it('still blocks Save, but does not open, off the 3D view, on the dashboard or under a dialog', () => {
        useWorldStore.setState({ fieldPickerMounted: false });
        expect(fire({ metaKey: true }, document.body).defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
        useWorldStore.setState({ fieldPickerMounted: true });
        useStore.setState({ route: 'dashboard' as never });
        expect(fire({ metaKey: true }, document.body).defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
        useStore.setState({ route: 'map' as never });
        const dialog = document.createElement('div');
        dialog.setAttribute('aria-modal', 'true');
        document.body.appendChild(dialog);
        expect(fire({ metaKey: true }, document.body).defaultPrevented).toBe(true);
        expect(useWorldStore.getState().schoolsRevealed).toBe(false);
    });

    it('hiding drops the school', () => {
        useWorldStore.setState({ schoolsRevealed: true, school: { id: 'kelley', name: 'Kelley School of Business', socs: new Set(['13-2011']) } });
        fire({ metaKey: true }, document.body);
        expect(useWorldStore.getState()).toMatchObject({ schoolsRevealed: false, school: null });
    });
});
