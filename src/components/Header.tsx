import React, { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { IconZap, IconGlobe, IconMap, IconSearch, IconInfo, IconRocket, IconUser, IconMenu, IconLayers, IconBook } from './ui/Icons';
import { MobileMoreSheet } from './MobileMoreSheet';
import { useIsMobile } from '../hooks/useIsMobile';
import { useUserStore } from '../userStore';
import { Z } from '../config/layers';
import { YEAR_MIN, YEAR_MAX, UI, MAP_SIDEBAR } from '../config/constants';
import { useWorldStore } from '../worldStore';
import { getRoleEntries, searchRoles, type RoleEntry } from '../utils/roles';
import { CONTINENT_DISPLAY_NAMES } from '../config/continents';

interface HeaderProps {
    economyData: { value: string; period: string; color: string } | null;
    loadingEconomy: boolean;
    onOpenSkillsModal: () => void;
    onOpenStartupIdeasModal: () => void;
    onStartTour: () => void;
    onOpenStudentGuide: () => void;
    onOpenHealthCheck: () => void;
    onShowMethodology: () => void;
}

export const Header: React.FC<HeaderProps> = ({ economyData, loadingEconomy, onOpenSkillsModal, onOpenStartupIdeasModal, onStartTour, onOpenStudentGuide, onOpenHealthCheck, onShowMethodology }) => {
    const mapView = useStore((state) => state.mapView);
    const setMapView = useStore((state) => state.setMapView);
    const openRole = useWorldStore((state) => state.openRole);
    const isScoring = useStore((state) => state.isScoring);
    const hasAIScores = useStore((state) => state.hasAIScores);
    const scoringProgress = useStore((state) => state.scoringProgress);
    const scoresGeneratedAt = useStore((state) => state.scoresGeneratedAt);
    const openRescoreModal = useStore((state) => state.openRescoreModal);
    const navigate = useStore((state) => state.navigate);
    const isDefaultView = useStore((state) => state.isDefaultView);
    const triggerResetView = useStore((state) => state.triggerResetView);

    // Account state. Deliberately read from the separate user store — identity
    // is not part of the visualisation store and must stay decoupled from the
    // Claude API-key mechanism above.
    const authStatus = useUserStore((state) => state.authStatus);
    const savedCount = useUserStore((state) => state.activity.savedRoles.length);

    const scoresAgeLabel = scoresGeneratedAt
        ? new Date(scoresGeneratedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : null;

    const [showMoreSheet, setShowMoreSheet] = useState(false);
    const isMobile = useIsMobile();

    return (
        <>
        <header className="absolute top-0 left-0 w-full px-5 md:px-8 py-2.5 md:py-5 [@media(max-height:480px)]:!py-1.5 flex flex-col md:flex-row justify-between items-start md:items-center pointer-events-none gap-2 md:gap-4 [@media(max-height:480px)]:!gap-2" style={{ zIndex: Z.header }}>
            {/* MAP_SIDEBAR.CLEARANCE_PX clears RoleSelector's desktop sidebar
                when the 2D map is open. Skipped on mobile, where that sidebar
                doesn't render at all (RoleFilterButton/Sheet takes over) —
                applying it there used to shove this title almost entirely
                off a phone screen for no benefit. */}
            <div className="flex flex-col ml-0 min-w-0" style={{ marginLeft: mapView !== 'globe' && !isMobile ? MAP_SIDEBAR.CLEARANCE_PX : 0 }}>
                <h1 className="text-lg md:text-xl font-semibold text-white tracking-wide flex items-center gap-2.5">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300 font-bold">AI</span>
                    <span className="text-white/80 font-light">&</span>
                    <span>Future of Work</span>
                </h1>
                <div className="hidden md:flex [@media(max-height:480px)]:!hidden items-center gap-3 mt-1.5 flex-wrap">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <p className="text-[10px] md:text-xs text-gray-500 font-medium tracking-widest uppercase">
                            Workforce Intel {YEAR_MIN}–{YEAR_MAX}
                        </p>
                    </div>

                    {isScoring && (
                        <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400 font-semibold uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            {scoringProgress
                                ? `Scoring ${scoringProgress.done}/${scoringProgress.total}`
                                : 'Scoring tasks with AI...'}
                        </span>
                    )}

                    {!isScoring && hasAIScores && (
                        <span
                            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider pointer-events-auto cursor-pointer hover:bg-emerald-500/20 transition-colors"
                            title={
                                scoresAgeLabel
                                    ? `AI ratings computed ${scoresAgeLabel}. Click to re-score all roles with fresh Claude data (uses your API key).`
                                    : 'Click to re-score all roles with fresh Claude data (uses your API key).'
                            }
                            onClick={() => openRescoreModal()}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {scoresAgeLabel ? `AI Scores · ${scoresAgeLabel}` : 'AI Scores'}
                        </span>
                    )}

                    {(economyData || loadingEconomy) && (
                        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] pointer-events-auto" title="Live Data from Bureau of Labor Statistics">
                            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">US Unemployment</span>
                            {loadingEconomy ? (
                                <span className="text-[10px] text-gray-400 animate-pulse">Loading...</span>
                            ) : (
                                <>
                                    <span className={`text-xs font-mono font-bold ${economyData?.color}`}>{economyData?.value}</span>
                                    <span className="text-[9px] text-gray-600">({economyData?.period})</span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col items-end gap-2 pointer-events-auto w-full md:w-auto max-[1199px]:min-w-0">
                {/* Below 1200px this row wraps instead of spilling off the right
                    edge (every button is shrink-0). The old threshold was 1366px,
                    set when the row was seven separate pills plus a Health button;
                    grouping them into view / tools / help segments made it ~40%
                    narrower. The Saved/Account button resolves asynchronously
                    (authStatus), so re-verify empirically with it rendered if this
                    row's content changes again — don't trust one quick pass. */}
                <div className={`flex items-center gap-1.5 sm:gap-2 justify-end max-[1199px]:flex-wrap max-[1199px]:shrink max-[1199px]:min-w-0 ${
                    // The sidebar takes 336px off the header, so the width at which these
                    // buttons must start wrapping is 336px higher whenever it is open.
                    // Without this they kept their full width at ~1440 and the title ran
                    // underneath them (in the 2D map as well, before this view existed).
                    mapView !== 'globe' && !isMobile ? 'flex-wrap shrink min-w-0' : 'flex-nowrap shrink-0'
                }`}>
                    {/* Mirrors MapView's own "Reset view" (same conditional-only-
                        when-not-default pattern, same plain-text style). The 3D
                        view has no bottom-line "am I at the default framing"
                        signal the way the 2D map's `zoom === 1` does, so
                        Landscape.tsx derives isDefaultView from pan-target
                        distance and reports it here via the store — reported
                        directly: a two-finger touch gesture panned the camera
                        far enough to lose the terrain entirely with no way back
                        short of reloading the page.
                        First in a justify-end row, so appearing/disappearing
                        never shifts any other button. */}
                    {mapView !== 'map' && !isDefaultView && (
                        <button
                            onClick={triggerResetView}
                            title="Return the 3D view to its starting position"
                            className="shrink-0 px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-gray-300 hover:text-white text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px] max-md:min-w-[44px] max-md:justify-center"
                        >
                            Reset view
                        </button>
                    )}

                    <ViewSwitcher view={mapView} onChange={setMapView} />

                    {/* Same segmented style as the view switcher: one neutral surface,
                        colour only on the icon, so the row reads as three groups
                        (view, tools, help) rather than a strip of coloured pills. */}
                    <div role="group" aria-label="Tools" className={`hidden md:flex ${GROUP_CLASS}`}>
                        <button data-tour="tour-skills" onClick={onOpenSkillsModal} className={`flex ${GROUP_BUTTON_CLASS}`}>
                            <IconZap size={14} className="text-cyan-400" /> My Skills
                        </button>
                        <button
                            data-tour="tour-startup-ideas"
                            onClick={onOpenStartupIdeasModal}
                            title="Startup Ideas — personalized startup opportunities from your resume"
                            className={`flex ${GROUP_BUTTON_CLASS}`}
                        >
                            <IconRocket size={14} className="text-violet-300" /> Startup Ideas
                        </button>
                    </div>

                    <div role="group" aria-label="Help" className={`flex ${GROUP_CLASS}`}>
                        <button
                            onClick={onOpenStudentGuide}
                            title="Student Feature Guide — printable reference"
                            className={`hidden md:flex ${GROUP_BUTTON_CLASS}`}
                        >
                            <IconBook size={14} className="text-amber-400" /> Guide
                        </button>
                        <button
                            onClick={onStartTour}
                            title="Take a guided tour"
                            aria-label="Take a guided tour"
                            className={`flex ${GROUP_BUTTON_CLASS}`}
                        >
                            <IconInfo size={14} />
                            <span className="hidden md:inline">Tour</span>
                        </button>
                    </div>

                    {/* My Skills, Startup Ideas, and Guide above are desktop-only —
                        this is their only way in on a phone. */}
                    <button
                        onClick={() => setShowMoreSheet(true)}
                        title="More"
                        className="md:hidden shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-gray-300 transition-colors"
                    >
                        <IconMenu size={16} />
                    </button>

                    {/* Hidden entirely when this build has no account backend, so
                        an unconfigured deploy shows no dead control. */}
                    {authStatus !== 'disabled' && (
                        <button
                            onClick={() => navigate('dashboard')}
                            title={
                                authStatus === 'identified'
                                    ? 'Your activity — saved roles, history and reports'
                                    : 'Your activity — saved to this browser; add an email to keep it'
                            }
                            className="shrink-0 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-gray-300 hover:text-white text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px] max-md:min-w-[44px] max-md:justify-center"
                        >
                            <IconUser size={14} className="text-indigo-300" />
                            <span className="hidden md:inline">
                                {authStatus === 'identified' ? 'Account' : 'Saved'}
                            </span>
                            {savedCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200 text-[10px] leading-none">
                                    {savedCount}
                                </span>
                            )}
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                    <div data-tour="tour-search" className="w-full md:w-auto">
                        <SearchBar onSelectRole={openRole} />
                    </div>
                </div>
            </div>
        </header>
        <MobileMoreSheet
            isOpen={showMoreSheet}
            onClose={() => setShowMoreSheet(false)}
            onOpenSkillsModal={onOpenSkillsModal}
            onOpenStartupIdeasModal={onOpenStartupIdeasModal}
            onOpenStudentGuide={onOpenStudentGuide}
            onShowMethodology={onShowMethodology}
            onOpenHealthCheck={onOpenHealthCheck}
            onOpenRescore={() => openRescoreModal()}
            scoresAgeLabel={scoresAgeLabel}
        />
        </>
    );
};

const GROUP_CLASS = 'shrink-0 items-center gap-0.5 p-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03]';
const GROUP_BUTTON_CLASS = 'items-center justify-center gap-1.5 h-10 min-w-[44px] px-2.5 sm:px-3 rounded-md text-xs font-semibold uppercase tracking-wider text-gray-300 hover:text-white hover:bg-white/[0.06] transition-colors';

type View = 'globe' | 'map' | 'tasks';

const VIEWS: { id: View; label: string; title: string; icon: React.ReactNode; tour?: string }[] = [
    { id: 'globe', label: '3D', title: '3D globe of jobs', icon: <IconGlobe size={14} /> },
    { id: 'map', label: 'Map', title: '2D US map by state', icon: <IconMap size={14} /> },
    { id: 'tasks', label: 'Tasks', title: 'Every role split into its tasks', icon: <IconLayers size={14} />, tour: 'tour-tasks' },
];

/**
 * The three views are one control in one fixed place: the current view is
 * highlighted and you leave it by picking another — never by hunting for a
 * "Close map" / "Globe" / click-Tasks-again button that moves between modes.
 * Labels collapse to icons below 640px so the row fits a 320px phone.
 */
const ViewSwitcher: React.FC<{ view: View; onChange: (v: View) => void }> = ({ view, onChange }) => (
    <div
        data-tour="tour-toggle"
        role="group"
        aria-label="View"
        className={`flex ${GROUP_CLASS}`}
    >
        {VIEWS.map((v) => {
            const active = view === v.id;
            return (
                <button
                    key={v.id}
                    type="button"
                    data-tour={v.tour}
                    onClick={() => onChange(v.id)}
                    title={v.title}
                    aria-label={v.label}
                    aria-pressed={active}
                    className={`flex items-center justify-center gap-1.5 h-10 min-w-[44px] px-2.5 sm:px-3 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors ${
                        active
                            ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40'
                            : 'text-gray-400 hover:text-white hover:bg-white/[0.06]'
                    }`}
                >
                    {v.icon}
                    <span className="hidden sm:inline">{v.label}</span>
                </button>
            );
        })}
    </div>
);

const SearchBar: React.FC<{ onSelectRole: (role: RoleEntry) => void }> = ({ onSelectRole }) => {
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<RoleEntry[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    // Every role: the 50 Kelley titles plus every other BLS occupation.
    const handleChange = useCallback((val: string) => {
        setQuery(val);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (val.trim().length > 1) {
                setMatches(searchRoles(getRoleEntries(useStore.getState().jobs), val));
                setIsOpen(true);
            } else {
                setIsOpen(false);
                setMatches([]);
            }
        }, UI.SEARCH_DEBOUNCE_MS);
    }, []);

    const handleSelect = useCallback((role: RoleEntry) => {
        onSelectRole(role);
        setQuery('');
        setIsOpen(false);
        setMatches([]);
    }, [onSelectRole]);

    return (
        <div className="relative w-full md:w-[260px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <IconSearch size={14} className="text-gray-500" />
            </div>
            <input
                type="text"
                placeholder="Search 830 jobs..."
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                onFocus={() => { if (query.trim().length > 1) setIsOpen(true); }}
                onBlur={() => setTimeout(() => setIsOpen(false), UI.SEARCH_DEBOUNCE_MS)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && matches.length > 0) handleSelect(matches[0]);
                }}
                aria-label="Search jobs"
                className="block w-full pl-9 pr-3 py-2.5 border border-white/[0.06] rounded-lg bg-white/[0.03] text-gray-300 placeholder-gray-600 focus:outline-none focus:bg-white/[0.06] focus:border-white/15 focus:ring-1 focus:ring-white/10 text-sm transition-all min-h-[44px] max-md:min-w-[44px] max-md:justify-center"
            />
            {isOpen && matches.length > 0 && (
                <div role="listbox" aria-label="Matching jobs" className="absolute mt-2 w-full md:w-[340px] md:right-0 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl max-h-[340px] overflow-y-auto text-sm custom-scrollbar" style={{ zIndex: Z.sidebar }}>
                    {matches.map((r) => (
                        <div
                            key={r.key}
                            role="option"
                            aria-selected={false}
                            className="px-3 py-2.5 hover:bg-white/[0.06] cursor-pointer flex justify-between items-center gap-3 transition-colors border-b border-white/[0.04] last:border-0"
                            onMouseDown={() => handleSelect(r)}
                        >
                            <span className="min-w-0">
                                <span className="block font-medium text-gray-200 text-sm leading-snug line-clamp-2">{r.title}</span>
                                {r.kind === 'kelley' && r.blsTitle !== r.title && (
                                    <span className="block text-[10px] text-gray-500 truncate">BLS: {r.blsTitle}</span>
                                )}
                            </span>
                            <span className="flex items-center gap-1 shrink-0">
                                {r.kind === 'kelley' && (
                                    <span className="text-[10px] uppercase tracking-wider text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20" title="Kelley role with published AI scores">Kelley</span>
                                )}
                                <span className="text-[9px] uppercase tracking-wider text-gray-500 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] max-w-[7.5rem] text-right leading-tight">{CONTINENT_DISPLAY_NAMES[r.continent]}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {isOpen && query.trim().length > 1 && matches.length === 0 && (
                <div className="absolute mt-2 w-full bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-3 text-gray-500 text-xs text-center" style={{ zIndex: Z.sidebar }}>
                    No jobs found
                </div>
            )}
        </div>
    );
};
