/**
 * The Career Paths screen: a full-screen page, separate from the 3D landscape,
 * showing the jobs O*NET 30.1 lists as related to one job ("Similar jobs you
 * could move to"), sorted by level from O*NET Job Zones: step down on the
 * left, same level under the centre job, step up on the right, and "Level not
 * available" when either job has no single Job Zone. Click a related job and
 * it becomes the centre; the trail at the top walks back.
 *
 * NOTHING INVENTED, AND NO CLAUDE CALL. Every card and arrow is one stored
 * O*NET link (utils/careerPaths), in O*NET's order; pay is the BLS OEWS May
 * 2025 median annual wage, AI Exposure this site's published score. Missing
 * data says "no data" / "not scored". "Open job details" hands over to the
 * normal role panel (worldStore.openRole), which behaves as it always has.
 *
 * Loaded lazily by CareerPathsHost, with utils/careerPaths and its data.
 * Desktop (content width >= DESKTOP_MIN_WIDTH): the lane picture from
 * utils/careerPathsLayout, arrows in one SVG. Narrower (phones, landscape
 * phones, tablets): the groups stacked under the centre card with short
 * vertical connectors.
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useWorldStore } from '../../worldStore';
import { Z } from '../../config/layers';
import { CONTINENT_DISPLAY_NAMES } from '../../config/continents';
import { CAREER_PATHS_SOURCE, getCareerPaths, type CareerPaths } from '../../utils/careerPaths';
import { roleScaleFor } from '../../utils/allRoleScale';
import { continentOf } from '../../utils/occupationIndex';
import { getRoleEntries, searchRoles, type RoleEntry } from '../../utils/roles';
import { isChunkLoadError, reloadForNewBuild } from '../../utils/staleBuild';
import {
    CAREER_PATHS_SOURCE_LINE,
    CAREER_PATHS_SUBTITLE,
    CAREER_PATHS_TITLE,
    centreView,
    DEFAULT_SHOWN,
    GROUP_HINT,
    GROUP_LABEL,
    groupCards,
    NO_DATA,
    NO_RELATED_TEXT,
    PHONE_GROUP_ORDER,
    SHOW_MORE_STEP,
    titleOf,
    visibleCards,
    type CareerCard,
    type CareerGroupId,
    type CentreView,
} from '../../utils/careerPathsView';
import { DESKTOP_MIN_WIDTH, desktopLayout, HEADING_H, type DesktopLayout, type LaidArrow } from '../../utils/careerPathsLayout';
import { CloseButton } from '../ui/CloseButton';
import { IconArrowRight, IconCareerPaths, IconSearch } from '../ui/Icons';

interface Props {
    /** Tests only: the content width to lay out for (jsdom measures nothing). */
    layoutWidth?: number;
}

/** Three jobs to start from when nothing is picked yet. Real jobs, nothing more. */
const STARTERS = ['29-1141', '47-2111', '13-2011'];
const DESKTOP_ORDER: readonly CareerGroupId[] = ['down', 'same', 'up', 'none'];

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Loaded = { soc: string; paths: CareerPaths | null };

