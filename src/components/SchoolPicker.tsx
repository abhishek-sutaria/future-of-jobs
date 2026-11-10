import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useWorldStore } from '../worldStore';
import { countMatches, loadIuSchools, schoolFilterOf, type IuSchool, type SchoolFilter } from '../utils/iuSchools';
import { prefersReducedMotion } from './world/worldCamera';
import { IconChevronDown, IconGraduationCap } from './ui/Icons';

/** Entrance: slide, shimmer and sparks all done (index.css .iu-school--enter and its parts). */
export const SCHOOL_ENTER_MS = 640;
/** Exit: a quicker, quieter slide back. */
export const SCHOOL_LEAVE_MS = 220;
/** Either way with reduced motion: a plain fade. */
export const SCHOOL_FADE_MS = 180;

type Phase = 'hidden' | 'enter' | 'shown' | 'leave';

const CRIMSON = '#990000';
const BLUSH = '#ffd9d9';

/** The trail of sparks, from where the two pickers meet out along the slide. */
const SPARKS_BESIDE = [
    { dx: 16, dy: -13, size: 8, delay: 0, color: CRIMSON },
    { dx: 34, dy: 11, size: 6, delay: 25, color: BLUSH },
    { dx: 52, dy: -8, size: 9, delay: 50, color: CRIMSON },
    { dx: 72, dy: 14, size: 6, delay: 75, color: CRIMSON },
    { dx: 92, dy: -12, size: 7, delay: 95, color: BLUSH },
    { dx: 112, dy: 7, size: 8, delay: 110, color: CRIMSON },
    { dx: 132, dy: -4, size: 5, delay: 120, color: BLUSH },
];
const SPARKS_UNDER = [
    { dx: -12, dy: 10, size: 8, delay: 0, color: CRIMSON },
    { dx: 14, dy: 18, size: 6, delay: 25, color: BLUSH },
    { dx: -6, dy: 28, size: 9, delay: 50, color: CRIMSON },
    { dx: 20, dy: 38, size: 6, delay: 75, color: CRIMSON },
    { dx: -16, dy: 46, size: 7, delay: 95, color: BLUSH },
    { dx: 8, dy: 54, size: 5, delay: 120, color: BLUSH },
];

const Spark: React.FC<{ dx: number; dy: number; size: number; delay: number; color: string }> = ({ dx, dy, size, delay, color }) => (
    <svg
        aria-hidden="true"
        className="iu-school__spark"
        viewBox="0 0 10 10"
        style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, '--size': `${size}px`, '--delay': `${delay}ms` } as React.CSSProperties}
    >
        <path d="M5 0 6.1 3.9 10 5 6.1 6.1 5 10 3.9 6.1 0 5 3.9 3.9Z" fill={color} />
    </svg>
);

const fieldPicker = () => document.querySelector<HTMLElement>('[data-field-picker]');

type FocusTarget = 'selected' | 'first' | 'last' | number;

