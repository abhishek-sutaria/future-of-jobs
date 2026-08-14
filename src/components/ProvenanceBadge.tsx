import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '../config/layers';
import { provenanceLabel, type DataProvenance } from '../utils/provenance';

interface ProvenanceBadgeProps {
    label: string;
    provenance: DataProvenance;
}

/**
 * Source chip with a real hover popup (portal + fixed position).
 * Native `title` tooltips are unreliable here (often only a ? cursor).
 */
export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({ label, provenance }) => {
    const tipId = useId();
    const btnRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number; flipAbove: boolean } | null>(null);

    const explanation = provenanceLabel(provenance);

    const place = () => {
        const el = btnRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const width = 280;
        const left = Math.min(
            Math.max(12, r.left + r.width / 2 - width / 2),
            window.innerWidth - width - 12,
        );
        const spaceBelow = window.innerHeight - r.bottom;
        const flipAbove = spaceBelow < 96;
        const top = flipAbove ? r.top - 8 : r.bottom + 8;
        setPos({ top, left, flipAbove });
    };

    const show = () => {
        place();
        setOpen(true);
    };
    const hide = () => setOpen(false);

    useEffect(() => {
        if (!open) return;
        const onScrollOrResize = () => place();
        window.addEventListener('scroll', onScrollOrResize, true);
        window.addEventListener('resize', onScrollOrResize);
        return () => {
            window.removeEventListener('scroll', onScrollOrResize, true);
            window.removeEventListener('resize', onScrollOrResize);
        };
    }, [open]);

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className="px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-white/[0.06] text-gray-400 border border-white/[0.08] hover:bg-white/[0.1] hover:text-gray-200 transition-colors"
                aria-describedby={open ? tipId : undefined}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
            >
                {label}
            </button>
            {open && pos && createPortal(
                <div
                    id={tipId}
                    role="tooltip"
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        left: pos.left,
                        width: 280,
                        zIndex: Z.toast,
                        transform: pos.flipAbove ? 'translateY(-100%)' : undefined,
                    }}
                    className="pointer-events-none rounded-lg border border-cyan-400/40 bg-gray-950 px-3 py-2.5 text-[12px] leading-snug text-gray-100 shadow-2xl shadow-black/60"
                >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300 mb-1">
                        {label}
                    </div>
                    {explanation}
                </div>,
                document.body,
            )}
        </>
    );
};