export default function CareerPathsView({ layoutWidth }: Props) {
    const trail = useWorldStore((s) => s.careerTrail);
    const setTrail = useWorldStore((s) => s.setCareerTrail);
    const close = useWorldStore((s) => s.closeCareerPaths);
    const roleKey = useWorldStore((s) => s.careerRoleKey);
    const openRole = useWorldStore((s) => s.openRole);
    const jobs = useStore((s) => s.jobs);
    const scale = roleScaleFor(jobs);
    const centreSoc = trail.length > 0 ? trail[trail.length - 1] : null;
    const titleId = useId();
    const subtitleId = useId();

    // ── Data: the centre job's stored links (lazy chunk) ──
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [failedSoc, setFailedSoc] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [said, setSaid] = useState('');
    useEffect(() => {
        if (!centreSoc) return;
        let live = true;
        getCareerPaths(centreSoc).then(
            (paths) => {
                if (!live) return;
                setLoaded({ soc: centreSoc, paths });
                setFailedSoc(null);
                setSaid(paths ? `${titleOf(centreSoc)}: ${paths.links.length} related jobs from O*NET.` : `${titleOf(centreSoc)}: ${NO_RELATED_TEXT}`);
            },
            (err: unknown) => {
                if (!live) return;
                if (isChunkLoadError(err) && reloadForNewBuild()) return;
                console.error('[Career paths] could not load', err);
                setFailedSoc(centreSoc);
            },
        );
        return () => {
            live = false;
        };
    }, [centreSoc, attempt]);
    const ready = loaded && loaded.soc === centreSoc ? loaded : null;
    const failed = !ready && failedSoc === centreSoc;

    const [more, setMore] = useState<{ soc: string | null; n: number }>({ soc: null, n: DEFAULT_SHOWN });
    const shown = more.soc === centreSoc ? more.n : DEFAULT_SHOWN;
    const paths = ready?.paths ?? null;
    const cards = useMemo(() => (paths ? visibleCards(paths, shown, scale) : []), [paths, shown, scale]);
    const groups = useMemo(() => groupCards(cards), [cards]);
    const centre = centreSoc ? centreView(centreSoc, ready ? ready.paths : undefined, scale) : null;
    const levels = paths?.jobZone != null;
    const remaining = paths ? paths.links.length - cards.length : 0;

    // ── Width: lanes on a wide screen, stacked otherwise ──
    const mainRef = useRef<HTMLDivElement>(null);
    const [measured, setMeasured] = useState(() => (typeof window !== 'undefined' ? window.innerWidth - 64 : 0));
    useEffect(() => {
        const el = mainRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([entry]) => setMeasured(Math.floor(entry.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const width = layoutWidth ?? measured;
    const desktop = width >= DESKTOP_MIN_WIDTH;
    const layout = useMemo<DesktopLayout | null>(
        () => (desktop && paths ? desktopLayout({ up: groups.up.map((c) => c.soc), same: groups.same.map((c) => c.soc), down: groups.down.map((c) => c.soc), none: groups.none.map((c) => c.soc) }, width, levels) : null),
        [desktop, paths, groups, width, levels],
    );

    // ── Walking ──
    const flipFrom = useRef<DOMRect | null>(null);
    const focusCentre = useRef(centreSoc != null);
    const walkTo = (soc: string, from: HTMLElement | null) => {
        flipFrom.current = from?.getBoundingClientRect() ?? null;
        focusCentre.current = true;
        setTrail([...trail, soc]);
    };
    const stepBack = (i: number) => {
        flipFrom.current = null;
        focusCentre.current = true;
        setTrail(trail.slice(0, i + 1));
    };
    /** A new path from a search result or a starter. `roleKey`: the Kelley title picked, for "Open job details". */
    const startAt = (soc: string, roleKey: string | null = null) => {
        flipFrom.current = null;
        focusCentre.current = true;
        setTrail([soc], roleKey);
    };
    const openDetails = () => {
        if (!centreSoc) return;
        const entries = getRoleEntries(jobs).filter((e) => e.soc === centreSoc);
        const entry = entries.find((e) => e.key === roleKey) ?? entries[0];
        if (!entry) return;
        close({ restoreFocus: false });
        openRole(entry);
    };

    // The new centre comes from where its card was; the rest fades in. None with reduced motion.
    const centreRef = useRef<HTMLElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const readySoc = ready?.soc ?? null;
    useLayoutEffect(() => {
        if (!readySoc) return;
        const from = flipFrom.current;
        flipFrom.current = null;
        if (focusCentre.current) {
            focusCentre.current = false;
            centreRef.current?.focus({ preventScroll: true });
        }
        if (prefersReducedMotion()) return;
        const el = centreRef.current;
        if (from && el && typeof el.animate === 'function') {
            const to = el.getBoundingClientRect();
            el.animate(
                [
                    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(0.94)`, opacity: 0.4 },
                    { transform: 'none', opacity: 1 },
                ],
                { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
            );
        }
        const stage = stageRef.current;
        if (stage && typeof stage.animate === 'function') {
            stage.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: from ? 100 : 0, easing: 'ease-out', fill: 'backwards' });
        }
    }, [readySoc]);

    // ── Esc closes (the search list first). Capture, so a role panel underneath never sees it. ──
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const t = e.target as HTMLElement | null;
            if (t?.closest?.('[data-career-search]') && t.getAttribute('aria-expanded') === 'true') return;
            e.stopPropagation();
            close();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [close]);

    const [hot, setHot] = useState<string | null>(null);
    const cardProps = { hot, onHot: setHot, onWalk: walkTo };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={subtitleId}
            data-career-paths
            data-layout={desktop ? 'desktop' : 'stacked'}
            className="fixed inset-0 flex flex-col bg-gray-950 text-gray-200"
            style={{ zIndex: Z.page }}
        >
            <header className="flex-none border-b border-white/[0.06] pt-[calc(0.75rem+var(--safe-top))] pb-3 pl-[calc(1rem+var(--safe-left))] pr-[calc(1rem+var(--safe-right))] md:pl-[calc(2rem+var(--safe-left))] md:pr-[calc(2rem+var(--safe-right))]">
                <div className="flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="hidden sm:flex w-9 h-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-400/20 text-cyan-300" aria-hidden="true">
                            <IconCareerPaths size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-base md:text-lg font-semibold text-white tracking-tight leading-tight">{CAREER_PATHS_TITLE}</h2>
                            <p id={subtitleId} className="text-xs text-gray-400 leading-snug">{CAREER_PATHS_SUBTITLE}</p>
                        </div>
                    </div>
                    <div className="order-last basis-full md:order-none md:basis-auto md:w-[320px]">
                        <SearchBox onPick={(e) => startAt(e.soc, e.kind === 'kelley' ? e.key : null)} autoFocus={centreSoc == null} />
                    </div>
                    <CloseButton onClick={() => close()} label="Close Career Paths" />
                </div>
                {trail.length > 0 && <Trail trail={trail} onStep={stepBack} />}
            </header>

            <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar py-5 md:py-6 pl-[calc(1rem+var(--safe-left))] pr-[calc(1rem+var(--safe-right))] md:pl-[calc(2rem+var(--safe-left))] md:pr-[calc(2rem+var(--safe-right))]" aria-busy={centreSoc != null && !ready && !failed}>
                <p className="sr-only" aria-live="polite">{said}</p>
                {!centre ? (
                    <EmptyStart onPick={(soc) => startAt(soc)} />
                ) : (
                    <>
                        {layout ? (
                            <div ref={stageRef} className="relative mx-auto" style={{ width: layout.width, height: layout.height }} data-testid="career-stage">
                                <Arrows layout={layout} hot={hot} />
                                <CentreCard ref={centreRef} centre={centre} ready={!!ready} onOpen={openDetails} style={{ position: 'absolute', left: layout.centre.x, top: layout.centre.y, width: layout.centre.w, height: layout.centre.h }} />
                                <DesktopLists layout={layout} groups={groups} levels={levels} remaining={remaining} {...cardProps} />
                            </div>
                        ) : (
                            <div className="mx-auto w-full max-w-[640px]">
                                <CentreCard ref={centreRef} centre={centre} ready={!!ready} onOpen={openDetails} />
                                <div ref={stageRef}>
                                    {paths && <StackedLists groups={groups} levels={levels} remaining={remaining} {...cardProps} />}
                                </div>
                            </div>
                        )}
                        <div className={`mx-auto mt-5 ${layout ? '' : 'max-w-[640px]'}`} style={layout ? { width: layout.width } : undefined}>
                            {!ready && !failed && <p role="status" className="text-sm text-gray-500">Loading related jobs…</p>}
                            {failed && (
                                <p role="alert" className="text-sm text-amber-300 flex items-center gap-3">
                                    Could not load the related jobs.
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setFailedSoc(null);
                                            setAttempt((a) => a + 1);
                                        }}
                                        className="px-3 min-h-[44px] rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white text-xs font-semibold"
                                    >
                                        Try again
                                    </button>
                                </p>
                            )}
                            {ready && !paths && (
                                <p className="text-sm text-gray-400" data-testid="career-no-links">
                                    {NO_RELATED_TEXT}
                                </p>
                            )}
                            {paths && !levels && (
                                <p className="text-xs text-gray-500 mb-2" data-testid="career-no-level">
                                    O*NET gives this job no single Job Zone (its O*NET codes have different ones), so its related jobs show no step up or down.
                                </p>
                            )}
                            {paths && (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
                                    <span data-testid="career-count">
                                        Showing {cards.length} of {paths.links.length} related jobs, most related first (O*NET&apos;s order).
                                    </span>
                                    {remaining > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setMore({ soc: centreSoc, n: shown + SHOW_MORE_STEP })}
                                            title="Adds the next jobs in O*NET's order (its Supplemental tier: less closely related)"
                                            className="px-3.5 min-h-[44px] md:min-h-[36px] [@media(pointer:coarse)]:min-h-[44px] rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07] text-gray-200 font-semibold"
                                            data-testid="career-show-more"
                                        >
                                            Show {Math.min(SHOW_MORE_STEP, remaining)} more
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
                {!desktop && <Attribution className="mx-auto max-w-[640px] mt-8 text-[11px] text-gray-500 leading-relaxed" />}
            </main>

            <footer className="flex-none border-t border-white/[0.06] pt-2.5 pb-[calc(0.625rem+var(--safe-bottom))] pl-[calc(1rem+var(--safe-left))] pr-[calc(1rem+var(--safe-right))] md:pl-[calc(2rem+var(--safe-left))] md:pr-[calc(2rem+var(--safe-right))]">
                <p className="text-[11px] text-gray-400 leading-snug" data-testid="career-source-line">
                    {CAREER_PATHS_SOURCE_LINE}
                </p>
                {desktop && <Attribution className="mt-1 text-[10px] text-gray-500 leading-snug" />}
            </footer>
        </div>
    );
}

// ---------------------------------------------------------------- pieces

/** O*NET's own credit line (docs/career-paths.md says where it was copied from), with O*NET's two links. */
function Attribution({ className }: { className: string }) {
    const s = CAREER_PATHS_SOURCE;
    const db = `${s.version} Database`;
    const a = s.attribution;
    const i = a.indexOf(db);
    const j = a.indexOf(s.license, i + db.length);
    const link = 'underline decoration-white/20 underline-offset-2 hover:text-gray-300';
    return (
        <p className={className} data-testid="onet-attribution">
            {i < 0 || j < 0 ? (
                a
            ) : (
                <>
                    {a.slice(0, i)}
                    <a href={s.databaseUrl} target="_blank" rel="noopener noreferrer" className={link}>{db}</a>
                    {a.slice(i + db.length, j)}
                    <a href={s.licenseDeedUrl} target="_blank" rel="noopener noreferrer" className={link}>{s.license}</a>
                    {a.slice(j + s.license.length)}
                </>
            )}
        </p>
    );
}

function EmptyStart({ onPick }: { onPick: (soc: string) => void }) {
    return (
        <div className="max-w-lg mx-auto text-center py-14 md:py-20" data-testid="career-empty">
            <span className="mx-auto mb-4 flex w-12 h-12 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-cyan-300" aria-hidden="true">
                <IconCareerPaths size={22} />
            </span>
            <p className="text-sm text-gray-300 leading-relaxed">Pick a job to see the jobs O*NET lists as similar to it: a step up, at the same level, or a step down.</p>
            <p className="text-xs text-gray-500 mt-4">Search above, or start from</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
                {STARTERS.map((soc) => (
                    <button key={soc} type="button" onClick={() => onPick(soc)} className="px-3 min-h-[44px] rounded-lg border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.07] text-sm text-gray-200">
                        {titleOf(soc)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Trail({ trail, onStep }: { trail: readonly string[]; onStep: (i: number) => void }) {
    const listRef = useRef<HTMLOListElement>(null);
    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollLeft = el.scrollWidth;
    }, [trail]);
    return (
        <nav aria-label="Your path" className="mt-3" data-testid="career-trail">
            <ol ref={listRef} className="flex items-center gap-1 text-xs flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {trail.map((soc, i) => {
                    const last = i === trail.length - 1;
                    return (
                        <li key={`${i}-${soc}`} className="flex items-center gap-1 shrink-0">
                            {i > 0 && <IconArrowRight size={12} className="text-gray-600" aria-hidden="true" />}
                            {last ? (
                                <span aria-current="step" className="px-2.5 py-1.5 rounded-md bg-white/[0.07] text-white font-medium">
                                    {titleOf(soc)}
                                </span>
                            ) : (
                                <button type="button" onClick={() => onStep(i)} className="px-2.5 py-1.5 min-h-[32px] [@media(pointer:coarse)]:min-h-[44px] rounded-md text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors">
                                    {titleOf(soc)}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

function SearchBox({ onPick, autoFocus }: { onPick: (e: RoleEntry) => void; autoFocus: boolean }) {
    const jobs = useStore((s) => s.jobs);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const listId = useId();
    const matches = useMemo(() => (query.trim().length > 1 ? searchRoles(getRoleEntries(jobs), query, 12) : []), [query, jobs]);
    const expanded = open && query.trim().length > 1;
    const choose = (e: RoleEntry) => {
        onPick(e);
        setQuery('');
        setOpen(false);
    };
    return (
        <div className="relative" data-career-search-box>
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" aria-hidden="true" />
            <input
                type="text"
                role="combobox"
                data-career-search
                aria-label="Search 830 jobs for career paths"
                aria-expanded={expanded}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={expanded && matches[active] ? `${listId}-${active}` : undefined}
                placeholder="Search 830 jobs…"
                autoFocus={autoFocus}
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setOpen(true);
                        setActive((a) => Math.min(a + 1, Math.max(0, matches.length - 1)));
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setActive((a) => Math.max(0, a - 1));
                    } else if (e.key === 'Enter' && expanded && matches[active]) {
                        e.preventDefault();
                        choose(matches[active]);
                    } else if (e.key === 'Escape' && expanded) {
                        e.stopPropagation();
                        setOpen(false);
                    }
                }}
                className="block w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] focus:ring-1 focus:ring-white/10 transition-colors"
            />
            {expanded && (
                <ul id={listId} role="listbox" aria-label="Matching jobs" className="absolute z-10 mt-2 w-full md:w-[380px] md:right-0 max-h-[320px] overflow-y-auto custom-scrollbar rounded-xl border border-white/10 bg-gray-900/95 backdrop-blur-xl shadow-2xl text-sm">
                    {matches.length === 0 && <li className="px-3 py-3 text-xs text-gray-500">No jobs found</li>}
                    {matches.map((r, i) => (
                        <li
                            key={r.key}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === active}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                choose(r);
                            }}
                            onMouseEnter={() => setActive(i)}
                            className={`px-3 py-2.5 min-h-[44px] cursor-pointer border-b border-white/[0.04] last:border-0 ${i === active ? 'bg-white/[0.07]' : ''}`}
                        >
                            <span className="block text-gray-100 leading-snug">{r.title}</span>
                            <span className="block text-[10px] text-gray-500">
                                {r.kind === 'kelley' && r.blsTitle !== r.title ? `BLS: ${r.blsTitle} · ` : ''}
                                {CONTINENT_DISPLAY_NAMES[r.continent]}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

const CentreCard = React.forwardRef<HTMLElement, { centre: CentreView; ready: boolean; onOpen: () => void; style?: React.CSSProperties }>(function CentreCard(
    { centre, ready, onOpen, style },
    ref,
) {
    const fixed = style != null;
    return (
        <section
            ref={ref}
            tabIndex={-1}
            aria-label={`Chosen job: ${centre.title}`}
            data-testid="career-centre"
            data-soc={centre.soc}
            style={style}
            className={`rounded-2xl border border-cyan-400/25 bg-gradient-to-b from-cyan-500/[0.07] to-white/[0.02] shadow-[0_0_0_1px_rgba(34,211,238,0.05),0_12px_40px_-12px_rgba(0,0,0,0.6)] px-5 py-4 md:px-6 md:py-5 flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${fixed ? 'overflow-hidden' : ''}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider">
                        <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-400/20">Chosen job</span>
                        <span className="text-gray-500 normal-case tracking-normal font-normal">{CONTINENT_DISPLAY_NAMES[continentOf(centre.soc)]}</span>
                        <span className="text-gray-600 font-mono normal-case tracking-normal font-normal">BLS {centre.soc}</span>
                    </div>
                    <h3 className="mt-2 text-lg md:text-xl font-semibold text-white tracking-tight leading-snug line-clamp-2" data-testid="career-centre-title">
                        {centre.title}
                    </h3>
                </div>
                {fixed && <OpenDetails onOpen={onOpen} />}
            </div>
            <dl className="mt-auto pt-3 grid grid-cols-3 gap-3 md:gap-4">
                <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Median pay</dt>
                    <dd className="text-sm md:text-base font-semibold text-gray-100 tabular-nums" data-testid="career-centre-pay">{centre.median}</dd>
                    <dd className="text-[10px] text-gray-500">{centre.median === NO_DATA ? 'BLS publishes none' : 'a year, BLS May 2025'}</dd>
                </div>
                <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">AI Exposure</dt>
                    <dd className="text-sm md:text-base font-semibold tabular-nums flex items-center gap-1.5" style={{ color: centre.ai.color }} data-testid="career-centre-ai" data-band={centre.ai.band}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: centre.ai.color }} aria-hidden="true" />
                        {centre.ai.percentText}
                    </dd>
                    <dd className="text-[10px] text-gray-500">{centre.ai.band === 'not scored' ? 'no published score' : `${centre.ai.band} on the map`}</dd>
                </div>
                <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Level</dt>
                    <dd className="text-sm md:text-base font-semibold text-gray-100" data-testid="career-centre-zone">
                        {ready ? (centre.zone != null ? `Job Zone ${centre.zone}` : centre.zoneText.replace('Job Zone: ', '')) : '…'}
                    </dd>
                    <dd className="text-[10px] text-gray-500 leading-snug" title={ready ? centre.zoneText : undefined}>
                        {ready ? (centre.zone != null ? centre.zoneText.replace(/^Job Zone \d: /, '') : 'O*NET Job Zone') : 'loading'}
                    </dd>
                </div>
            </dl>
            {!fixed && <OpenDetails onOpen={onOpen} wide />}
        </section>
    );
});

function OpenDetails({ onOpen, wide }: { onOpen: () => void; wide?: boolean }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`shrink-0 inline-flex items-center justify-center gap-1.5 px-3 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.09] text-xs font-semibold text-gray-100 transition-colors ${wide ? 'mt-4 w-full min-h-[44px]' : 'min-h-[36px] [@media(pointer:coarse)]:min-h-[44px]'}`}
            data-testid="career-open-details"
        >
            Open job details <IconArrowRight size={12} aria-hidden="true" />
        </button>
    );
}

interface CardProps {
    hot: string | null;
    onHot: (soc: string | null) => void;
    onWalk: (soc: string, from: HTMLElement | null) => void;
}

function CardButton({ card, style, onHot, onWalk, hot }: CardProps & { card: CareerCard; style?: React.CSSProperties }) {
    const c = card.pay.change;
    const payColor = c?.kind === 'change' && c.difference > 0 ? 'text-emerald-300' : c?.kind === 'change' && c.difference < 0 ? 'text-rose-300' : 'text-gray-500';
    return (
        <button
            type="button"
            aria-label={card.ariaLabel}
            data-career-card={card.soc}
            data-group={card.group}
            onClick={(e) => onWalk(card.soc, e.currentTarget)}
            onMouseEnter={() => onHot(card.soc)}
            onMouseLeave={() => onHot(null)}
            onFocus={() => onHot(card.soc)}
            onBlur={() => onHot(null)}
            style={style}
            className={`group w-full text-left rounded-xl border px-3 py-2 flex flex-col justify-between gap-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${
                hot === card.soc ? 'border-white/25 bg-white/[0.07]' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
            } ${style ? '' : 'min-h-[60px]'}`}
        >
            <span className="flex items-start gap-2 min-w-0">
                <span className="mt-[5px] w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: card.ai.color }} aria-hidden="true" />
                <span className="flex-1 min-w-0 text-[13px] leading-4 font-medium text-gray-100 line-clamp-2" title={card.title}>{card.title}</span>
                <span className={`shrink-0 text-[12px] leading-4 font-semibold tabular-nums ${payColor}`} title={card.pay.title} data-pay={card.pay.exact}>
                    {card.pay.short === NO_DATA ? 'pay: no data' : card.pay.short}
                </span>
            </span>
            <span className="pl-4 text-[11px] leading-4 text-gray-500 tabular-nums truncate">
                {card.median === NO_DATA ? 'Median pay: no data' : `${card.median} median`}
                <span aria-hidden="true"> · </span>
                <span data-ai={card.ai.band}>{card.ai.band === 'not scored' ? 'AI: not scored' : `AI ${card.ai.percentText}`}</span>
            </span>
        </button>
    );
}

const arrowHead = (a: LaidArrow) => `M${a.end.x} ${a.end.y} l${-a.dir * 7} -3.6 v7.2 z`;

function Arrows({ layout, hot }: { layout: DesktopLayout; hot: string | null }) {
    return (
        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={layout.width} height={layout.height} aria-hidden="true" data-testid="career-arrows">
            {layout.arrows.map((a) => {
                const on = hot === a.soc;
                const stroke = on ? 'rgba(103,232,249,0.9)' : a.group === 'none' ? 'rgba(148,163,184,0.35)' : 'rgba(255,255,255,0.17)';
                return (
                    <g key={a.soc} data-career-arrow={a.soc} data-group={a.group}>
                        <path d={a.d} fill="none" stroke={stroke} strokeWidth={on ? 1.75 : 1.25} strokeDasharray={a.group === 'none' ? '4 4' : undefined} style={{ transition: 'stroke 150ms ease' }} />
                        <path d={arrowHead(a)} fill={stroke} style={{ transition: 'fill 150ms ease' }} />
                    </g>
                );
            })}
        </svg>
    );
}

function GroupHeading({ group, count, levels, remaining, id, hidden }: { group: CareerGroupId; count: number; levels: boolean; remaining: number; id?: string; hidden?: boolean }) {
    return (
        <div aria-hidden={hidden || undefined}>
            <h3 id={id} className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
                <GroupGlyph group={group} />
                {GROUP_LABEL[group]}
                <span className="px-1.5 py-px rounded bg-white/[0.06] text-gray-400 tabular-nums normal-case tracking-normal font-medium">{count}</span>
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                {count === 0 ? (remaining > 0 ? `None in the jobs shown` : 'O*NET lists none') : group === 'none' && !levels ? 'This job has no single O*NET Job Zone' : GROUP_HINT[group]}
            </p>
        </div>
    );
}

function GroupGlyph({ group }: { group: CareerGroupId }) {
    const path = group === 'up' ? 'M6 9.5V2.5M3 5.5l3-3 3 3' : group === 'down' ? 'M6 2.5v7M3 6.5l3 3 3-3' : group === 'same' ? 'M2 6h8M7 3l3 3-3 3' : 'M2 6h8';
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500" aria-hidden="true" strokeDasharray={group === 'none' ? '2 2' : undefined}>
            <path d={path} />
        </svg>
    );
}

function DesktopLists({ layout, groups, levels, remaining, ...cardProps }: CardProps & { layout: DesktopLayout; groups: Record<CareerGroupId, CareerCard[]>; levels: boolean; remaining: number }) {
    const rectOf = new Map(layout.cards.map((c) => [c.soc, c.rect]));
    const seen = new Set<CareerGroupId>();
    return (
        <>
            {layout.headings.map((h) => {
                const dup = seen.has(h.group);
                seen.add(h.group);
                return (
                    <div key={`${h.group}-${h.x}`} className="absolute" style={{ left: h.x, top: h.y, width: h.w, height: HEADING_H }}>
                        <GroupHeading group={h.group} count={h.count} levels={levels} remaining={remaining} hidden={dup} />
                    </div>
                );
            })}
            {DESKTOP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
                <ul key={g} aria-label={`${GROUP_LABEL[g]}, ${groups[g].length} ${groups[g].length === 1 ? 'job' : 'jobs'}`} data-career-list={g}>
                    {groups[g].map((card) => {
                        const r = rectOf.get(card.soc)!;
                        return (
                            <li key={card.soc} className="absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                                <CardButton card={card} style={{ height: r.h }} {...cardProps} />
                            </li>
                        );
                    })}
                </ul>
            ))}
        </>
    );
}

