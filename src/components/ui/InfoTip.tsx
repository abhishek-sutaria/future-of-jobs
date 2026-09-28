import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '../../config/layers';
import { IconInfo } from './Icons';

interface InfoTipProps {
    /** Short explanation shown in the popup. */
    children: React.ReactNode;
    /** Optional accessible label for the trigger. */
    label?: string;
    /** Trigger size in px (default 10 to match prior panel icons). */
    size?: number;
}

/**
 * Hover + tap info popup. Native title / CSS group-hover tips are unreachable
 * on touch; this mirrors ProvenanceBadge's viaTouch toggle pattern.
 */
export const InfoTip: React.FC<InfoTipProps> = ({
    children,
    label = 'More information',
    size = 10,
}) => {
    const tipId = useId();
    const btnRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number; flipAbove: boolean } | null>(null);
    const viaTouch = useRef(false);

    const place = () => {
        const el = btnRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const width = 224;
        const left = Math.min(
            Math.max(12, r.left + r.width / 2 - width / 2),
            window.innerWidth - width - 12,
        );
        const spaceBelow = window.innerHeight - r.bottom;
        const flipAbove = spaceBelow < 96;
        setPos({ top: flipAbove ? r.top - 8 : r.bottom + 8, left, flipAbove });
    };

    const show = () => { place(); setOpen(true); };
    const hide = () => setOpen(false);

    useEffect(() => {
        if (!open) return;
        const onScrollOrResize = () => place();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
        const onPointer = (e: PointerEvent) => {
            if (btnRef.current?.contains(e.target as Node)) return;
            hide();
        };
        window.addEventListener('scroll', onScrollOrResize, true);
        window.addEventListener('resize', onScrollOrResize);
        window.addEventListener('keydown', onKey);
        const id = window.setTimeout(() => {
            window.addEventListener('pointerdown', onPointer, true);
        }, 0);
        return () => {
            window.clearTimeout(id);
            window.removeEventListener('scroll', onScrollOrResize, true);
            window.removeEventListener('resize', onScrollOrResize);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('pointerdown', onPointer, true);
        };
    }, [open]);

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                aria-label={label}
                aria-describedby={open ? tipId : undefined}
                className="inline-flex items-center justify-center text-gray-500 hover:text-cyan-400 transition-colors min-w-[28px] min-h-[28px] -m-1"
                onPointerDown={(e) => { viaTouch.current = e.pointerType !== 'mouse'; }}
                onMouseEnter={() => { if (!viaTouch.current) show(); }}
                onMouseLeave={() => { if (!viaTouch.current) hide(); }}
                onFocus={() => { if (!viaTouch.current) show(); }}
                onBlur={() => { if (!viaTouch.current) hide(); }}
                onClick={() => {
                    if (viaTouch.current) setOpen((o) => { if (!o) place(); return !o; });
                }}
            >
                <IconInfo size={size} />
            </button>
            {open && pos && createPortal(
                <div
                    id={tipId}
                    role="tooltip"
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        left: pos.left,
                        width: 224,
                        zIndex: Z.modalTop,
                        transform: pos.flipAbove ? 'translateY(-100%)' : undefined,
                    }}
                    className="pointer-events-none rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-[9px] leading-tight text-gray-300 text-center shadow-2xl shadow-black/60"
                >
                    {children}
                </div>,
                document.body,
            )}
        </>
    );
};
