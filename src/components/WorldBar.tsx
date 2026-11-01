import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorldStore } from '../worldStore';
import { useStore } from '../store';
import { Z } from '../config/layers';
import { YEAR_MAX, YEAR_MIN } from '../config/constants';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';
import { SOC_FAMILIES, familyOf } from '../config/socFamilies';
import { INDEX_CONTINENTS, INDEX_CONTINENT_BY_CODE } from '../utils/occupationIndex';
import { formatCount, formatGrowth, formatWorkersShort, growthColor } from '../utils/roleFormat';
import { kelleyCountByContinent } from '../utils/roles';
import { breadcrumbs, escapeGoesUp, familySummary, levelAnnouncement, levelKind, type Crumb, type WorldLevel } from '../utils/worldLevel';
import { IconChevronDown, IconLayers } from './ui/Icons';

const CHROME_BUTTON = 'h-9 [@media(pointer:coarse)]:h-11 rounded-lg border bg-gray-900/70 backdrop-blur-sm text-xs font-semibold transition-colors';

/**
 * Where you are and the way back up: Back, then each level above this one as a
 * button and the current one as plain text. When the whole trail does not fit
 * (a long family name on a phone) it is Back and the current name. Whether it
 * fits is measured on an invisible copy, so the answer holds at any width.
 */