function StackedLists({ groups, levels, remaining, ...cardProps }: CardProps & { groups: Record<CareerGroupId, CareerCard[]>; levels: boolean; remaining: number }) {
    const order = PHONE_GROUP_ORDER.filter((g) => (levels ? g !== 'none' || groups.none.length > 0 : g === 'none'));
    const baseId = useId();
    return (
        <div className="relative">
            {order.map((g) => {
                const id = `${baseId}-${g}`;
                return (
                    <section key={g} aria-labelledby={id} className="relative mt-5 pl-6">
                        {/* A short vertical connector from the card above down to this group. */}
                        <span className="absolute left-[11px] -top-5 h-[26px] w-px bg-white/15" aria-hidden="true" />
                        <span className="absolute left-[8px] top-[5px] w-[7px] h-[7px] rounded-full border border-white/25 bg-gray-950" aria-hidden="true" />
                        <GroupHeading group={g} count={groups[g].length} levels={levels} remaining={remaining} id={id} />
                        {groups[g].length > 0 && (
                            <ul aria-labelledby={id} className="relative mt-2 space-y-2" data-career-list={g}>
                                <span className="absolute -left-[13px] -top-1 bottom-[30px] w-px bg-white/15" aria-hidden="true" />
                                {groups[g].map((card) => (
                                    <li key={card.soc} className="relative">
                                        <span className="absolute -left-[13px] top-1/2 w-[9px] h-px bg-white/15" aria-hidden="true" />
                                        <span className={`absolute -left-[6px] top-1/2 -translate-y-1/2 border-y-[3.5px] border-y-transparent border-l-[5px] ${g === 'none' ? 'border-l-slate-500/60' : 'border-l-white/30'}`} aria-hidden="true" />
                                        <CardButton card={card} {...cardProps} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                );
            })}
        </div>
    );
}
