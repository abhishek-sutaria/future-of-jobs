import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { Z } from '../config/layers';
import { UI } from '../config/constants';
import { IconShare, IconX } from './ui/Icons';
import {
    INSTALL_TIP_ROOM_PX,
    INTRO_CLOSED_EVENT,
    readInstallTipEnv,
    rememberInstallTipDismissed,
    shouldOfferInstallTip,
} from '../utils/installTip';

/** A moment after the landscape is free, so the tip is not the first thing that moves. */
const SHOW_DELAY_MS = 1500;
/** Gap above the year slider and legend. */
const SLIDER_GAP_PX = 10;

function introDismissed(): boolean {
    try {
        return window.localStorage.getItem(UI.INTRO_STORAGE_KEY) != null;
    } catch {
        return true;
    }
}

/**
 * "Add to Home Screen" tip for iPhone and iPad Safari only (utils/installTip):
 * Safari has no install prompt of its own. Never shown once installed, on a
 * desktop or on Android (Chrome prompts from the manifest), under the intro,
 * on the dashboard, in the map or task views, or over a role panel. It floats
 * just above the year slider and the legend, so it covers no control.
 * Closing it is remembered in localStorage.
 */
export const InstallTip: React.FC = () => {
    const [offered] = useState(() => {
        const read = readInstallTipEnv();
        return read ? shouldOfferInstallTip(read.env, read.dismissed) : false;
    });
    const [introDone, setIntroDone] = useState(() => (offered ? introDismissed() : false));
    const [ready, setReady] = useState(false);
    const [closed, setClosed] = useState(false);
    /** px from the bottom; null before the first measure; 'no-room' on a screen too short (landscape phone). */
    const [bottom, setBottom] = useState<number | 'no-room' | null>(null);

    const route = useStore((s) => s.route);
    const mapView = useStore((s) => s.mapView);
    const panelOpen = useStore((s) => s.selectedJob != null);
    const occupationOpen = useWorldStore((s) => s.selectedOccupationSoc != null);

    useEffect(() => {
        if (!offered || introDone) return;
        const onClosed = () => setIntroDone(true);
        window.addEventListener(INTRO_CLOSED_EVENT, onClosed);
        return () => window.removeEventListener(INTRO_CLOSED_EVENT, onClosed);
    }, [offered, introDone]);

    useEffect(() => {
        if (!offered || !introDone) return;
        const t = setTimeout(() => setReady(true), SHOW_DELAY_MS);
        return () => clearTimeout(t);
    }, [offered, introDone]);

    // Only over the 3D landscape, where it has the year slider and legend to sit above.
    const visible = offered && introDone && ready && !closed
        && route !== 'dashboard' && mapView === 'globe' && !panelOpen && !occupationOpen;

    // Sit just above the year slider and the legend beside it, measured: their
    // heights change with width.
    useEffect(() => {
        if (!visible) return;
        const measure = () => {
            const box = (sel: string) => {
                const r = document.querySelector(sel)?.getBoundingClientRect();
                return r && r.height > 0 ? r : null;
            };
            const below = [box('[data-tour="tour-slider"]'), box('[data-legend]')].filter((r) => r != null);
            if (!below.length) return setBottom('no-room');
            const floor = Math.min(...below.map((r) => r.top));
            const ceiling = Math.max(box('header')?.bottom ?? 0, box('[data-world-bar]')?.bottom ?? 0);
            setBottom(floor - ceiling < INSTALL_TIP_ROOM_PX + SLIDER_GAP_PX
                ? 'no-room'
                : Math.round(window.innerHeight - floor + SLIDER_GAP_PX));
        };
        measure();
        const t = setTimeout(measure, 400);
        window.addEventListener('resize', measure);
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', measure);
        };
    }, [visible]);

    if (!visible || bottom == null || bottom === 'no-room') return null;

    const close = () => {
        rememberInstallTipDismissed();
        setClosed(true);
    };

    return (
        <aside
            aria-label="Install this app"
            data-testid="install-tip"
            className="absolute left-1/2 -translate-x-1/2 w-[min(22rem,calc(100%-2rem))] pointer-events-auto"
            style={{
                zIndex: Z.timeBar,
                bottom,
            }}
        >
            <div className="flex items-center gap-2 pl-3.5 pr-1 py-1 rounded-xl border border-cyan-400/30 bg-gray-900/90 backdrop-blur-xl shadow-lg shadow-black/40 text-[13px] leading-snug text-gray-200">
                <img src="/icons/icon-192.png" alt="" width={28} height={28} className="w-7 h-7 rounded-md shrink-0" />
                <p className="flex-1 min-w-0 py-1.5">
                    Get it as an app: tap Share{' '}
                    <IconShare size={14} className="inline-block align-[-2px] text-cyan-300" aria-label="(the Share button)" role="img" />
                    {' '}then <span className="font-semibold text-white">Add to Home Screen</span>.
                </p>
                <button
                    type="button"
                    onClick={close}
                    aria-label="Close install tip"
                    className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                    <IconX size={16} />
                </button>
            </div>
        </aside>
    );
};
