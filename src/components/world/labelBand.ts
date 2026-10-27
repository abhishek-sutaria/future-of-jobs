import { useEffect, useRef } from 'react';
import type { LabelBand } from '../../utils/labelLayout';

/**
 * The vertical band labels may use: below the header / search, beside or
 * below the fields bar (a block over the left of the screen only), and above
 * the year slider, in CSS pixels. Re-measured whenever `key`
 * changes, on resize, and whenever that chrome re-wraps.
 */
export function useLabelSafeBand(key: string) {
    const band = useRef<LabelBand>({ top: 4, bottom: 4 });
    useEffect(() => {
        const measure = () => {
            const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
            const header = box('header');
            const search = box('[data-tour="tour-search"]');
            const bar = box('[data-world-bar]');
            const slider = box('[data-tour="tour-slider"]');
            // The header and search run the width of the screen; the fields
            // bar (and the notes under it) only covers its left side.
            const top = Math.max(header?.bottom ?? 0, search?.bottom ?? 0, 4);
            const bottom = slider ? Math.max(window.innerHeight - slider.top, 4) : 4;
            const blocks = bar && bar.bottom > top ? [{ left: bar.left - 6, right: bar.right + 6, bottom: bar.bottom + 6 }] : [];
            band.current = { top: top + 6, bottom: bottom + 6, blocks };
        };
        measure();
        // The chrome mounts after the canvas and re-wraps as buttons come and
        // go, so watch it rather than only the window.
        const t = setTimeout(measure, 1200);
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        for (const sel of ['header', '[data-world-bar]', '[data-tour="tour-slider"]']) {
            const el = document.querySelector(sel);
            if (el && observer) observer.observe(el);
        }
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            clearTimeout(t);
            observer?.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, [key]);
    return band;
}
