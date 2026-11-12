import { useEffect } from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { isApplePlatform, schoolShortcutAction } from '../utils/schoolShortcut';

/**
 * Cmd+S (Apple) or Ctrl+S (everything else) shows or hides the hidden IU
 * school picker. Listens on the window in the capture phase, so it works with
 * focus anywhere, the field picker and other controls included, before any
 * control can swallow the key.
 *
 * The browser's own "Save page" is prevented on every page of the app, held
 * repeats too. The picker itself only toggles where it can appear: on the 3D
 * view (field picker on screen), not on the dashboard, and not under an open
 * dialog, which keeps its focus.
 */
export function useSchoolShortcut(): void {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code !== 'KeyS' && e.key.toLowerCase() !== 's') return;
            // Read at the key, not once: cheap, and it follows a changed user agent (device emulation).
            const action = schoolShortcutAction(e, isApplePlatform());
            if (!action) return;
            e.preventDefault();
            if (action !== 'toggle') return;
            const world = useWorldStore.getState();
            if (!world.fieldPickerMounted || useStore.getState().route === 'dashboard') return;
            if (document.querySelector('[aria-modal="true"]')) return;
            world.toggleSchools();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);
}