export const Breadcrumb: React.FC<{ crumbs: Crumb[]; onGo: (level: WorldLevel) => void; onBack: () => void }> = ({ crumbs, onGo, onBack }) => {
    const navRef = useRef<HTMLElement>(null);
    const backRef = useRef<HTMLButtonElement>(null);
    const fullRef = useRef<HTMLSpanElement>(null);
    const [compact, setCompact] = useState(false);
    const trail = crumbs.map((c) => c.label).join('|');

    useLayoutEffect(() => {
        const nav = navRef.current;
        if (!nav) return;
        const measure = () => {
            const room = nav.clientWidth - (backRef.current?.offsetWidth ?? 0) - 8;
            // No width at all means it is not laid out, which says nothing about the fit.
            setCompact(nav.clientWidth > 0 && (fullRef.current?.offsetWidth ?? 0) > room);
        };
        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(nav);
        return () => observer?.disconnect();
    }, [trail]);

    const current = crumbs[crumbs.length - 1];
    return (
        <nav ref={navRef} data-breadcrumb aria-label="Map level" className="relative pointer-events-auto flex items-center gap-2 w-full min-w-0">
            <button
                ref={backRef}
                type="button"
                data-world-back
                onClick={onBack}
                className={`${CHROME_BUTTON} shrink-0 px-3 border-white/[0.1] text-gray-200 hover:text-white hover:bg-white/[0.08]`}
            >
                ← Back
            </button>
            <span ref={fullRef} aria-hidden="true" className="absolute invisible whitespace-nowrap text-xs px-1">
                {crumbs.map((c) => c.label).join(' › ')}
            </span>
            {compact ? (
                <span aria-current="location" className="min-w-0 text-xs font-semibold leading-tight text-cyan-100">{current.label}</span>
            ) : (
                <ol className="flex items-center min-w-0 whitespace-nowrap text-xs">
                    {crumbs.map((c, i) => (
                        <li key={c.key} className="flex items-center">
                            {i > 0 && <span aria-hidden="true" className="px-0.5 text-gray-500">›</span>}
                            {c.current ? (
                                <span aria-current="location" className="px-1 font-semibold text-cyan-100">{c.label}</span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onGo(c.level)}
                                    className="px-1 [@media(pointer:coarse)]:min-h-11 rounded text-gray-300 hover:text-white underline-offset-2 hover:underline transition-colors"
                                >
                                    {c.label}
                                </button>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </nav>
    );
};

/**
 * Navigation for the 22-continent world, under the header on the 3D view: the
 * breadcrumb and Back inside a family or field, the field picker (every field
 * by name, so none depends on a tap target), the Kelley roles toggle and the
 * level's info line. The picker is on screen at every level, so it is also how
 * keyboard and screen reader users reach all 22 fields: their names on the map
 * come and go. Esc is handled here too, as one more way up.
 */
export const WorldBar: React.FC = () => {
    const focused = useWorldStore((s) => s.focusedContinent);
    const focusedFamily = useWorldStore((s) => s.focusedFamily);
    const showingFields = useWorldStore((s) => s.labels.fields);
    const focusContinent = useWorldStore((s) => s.focusContinent);
    const goToLevel = useWorldStore((s) => s.goToLevel);
    const goUp = useWorldStore((s) => s.goUp);
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

    // Esc goes up one level. Capture, so it runs before a panel or modal
    // closes itself on this same key and only then looks like nothing was open.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.repeat) return;
            const main = useStore.getState();
            const world = useWorldStore.getState();
            if (main.route === 'dashboard' || (e.target as Element | null)?.closest?.('input, textarea, select')) return;
            const layers = {
                panel: !!main.selectedJob || !!world.selectedOccupationSoc,
                modal: !!document.querySelector('[aria-modal="true"]'),
                picker: open,
            };
            if (escapeGoesUp(world, layers)) world.goUp();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);

    // A crumb turns into text, and Back goes at the world: a keyboard user on
    // either carries on from Back or the picker, not from the top of the page.
    // The store tells us before React removes the button.
    const refocus = useRef(false);
    useEffect(() => useWorldStore.subscribe((s, prev) => {
        if (s.focusedFamily === prev.focusedFamily && s.focusedContinent === prev.focusedContinent) return;
        refocus.current = !!document.activeElement?.closest('[data-breadcrumb]');
    }), []);
    useLayoutEffect(() => {
        if (!refocus.current) return;
        refocus.current = false;
        if (document.activeElement && document.activeElement !== document.body) return;
        rootRef.current?.querySelector<HTMLElement>('[data-world-back], [data-field-picker]')?.focus();
    }, [focused, focusedFamily]);

    const level: WorldLevel = { focusedFamily, focusedContinent: focused };
    const kind = levelKind(level);
    const region = focused ? INDEX_CONTINENT_BY_CODE.get(focused) : undefined;
    const family = kind === 'family' ? SOC_FAMILIES.find((f) => f.id === focusedFamily) : undefined;
    const familyInfo = family ? familySummary(family.id) : null;
    const kelleyHere = focused
        ? kelleyCounts.get(focused) ?? 0
        : [...kelleyCounts].reduce((sum, [code, n]) => sum + (familyOf(code).id === focusedFamily ? n : 0), 0);

    const pick = (code: string | null) => {
        setOpen(false);
        focusContinent(code);
    };

    return (
        <div
            ref={rootRef}
            data-world-bar
            data-tour="tour-fields"
            className="absolute left-4 md:left-8 right-4 md:right-auto flex flex-col gap-1.5 pointer-events-none md:max-w-[66rem]"
            // Open, the list must lie over the year slider, which outranks the bar.
            style={{ top, zIndex: open ? Z.sidebar : Z.base }}
        >
            <p className="sr-only" aria-live="polite">{levelAnnouncement(level, showingFields)}</p>
            {kind !== 'world' && <Breadcrumb crumbs={breadcrumbs(level)} onGo={goToLevel} onBack={goUp} />}
            <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
                <div className="relative">
                    <button
                        type="button"
                        data-field-picker
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        aria-haspopup="listbox"
                        title="Pick one of the 22 fields (BLS major occupation groups)"
                        className="h-9 [@media(pointer:coarse)]:h-11 pl-3 pr-2.5 rounded-lg border border-cyan-400/30 bg-gray-900/70 backdrop-blur-sm text-xs font-semibold text-cyan-100 hover:bg-cyan-500/10 transition-colors flex items-center gap-1.5"
                    >
                        <IconLayers size={13} className="text-cyan-400" />
                        All 22 fields
                        <IconChevronDown size={13} className="text-gray-400" />
                    </button>
                    {open && (
                        <ul
                            role="listbox"
                            aria-label="Fields"
                            className="absolute left-0 mt-1.5 w-[min(20rem,calc(100vw-2rem))] max-h-[min(60vh,26rem)] overflow-y-auto custom-scrollbar rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur-xl shadow-2xl py-1"
                        >
                            <li>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={kind === 'world'}
                                    onClick={() => pick(null)}
                                    className="w-full text-left px-3 py-2.5 text-xs text-gray-300 hover:bg-white/[0.06]"
                                >
                                    All families <span className="text-gray-500">· whole map</span>
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
                {region && (
                    <p className="text-[11px] text-gray-400 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-1 leading-snug max-w-full">
                        <span className="text-gray-200 font-medium tabular-nums" title={`All workers in ${YEAR_MIN}, including self-employed. BLS Employment Projections.`}>
                            {formatCount(region.ep.employment2025)} workers
                        </span>
                        <span className="tabular-nums" style={{ color: growthColor(region.ep.percentChange) }}> · {formatGrowth(region.ep.percentChange)} by {YEAR_MAX}</span>
                        <span> · {region.occupationCount} occupations</span>
                        {kelleyOnly && kelleyHere === 0 && <span className="text-amber-300/90"> · no Kelley roles in this field</span>}
                    </p>
                )}
                {region && (
                    <p
                        className="text-[10px] text-gray-500 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-0.5"
                        title="Inside a field, its largest occupation in the slider year is drawn full height and every other hill is in proportion to it. The whole-map view uses one national scale."
                        data-testid="field-scale-note"
                    >
                        Peak heights scaled within this field.
                    </p>
                )}
                {family && familyInfo && (
                    <p data-testid="family-info" className="text-[11px] text-gray-400 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-1 leading-snug max-w-full">
                        <span className="text-gray-200 font-medium" title={family.title}>{family.shortName}</span>
                        <span className="text-gray-200 font-medium tabular-nums" title={`All workers in ${YEAR_MIN}, including self-employed. BLS Employment Projections.`}> · {formatCount(familyInfo.workers)} workers</span>
                        <span> · {familyInfo.fields} fields · {familyInfo.occupations} occupations</span>
                        {kelleyOnly && kelleyHere === 0 && <span className="text-amber-300/90"> · no Kelley roles in this family</span>}
                    </p>
                )}
                {family && (
                    <p
                        className="text-[10px] text-gray-500 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-0.5"
                        title="Inside a family, its largest occupation in the slider year is drawn full height and every other hill is in proportion to it. The whole-map view uses one national scale."
                        data-testid="family-scale-note"
                    >
                        Peak heights scaled within this family.
                    </p>
                )}
                {kind === 'world' && kelleyOnly && (
                    <p className="text-[11px] text-amber-100/80 bg-gray-900/60 backdrop-blur-sm rounded-md px-2 py-1">
                        The 50 Kelley business roles, with their published AI scores.
                    </p>
                )}
            </div>
        </div>
    );
};