/** Focus an option of the list: the selected one, the first or last, or one step from the focused one. False if it has none yet. */
function focusOptionIn(list: HTMLElement | null, which: FocusTarget): boolean {
    const all = [...(list?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    if (all.length === 0) return false;
    const current = all.indexOf(document.activeElement as HTMLButtonElement);
    const index = which === 'first' ? 0
        : which === 'last' ? all.length - 1
            : which === 'selected' ? Math.max(0, all.findIndex((o) => o.getAttribute('aria-selected') === 'true'))
                : Math.min(all.length - 1, Math.max(0, current + which));
    all[index].focus();
    return true;
}

/**
 * The hidden IU school filter, beside the field picker (under it on a narrow
 * screen). Nothing on screen points to it: Cmd+S on a Mac, Ctrl+S elsewhere
 * (hooks/useSchoolShortcut) or a long press on the field picker shows it, and
 * the same again, or Esc on it, hides it and drops the school. A school dims
 * every job its degree programs do not lead to, at every level, together with
 * the field you are in. Never saved: a reload starts hidden.
 *
 * Always mounted, for its polite live region, which tells screen reader users
 * when it appears and goes, and what a school matches.
 */
export const SchoolPicker: React.FC<{ onOpenChange?: (open: boolean) => void }> = ({ onOpenChange }) => {
    const revealed = useWorldStore((s) => s.schoolsRevealed);
    const school = useWorldStore((s) => s.school);
    const setSchool = useWorldStore((s) => s.setSchool);
    const hideSchools = useWorldStore((s) => s.hideSchools);

    const [phase, setPhase] = useState<Phase>(revealed ? 'shown' : 'hidden');
    const [motion, setMotion] = useState<{ reduced: boolean; narrow: boolean }>({ reduced: false, narrow: false });
    // Follow the store during render (not from an effect), so the frame that
    // shows the picker is the frame its entrance starts.
    const [wasRevealed, setWasRevealed] = useState(revealed);
    if (revealed !== wasRevealed) {
        setWasRevealed(revealed);
        setPhase(revealed ? 'enter' : 'leave');
        setMotion({
            reduced: prefersReducedMotion(),
            narrow: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches === true,
        });
    }

    useEffect(() => {
        if (phase !== 'enter' && phase !== 'leave') return;
        const ms = motion.reduced ? SCHOOL_FADE_MS : phase === 'enter' ? SCHOOL_ENTER_MS : SCHOOL_LEAVE_MS;
        const t = setTimeout(() => setPhase(phase === 'enter' ? 'shown' : 'hidden'), ms);
        return () => clearTimeout(t);
    }, [phase, motion.reduced]);

    const [schools, setSchools] = useState<IuSchool[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    useEffect(() => {
        if (!revealed || schools) return;
        let live = true;
        loadIuSchools()
            .then((list) => { if (live) { setSchools(list); setLoadFailed(false); } })
            .catch(() => { if (live) setLoadFailed(true); });
        return () => { live = false; };
    }, [revealed, schools]);

    const [open, setOpen] = useState(false);
    const [wasShown, setWasShown] = useState(phase !== 'hidden');
    if ((phase !== 'hidden') !== wasShown) {
        setWasShown(phase !== 'hidden');
        if (phase === 'hidden') setOpen(false);
    }
    useEffect(() => {
        onOpenChange?.(open);
    }, [open, onOpenChange]);

    const wrapRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Keyboard focus goes into the picker as it appears.
    useLayoutEffect(() => {
        if (phase === 'enter') buttonRef.current?.focus({ preventScroll: true });
    }, [phase]);

    // ...and back to the field picker when it goes, from whichever way it was hidden.
    useEffect(() => useWorldStore.subscribe((s, prev) => {
        if (prev.schoolsRevealed && !s.schoolsRevealed) fieldPicker()?.focus({ preventScroll: true });
    }), []);

    const [announcement, setAnnouncement] = useState('');
    useEffect(() => useWorldStore.subscribe((s, prev) => {
        if (s.schoolsRevealed && !prev.schoolsRevealed) setAnnouncement('IU school filter shown. Pick a school to see only the jobs its majors lead to.');
        else if (!s.schoolsRevealed && prev.schoolsRevealed) setAnnouncement('IU school filter hidden. Showing every job.');
        else if (s.school !== prev.school) {
            setAnnouncement(s.school ? `${s.school.name}: ${s.school.socs.size} occupations stand out.` : 'No school picked. Showing every job.');
        }
    }), []);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [open]);

    // Open the list, then move into it once its options are on screen.
    const pendingFocus = useRef<FocusTarget | null>(null);
    useLayoutEffect(() => {
        if (!open || !pendingFocus.current) return;
        if (focusOptionIn(listRef.current, pendingFocus.current)) pendingFocus.current = null;
    }, [open, schools]);

    const pick = (next: SchoolFilter | null) => {
        setSchool(next);
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
    };

    const onButtonKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape' && !open) {
            e.preventDefault();
            hideSchools();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            pendingFocus.current = e.key === 'ArrowDown' ? 'selected' : 'last';
            setOpen(true);
        }
    };
    const onListKey = (e: React.KeyboardEvent) => {
        const moves: Record<string, FocusTarget> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' };
        if (e.key in moves) {
            e.preventDefault();
            focusOptionIn(listRef.current, moves[e.key]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            buttonRef.current?.focus({ preventScroll: true });
        } else if (e.key === 'Tab') {
            setOpen(false);
        }
    };

    const labelId = useId();
    const valueId = useId();
    const listId = useId();
    const animating = phase === 'enter' || phase === 'leave';
    const motionClass = phase === 'enter'
        ? (motion.reduced ? 'iu-school--fade-in' : 'iu-school--enter')
        : phase === 'leave'
            ? (motion.reduced ? 'iu-school--fade-out' : 'iu-school--leave')
            : '';

    return (
        <>
            <p className="sr-only" aria-live="polite" data-testid="school-announcer">{announcement}</p>
            {phase !== 'hidden' && (
                <div
                    ref={wrapRef}
                    data-school-picker
                    data-phase={phase}
                    className={`iu-school ${motionClass} relative shrink-0 min-w-0 max-md:self-start pointer-events-auto`}
                    // Leaving: no longer a control, though it is still on screen for a moment.
                    inert={phase === 'leave' ? true : undefined}
                >
                    <span id={labelId} className="sr-only">IU school</span>
                    <button
                        ref={buttonRef}
                        type="button"
                        data-school-button
                        onClick={() => setOpen((o) => !o)}
                        onKeyDown={onButtonKey}
                        aria-labelledby={`${labelId} ${valueId}`}
                        aria-haspopup="listbox"
                        aria-expanded={open}
                        aria-controls={open ? listId : undefined}
                        className={`relative overflow-hidden h-9 [@media(pointer:coarse)]:h-11 max-w-[min(18rem,calc(100vw-2rem))] pl-3 pr-2.5 rounded-lg border border-[#990000]/70 bg-gray-900/80 ${animating ? '' : 'backdrop-blur-sm'} text-xs font-semibold text-rose-50 hover:bg-[#990000]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff8080] transition-colors flex items-center gap-1.5 whitespace-nowrap`}
                    >
                        <IconGraduationCap size={13} className="shrink-0 text-[#ff6b6b]" />
                        <span id={valueId} className="truncate">{school ? school.name : 'All IU schools'}</span>
                        <IconChevronDown size={13} className="shrink-0 text-gray-400" />
                        {phase === 'enter' && !motion.reduced && <span aria-hidden="true" className="iu-school__shimmer" />}
                    </button>
                    {phase === 'enter' && !motion.reduced && (
                        <span aria-hidden="true" className="absolute pointer-events-none" style={motion.narrow ? { left: 24, top: 0 } : { left: 0, top: '50%' }}>
                            {(motion.narrow ? SPARKS_UNDER : SPARKS_BESIDE).map((s, i) => <Spark key={i} {...s} />)}
                        </span>
                    )}
                    {open && (
                        <ul
                            ref={listRef}
                            id={listId}
                            role="listbox"
                            aria-label="IU schools"
                            onKeyDown={onListKey}
                            className="absolute left-0 mt-1.5 w-[min(22rem,calc(100vw-2rem))] max-h-[min(60vh,26rem)] overflow-y-auto custom-scrollbar rounded-xl border border-[#990000]/40 bg-gray-900/95 backdrop-blur-xl shadow-2xl py-1"
                        >
                            <li>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={!school}
                                    onClick={() => pick(null)}
                                    className="w-full text-left px-3 py-2.5 text-xs text-gray-300 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] outline-none"
                                >
                                    All IU schools <span className="text-gray-500">· no filter</span>
                                </button>
                            </li>
                            {schools?.map((s) => (
                                <li key={s.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={school?.id === s.id}
                                        onClick={() => pick(schoolFilterOf(s))}
                                        className={`w-full text-left px-3 py-2 min-h-[40px] flex items-center justify-between gap-3 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] outline-none ${school?.id === s.id ? 'bg-[#990000]/20' : ''}`}
                                    >
                                        <span className="text-[13px] text-gray-200">{s.name}</span>
                                        <span className="text-[11px] text-gray-500 tabular-nums shrink-0">{s.jobs.length} occupations</span>
                                    </button>
                                </li>
                            ))}
                            {!schools && (
                                <li className="px-3 py-2.5 text-xs text-gray-500" role="presentation">
                                    {loadFailed ? 'Could not load the IU schools. Close and try again.' : 'Loading IU schools…'}
                                </li>
                            )}
                        </ul>
                    )}
                </div>
            )}
        </>
    );
};

/**
 * What the picked school matches where you are: "9 of 46 occupations" in a
 * field or family, every match at the whole map, and when nothing here
 * matches, says so with a one-click way out. Lives in WorldBar's info line,
 * beside the field's own occupation count.
 */
export const SchoolMatchNote: React.FC<{ school: SchoolFilter; scopeSocs: readonly string[]; scopeName: string | null }> = ({ school, scopeSocs, scopeName }) => {
    const setSchool = useWorldStore((s) => s.setSchool);
    const matches = countMatches(school, scopeSocs);
    if (matches === 0) {
        return (
            <p data-testid="school-empty" className="pointer-events-auto text-[11px] text-rose-100 bg-[#990000]/25 border border-[#990000]/50 backdrop-blur-sm rounded-md pl-2 pr-1 py-0.5 leading-snug max-w-full flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>No {school.name} jobs {scopeName ? `in ${scopeName}` : 'here'}.</span>
                <button
                    type="button"
                    data-testid="school-clear"
                    onClick={() => setSchool(null)}
                    className="[@media(pointer:coarse)]:min-h-9 px-1.5 rounded font-semibold text-white underline underline-offset-2 hover:bg-white/10"
                >
                    Clear school
                </button>
            </p>
        );
    }
    return (
        <p data-testid="school-count" className="pointer-events-auto text-[11px] text-rose-100 bg-[#990000]/20 border border-[#990000]/40 backdrop-blur-sm rounded-md px-2 py-1 leading-snug max-w-full">
            <span className="font-semibold tabular-nums">{scopeName ? `${matches} of ${scopeSocs.length}` : matches}</span>
            {' '}occupations · {school.name}
        </p>
    );
};
