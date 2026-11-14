import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { scaleLinear } from 'd3-scale';
import { useStore } from '../store';
import { useWorldStore } from '../worldStore';
import { useMapRolesInScope, mapRoleRows, type MapRole } from '../hooks/useMapRoles';
import { aggregateByState, type StateAggregate } from '../utils/mapAggregation';
import { MAP_SIDEBAR } from '../config/constants';
import { IconInfo } from './ui/Icons';

// Low-res US state boundaries from the public us-atlas CDN
const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

/**
 * A state where BLS publishes no number for any selected job (it marks the
 * estimate "**" or lists no row): a flat neutral grey, apart from the
 * slate-to-cyan employment scale, so "no data" never reads as "few workers".
 */
export const NO_DATA_FILL = '#3f3f46';

// Maximum number of states that receive a circle marker (top by employment).
// States beyond this still receive choropleth fill — only the marker labels are capped.
const MARKER_CAP = 15;

interface TooltipState {
    x: number;
    y: number;
    name: string;
    totalEmployment: number;
    bySoc: Array<{
        soc: string;
        titles: string[];
        employment: number;
        lq: number | null;
    }>;
    hasData: boolean;
}

export const MapView: React.FC = () => {
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    // Every job in the open field, family or (at the world) all fields, Kelley
    // or not; each field's BLS state rows load as the map needs them.
    const { roles, loading, failed } = useMapRolesInScope();
    const stateMapFields = useWorldStore((s) => s.stateMapFields);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [position, setPosition] = useState<{ coordinates: [number, number]; zoom: number }>({
        coordinates: [-97, 38],
        zoom: 1,
    });

    // Same filter contract as the task view: an empty selection, or one made
    // for roles outside this scope, means every role in scope.
    const activeRoles = useMemo(() => {
        const picked = roles.filter((r) => selectedRoleIds.has(r.id));
        return picked.length === 0 ? roles : picked;
    }, [roles, selectedRoleIds]);

    // Build per-state employment totals, de-duped by SOC code so alias titles
    // (e.g. Marketing Manager + Brand Manager → 11-2021) don't double-count.
    const { stateData, maxEmployment, regionMarkers, pending, noData } = useMemo(() => {
        const items = activeRoles.map((r) => ({ title: r.title, soc: r.soc, locations: mapRoleRows(r) }));
        const { stateData: sd, maxEmployment: maxEmp } = aggregateByState(items);

        // Top MARKER_CAP states by employment get circle labels
        const markers = Object.entries(sd)
            .sort((a, b) => b[1].totalEmployment - a[1].totalEmployment)
            .slice(0, MARKER_CAP);

        const waiting = items.some((i) => i.locations === undefined);
        return {
            stateData: sd,
            maxEmployment: maxEmp,
            regionMarkers: markers,
            pending: waiting,
            // Every active job is loaded and BLS publishes no state row for any of them.
            noData: !waiting && items.length > 0 && items.every((i) => i.locations!.length === 0),
        };
        // stateMapFields: a field's rows arriving changes what mapRoleRows returns.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRoles, stateMapFields]);

    // Cyan-tinted fill scale: dark slate → deep cyan
    const fillScale = useMemo(
        () => scaleLinear<string>().domain([0, maxEmployment]).range(['#1e293b', '#0e7490']).clamp(true),
        [maxEmployment]
    );

    const handleMoveEnd = useCallback(
        (pos: { coordinates: [number, number]; zoom: number }) => setPosition(pos),
        []
    );

    const showStateInfo = useCallback(
        (clientX: number, clientY: number, stateName: string) => {
            const data = stateData[stateName];
            setTooltip({
                x: clientX,
                y: clientY,
                name: stateName,
                totalEmployment: data?.totalEmployment ?? 0,
                bySoc: data?.bySoc ?? [],
                hasData: !!data,
            });
        },
        [stateData],
    );

    const handleStateEnter = useCallback(
        (e: React.MouseEvent, stateName: string) => {
            showStateInfo(e.clientX, e.clientY, stateName);
        },
        [showStateInfo],
    );

    const handleStateMove = useCallback((e: React.MouseEvent) => {
        setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null));
    }, []);

    const handleStateLeave = useCallback(() => setTooltip(null), []);

    const handleStatePointerUp = useCallback(
        (e: React.PointerEvent, stateName: string) => {
            // Touch / pen: mouseenter often never fires on mobile Chrome.
            if (e.pointerType === 'mouse') return;
            showStateInfo(e.clientX, e.clientY, stateName);
        },
        [showStateInfo],
    );

    // Clear stuck tooltip: blur/visibility (mouseleave can drop mid-hover),
    // Escape, and any pointer on the map that is not a state Geography
    // (touch tooltips otherwise linger after the finger lifts).
    useEffect(() => {
        const clear = () => setTooltip(null);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') clear();
        };
        window.addEventListener('blur', clear);
        document.addEventListener('visibilitychange', clear);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('blur', clear);
            document.removeEventListener('visibilitychange', clear);
            window.removeEventListener('keydown', onKey);
        };
    }, []);

    const handleMapBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
        // State Geographies are <path>; anything else (ocean, markers, chrome)
        // dismisses a sticky touch tooltip.
        const el = e.target as Element | null;
        if (el?.tagName === 'path') return;
        setTooltip(null);
    }, []);

    const defaultCenter: [number, number] = [-97, 38];
    const panMoved =
        Math.hypot(position.coordinates[0] - defaultCenter[0], position.coordinates[1] - defaultCenter[1]) > 0.35;
    const isDefault = position.zoom === 1 && !panMoved;

    // BLS publishes no state data for the selected job(s): say so, not a blank map.
    if (noData && failed.length === 0) return <NoStateDataNote roles={activeRoles} />;

    return (
        <div
            className="w-full h-full bg-[#0f172a] relative overflow-hidden"
            onPointerDown={handleMapBackgroundPointerDown}
        >
            {/* Reset view — small, conditional, only appears when zoomed/panned */}
            {!isDefault && (
                <div className="absolute top-32 right-6 z-50">
                    <button
                        onClick={() => setPosition({ coordinates: defaultCenter, zoom: 1 })}
                        className="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-gray-400 hover:text-white rounded-lg border border-white/[0.07] text-xs transition-colors"
                    >
                        Reset view
                    </button>
                </div>
            )}

            {/* Legend. Hidden below md, matching Legend.tsx's own precedent for
                the 3D view: at 390px there's no room left in the bottom band
                once the Sources/Methodology button (visible in every view,
                UI.tsx) is accounted for, and colour/circle size are already
                explained in the Methodology modal that button opens.
                Offset by MAP_SIDEBAR.CLEARANCE_PX so RoleSelector's desktop
                sidebar (only ever rendered at the same md+ widths this is
                visible at) doesn't cover it — confirmed live it always has,
                on every desktop width, until now. */}
            <div
                className="hidden md:flex absolute bottom-6 z-10 flex-col gap-2"
                style={{ left: MAP_SIDEBAR.CLEARANCE_PX }}
            >
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Employment volume</p>
                <div className="flex items-center gap-2">
                    <div className="w-28 h-2.5 rounded-full" style={{ background: 'linear-gradient(to right, #1e293b, #0e7490)' }} />
                    <span className="text-[10px] text-gray-500">Low → High</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: NO_DATA_FILL }} />
                    <span className="text-[10px] text-gray-500">No data from BLS</span>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">
                    Circle labels: top {MARKER_CAP} states &middot; Scroll to zoom &middot; Drag to pan
                </p>
            </div>

            {/* A field's BLS state rows are still on their way (or failed). */}
            {(pending || failed.length > 0) && <StateDataStatus loading={pending && loading} failed={failed} />}

            {/* Source attribution — decorative, and redundant with the
                interactive Sources button (UI.tsx) which the legend above
                also defers to; hidden on mobile for the same reason. */}
            <div className="hidden md:block absolute bottom-6 right-6 z-10 text-[10px] text-gray-600 font-mono">
                BLS OEWS May 2025 · Aggregated by SOC code
            </div>

            {/* Composable US Map */}
            <ComposableMap
                projection="geoAlbersUsa"
                style={{ width: '100%', height: '100%' }}
            >
                <ZoomableGroup
                    zoom={position.zoom}
                    center={position.coordinates}
                    onMoveEnd={handleMoveEnd}
                    minZoom={0.8}
                    maxZoom={10}
                >
                    <Geographies geography={GEO_URL}>
                        {({ geographies }) =>
                            geographies.map((geo) => {
                                const stateName: string = geo.properties.name;
                                const data = stateData[stateName];
                                // Grey only once every selected job's rows are in: while a
                                // field is still loading, "no data yet" is not "no data".
                                const fill = data ? fillScale(data.totalEmployment) : pending ? '#1e293b' : NO_DATA_FILL;

                                return (
                                    <Geography
                                        key={geo.rsmKey}
                                        geography={geo}
                                        fill={fill}
                                        stroke="#334155"
                                        strokeWidth={0.6}
                                        style={{
                                            default: { outline: 'none', transition: 'fill 150ms' },
                                            hover: { fill: '#0891b2', outline: 'none', cursor: 'pointer' },
                                            pressed: { outline: 'none' },
                                        }}
                                        onMouseEnter={(e) => handleStateEnter(e, stateName)}
                                        onMouseMove={handleStateMove}
                                        onMouseLeave={handleStateLeave}
                                        onPointerUp={(e) => handleStatePointerUp(e, stateName)}
                                    />
                                );
                            })
                        }
                    </Geographies>

                    {/* Circle markers for top MARKER_CAP states */}
                    {regionMarkers.map(([name, data]) => (
                        <Marker key={name} coordinates={data.coordinates}>
                            <circle
                                r={Math.max(3, Math.log(data.totalEmployment / 1000 + 1) * 3)}
                                fill="rgba(8,145,178,0.25)"
                                stroke="rgba(8,145,178,0.6)"
                                strokeWidth={0.8}
                            />
                            <text
                                textAnchor="middle"
                                y={-8}
                                style={{ fill: '#94a3b8', fontSize: 6, fontWeight: 600, pointerEvents: 'none' }}
                            >
                                {name.length > 12 ? name.split(' ')[0] : name}
                            </text>
                        </Marker>
                    ))}
                </ZoomableGroup>
            </ComposableMap>

            {/* Hover tooltip — follows cursor */}
            {tooltip && (
                <div
                    className="fixed z-[500] pointer-events-none"
                    style={{ top: tooltip.y + 12, left: tooltip.x + 12 }}
                >
                    <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl w-60">
                        <div className="flex justify-between items-baseline border-b border-white/[0.06] pb-2 mb-2">
                            <span className="text-white text-xs font-bold truncate">{tooltip.name}</span>
                            {tooltip.hasData ? (
                                <span className="text-cyan-400 text-[10px] font-mono ml-2 shrink-0">
                                    {tooltip.totalEmployment.toLocaleString()}
                                </span>
                            ) : (
                                <span className="text-gray-600 text-[10px] ml-2 shrink-0">no data</span>
                            )}
                        </div>

                        {tooltip.hasData ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                <TooltipRows bySoc={tooltip.bySoc} />
                                <p className="text-[8px] text-gray-700 border-t border-white/[0.04] pt-1.5 mt-1.5">
                                    BLS OEWS May 2025 · TOT_EMP by SOC
                                </p>
                            </div>
                        ) : (
                            <p className="text-[10px] text-gray-600 italic">
                                {pending ? 'Loading BLS state data…' : 'No data from BLS for the selected roles in this state.'}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * The tooltip's per-occupation rows. Memoised on the state's bySoc list, so
 * following the cursor (which only moves the box) does not re-render a list
 * that can hold hundreds of jobs when a whole field or the world is shown.
 */
const TooltipRows = React.memo(function TooltipRows({ bySoc }: { bySoc: StateAggregate['bySoc'] }) {
    return (
        <>
            {bySoc.map((entry) => (
                <div key={entry.soc} className="space-y-0.5">
                    <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-gray-300 truncate max-w-[140px]">
                            {entry.titles.length > 1
                                ? `${entry.titles[0]} +${entry.titles.length - 1}`
                                : entry.titles[0]}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono ml-2 shrink-0">
                            {entry.employment.toLocaleString()}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 pl-0.5">
                        <span className="text-[9px] text-gray-600 font-mono">{entry.soc}</span>
                        {entry.lq !== null && entry.lq > 0 && (
                            <span
                                className={`text-[9px] font-mono ${
                                    entry.lq >= 1.5
                                        ? 'text-cyan-500'
                                        : entry.lq >= 1.0
                                        ? 'text-gray-400'
                                        : 'text-gray-600'
                                }`}
                                title="BLS Location Quotient — ratio of this occupation's share of state employment to its national share. >1 = concentration above national average."
                            >
                                LQ {entry.lq.toFixed(2)}
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </>
    );
});

/** Small status line while a field's state rows load, or if they could not. */
function StateDataStatus({ loading, failed }: { loading: boolean; failed: string[] }) {
    const retry = () => {
        useWorldStore.setState((s) => {
            const errors = { ...s.stateMapErrors };
            for (const code of failed) delete errors[code];
            return { stateMapErrors: errors };
        });
    };
    return (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-20" role="status" data-testid="state-data-status">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900/90 border border-white/[0.08] text-[11px] text-gray-400 shadow-lg">
                {failed.length > 0 ? (
                    <>
                        <span>Could not load some BLS state data.</span>
                        <button type="button" onClick={retry} className="text-cyan-400 hover:text-cyan-300 font-semibold">Retry</button>
                    </>
                ) : (
                    <span>{loading ? 'Loading BLS state data…' : 'Loading…'}</span>
                )}
            </div>
        </div>
    );
}

/**
 * Shown instead of the map when every selected job is one BLS publishes no
 * state data for (5 of the 830, docs/state-map.md): a clear message, not a
 * blank map.
 */
function NoStateDataNote({ roles }: { roles: MapRole[] }) {
    const clearAllRoles = useStore((s) => s.clearAllRoles);
    const one = roles.length === 1;
    const names = roles.map((r) => r.title).join(', ');
    return (
        <div className="absolute inset-0 flex items-center justify-center p-5" style={{ background: 'radial-gradient(circle at 50% 0%, #111b2b 0%, #0a0e17 70%)' }} data-testid="no-state-data">
            <div className="max-w-md w-full bg-gray-900/80 backdrop-blur-xl border border-cyan-400/25 rounded-2xl p-5 md:p-6 shadow-lg" role="status">
                <div className="flex items-center gap-2 mb-2">
                    <IconInfo size={16} className="text-cyan-400" />
                    <h2 className="text-white font-semibold">BLS publishes no state data for {one ? 'this job' : 'these jobs'}</h2>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">
                    {names}: the BLS state file (OEWS May 2025) gives no employment for {one ? 'it' : 'them'} in any state, so there is nothing to draw. The national figures are on {one ? 'its' : 'each'} role page.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                    <button
                        type="button"
                        onClick={clearAllRoles}
                        className="px-3 py-2 min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold uppercase tracking-wider"
                    >
                        Show all roles
                    </button>
                </div>
            </div>
        </div>
    );
}
