import React, { useEffect, useRef, useState } from 'react';
import { useWorldStore } from '../worldStore';
import { useStore } from '../store';
import { Z } from '../config/layers';
import { YEAR_MAX, YEAR_MIN } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { INDEX_CONTINENTS, INDEX_CONTINENT_BY_CODE } from '../utils/occupationIndex';
import { formatCount, formatGrowth, formatWorkersShort, growthColor } from '../utils/roleFormat';
import { kelleyCountByContinent } from '../utils/roles';
import { IconChevronDown, IconLayers } from './ui/Icons';

/**
 * Navigation for the 22-continent world, under the header on the 3D view:
 * the field picker (every region by name, so none depends on a tap target),
 * the "All fields" breadcrumb when zoomed in, and the Kelley roles toggle.
 */
export const WorldBar: React.FC = () => {
    const focused = useWorldStore((s) => s.focusedContinent);
    const focusContinent = useWorldStore((s) => s.focusContinent);
    const kelleyOnly = useWorldStore((s) => s.kelleyOnly);
    const setKelleyOnly = useWorldStore((s) => s.setKelleyOnly);
    const jobs = useStore((s) => s.jobs);
    const kelleyCounts = React.useMemo(() => kelleyCountByContinent(jobs), [jobs]);
    const [open, setOpen] = useState(false);
    const [top, setTop] = useState(112);
    const rootRef = useRef<HTMLDivElement>(null);

    // Sit just under the header, measured rather than hard-coded: it wraps to
    // different heights across widths.
    useEffect(() => {
        const measure = () => {
            const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 100;
            setTop(Math.round(header) + 4);
        };
        measure();
        // The header grows when it wraps (e.g. "Reset view" appearing on a
        // phone), which no window event reports.
        const header = document.querySelector('header');
        const observer = typeof ResizeObserver !== 'undefined' && header ? new ResizeObserver(measure) : null;
        if (observer && header) observer.observe(header);
        window.addEventListener('resize', measure);
        window.addEventListener('orientationchange', measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('orientationchange', measure);
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const region = focused ? INDEX_CONTINENT_BY_CODE.get(focused) : undefined;
    const kelleyHere = focused ? kelleyCounts.get(focused) ?? 0 : 0;

    const pick = (code: string | null) => {
        setOpen(false);
        focusContinent(code);
    };

    return (
        <div
            ref={rootRef}
            data-world-bar
            data-tour="tour-fields"
            className="absolute left-4 md:left-8 right-4 md:right-auto flex flex-col gap-1.5 pointer-events-none md:max-w-[34rem]"
            style={{ top, zIndex: Z.base }}
        >
            <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
                {region && (
                    <button
                        type="button"
                        onClick={() => pick(null)}
                        className="h-9 [@media(pointer:coarse)]:h-11 px-3 rounded-lg border border-white/[0.1] bg-gray-900/70 backdrop-blur-sm text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors"
                    >
                        ← All fields
                    </button>
                )}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-haspopup="listbox"
                        title={region ? region.title : 'Pick one of the 22 fields (BLS major occupation groups)'}
                        className="h-9 [@media(pointer:coarse)]:h-11 pl-3 pr-2.5 rounded-lg border border-cyan-400/30 bg-gray-900/70 backdrop-blur-sm text-xs font-semibold text-cyan-100 hover:bg-cyan-500/10 transition-colors flex items-center gap-1.5"
                    >
                        <IconLayers size={13} className="text-cyan-400" />
                        {region ? CONTINENT_DISPLAY_NAMES[region.code] : 'All 22 fields'}
                        <IconChevronDown size={13} className="text-gray-400" />
                    </button>
                    {open && (
                        <ul
                            role="listbox"
                            aria-label="Fields"
                            className="absolute left-0 mt-1.5 w-[min(20rem,calc(100vw-2rem))] max-h-[min(60vh,26rem)] overflow-y-auto custom-scrollbar rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur-xl shadow-2xl py-1"
                            style={{ zIndex: Z.sidebar }}
                        >
                            <li>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={!focused}
                                    onClick={() => pick(null)}
                                    className="w-full text-left px-3 py-2.5 text-xs text-gray-300 hover:bg-white/[0.06]"
                                >
                                    All fields <span className="text-gray-500">· whole map</span>
                                </button>
                            </li>
                            {INDEX_CONTINENTS.map((c) => (
                                <li key={c.code}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={focused === c.code}
                                        onClick={() => pick(c.code)}
                                        title={c.title}
                                        className={`w-full text-left px-3 py-2 min-h-[40px] flex items-center justify-between gap-3 hover:bg-white/[0.06] ${focused === c.code ? 'bg-cyan-500/10' : ''}`}
                                    >
                                        <span className="text-[13px] text-gray-200 truncate">
                                            {CONTINENT_DISPLAY_NAMES[c.code]}
                                            {(kelleyCounts.get(c.code) ?? 0) > 0 && (
                                                <span className="ml-1.5 text-[10px] text-amber-300/90" title="Has Kelley roles with AI scores">●</span>
                                            )}
                                        </span>
                                        <span className="text-[11px] text-gray-500 tabular-nums shrink-0">{formatWorkersShort(c.ep.employment2025)} workers</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setKelleyOnly(!kelleyOnly)}
                    aria-pressed={kelleyOnly}
                    title="Highlight only the 50 Kelley business roles, the ones with published AI scores"
                    className={`h-9 [@media(pointer:coarse)]:h-11 px-3 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-2 backdrop-blur-sm ${
                        kelleyOnly
                            ? 'border-amber-400/50 bg-amber-500/15 text-amber-100'
                            : 'border-white/[0.1] bg-gray-900/70 text-gray-300 hover:text-white hover:bg-white/[0.08]'
                    }`}
                >
                    <span
                        aria-hidden="true"
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] leading-none ${kelleyOnly ? 'bg-amber-400 border-amber-400 text-gray-900' : 'border-gray-500'}`}
                    >
                        {kelleyOnly ? '✓' : ''}
                    </span>
                    Kelley roles
                </button>
            </div>

            {region && (
                <p className="pointer-events-auto self-start text-[11px] text-gray-400 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-1 leading-snug max-w-full">
                    <span className="text-gray-200 font-medium tabular-nums" title={`All workers in ${YEAR_MIN}, including self-employed. BLS Employment Projections.`}>
                        {formatCount(region.ep.employment2025)} workers
                    </span>
                    <span className="tabular-nums" style={{ color: growthColor(region.ep.percentChange) }}> · {formatGrowth(region.ep.percentChange)} by {YEAR_MAX}</span>
                    <span> · {region.occupationCount} occupations</span>
                    {kelleyOnly && kelleyHere === 0 && <span className="text-amber-300/90"> · no Kelley roles in this field</span>}
                </p>
            )}
            {!region && kelleyOnly && (
                <p className="pointer-events-auto self-start text-[11px] text-amber-100/80 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-1">
                    The 50 Kelley business roles, with their published AI scores.
                </p>
            )}
        </div>
    );
};
