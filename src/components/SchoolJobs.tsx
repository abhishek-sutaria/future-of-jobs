import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { Z } from '../config/layers';
import type { SchoolFilter } from '../utils/iuSchools';
import { riskText, schoolChipLabel } from '../utils/schoolLook';
import { roleRisk, type RoleEntry } from '../utils/roles';
import { IconX } from './ui/Icons';

/**
 * Says the picked school's jobs where you are. With some: a chip ("Kelley · 12
 * jobs here") that opens a plain list of them, each with its Automation Risk,
 * and a tap on one flies to it and opens it exactly as tapping its peak does
 * (worldStore.openRole). With none: the friendly empty note and "Clear school".
 * Only while a school is picked; hiding the picker drops the school, and so this.
 *
 * `roles` must be the roles drawn at full colour in this scope (iuSchools
 * highlightedRoles), so the count is what the map shows.
 */
export const SchoolJobs: React.FC<{ school: SchoolFilter; roles: readonly RoleEntry[]; atWorld: boolean; scopeName: string | null; narrow: boolean }> = ({
    school, roles, atWorld, scopeName, narrow,
}) => {
    const setSchool = useWorldStore((s) => s.setSchool);
    const openRole = useWorldStore((s) => s.openRole);
    const jobs = useStore((s) => s.jobs);
    const [open, setOpen] = useState(false);
    const chipRef = useRef<HTMLButtonElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const panelId = useId();

    // A new school or place starts with the list shut.
    const scopeKey = `${school.id}|${scopeName ?? ''}|${atWorld}`;
    const [wasScope, setWasScope] = useState(scopeKey);
    if (scopeKey !== wasScope) {
        setWasScope(scopeKey);
        setOpen(false);
    }

    const rows = useMemo(() => {
        const jobById = new Map(jobs.map((j) => [j.id, j]));
        return [...roles]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((r) => ({ role: r, risk: roleRisk(r, r.jobId ? jobById.get(r.jobId) : null) }));
    }, [roles, jobs]);

    const close = (refocus: boolean) => {
        setOpen(false);
        if (refocus) chipRef.current?.focus({ preventScroll: true });
    };

    // Esc, or a tap anywhere outside the chip and its list, closes it.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            const t = e.target as Node;
            if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            setOpen(false);
            chipRef.current?.focus({ preventScroll: true });
        };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Keyboard users land on the list's first job.
    useLayoutEffect(() => {
        if (open) panelRef.current?.querySelector<HTMLElement>('[data-school-job]')?.focus({ preventScroll: true });
    }, [open]);

    // The phone sheet runs from the screen's foot up to just under the bar, never
    // over the dropdowns: measured as it opens.
    const [sheetMax, setSheetMax] = useState<number | null>(null);
    const toggle = () => {
        if (!open && narrow) {
            const bar = document.querySelector('[data-world-bar]')?.getBoundingClientRect();
            setSheetMax(bar ? Math.max(160, Math.floor(window.innerHeight - bar.bottom - 12)) : null);
        }
        setOpen((o) => !o);
    };

    if (roles.length === 0) {
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

    const label = schoolChipLabel(school, roles.length, atWorld);
    const panel = open && (
        <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            data-school-jobs-list
            data-layout={narrow ? 'sheet' : 'popover'}
            className={narrow
                ? 'fixed inset-x-0 bottom-0 pointer-events-auto rounded-t-2xl border-t border-x border-[#990000]/50 bg-gray-900/97 backdrop-blur-xl shadow-2xl flex flex-col pb-[env(safe-area-inset-bottom)]'
                : 'absolute left-0 top-full mt-1.5 z-30 w-[min(22rem,calc(100vw-2rem))] max-h-[min(60vh,28rem)] pointer-events-auto rounded-xl border border-[#990000]/40 bg-gray-900/95 backdrop-blur-xl shadow-2xl flex flex-col'}
            style={narrow ? { zIndex: Z.sidebar, maxHeight: sheetMax ?? '50vh' } : undefined}
        >
            <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1.5 border-b border-white/[0.08] shrink-0">
                <p id={titleId} className="text-xs font-semibold text-rose-50 truncate">
                    {school.name} <span className="font-normal text-gray-400">· {roles.length} {roles.length === 1 ? 'job' : 'jobs'}{scopeName ? ` in ${scopeName}` : ''}</span>
                </p>
                <button
                    type="button"
                    data-testid="school-jobs-close"
                    aria-label="Close list"
                    onClick={() => close(true)}
                    className="shrink-0 w-8 h-8 [@media(pointer:coarse)]:w-10 [@media(pointer:coarse)]:h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/[0.08]"
                >
                    <IconX size={15} />
                </button>
            </div>
            <ul className="overflow-y-auto custom-scrollbar py-1 min-h-0">
                {rows.map(({ role, risk }) => (
                    <li key={role.key}>
                        <button
                            type="button"
                            data-school-job={role.key}
                            onClick={() => {
                                close(false);
                                openRole(role);
                            }}
                            className="w-full text-left px-3 py-2 min-h-[40px] flex items-center justify-between gap-3 hover:bg-[#990000]/20 focus-visible:bg-[#990000]/25 outline-none"
                        >
                            <span className="text-[13px] text-gray-100 min-w-0">{role.title}</span>
                            <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{riskText(risk)}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );

    return (
        <div ref={wrapRef} data-school-jobs className="relative shrink-0 pointer-events-auto max-md:self-start">
            <button
                ref={chipRef}
                type="button"
                data-testid="school-chip"
                onClick={toggle}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                className="h-9 [@media(pointer:coarse)]:h-11 px-3 rounded-lg border border-[#990000]/60 bg-[#990000]/25 backdrop-blur-sm text-xs font-semibold text-rose-50 hover:bg-[#990000]/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff8080] transition-colors flex items-center gap-1.5 whitespace-nowrap tabular-nums"
            >
                <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#ff4d4d] shadow-[0_0_6px_#ff4d4d]" />
                {label}
                <span className="sr-only">. Show list</span>
            </button>
            {panel && (narrow ? createPortal(panel, document.body) : panel)}
        </div>
    );
};
