import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { scaleLinear } from 'd3-scale';
import { useStore } from '../store';
import { aggregateByState } from '../utils/mapAggregation';
import { MAP_SIDEBAR } from '../config/constants';

// Low-res US state boundaries from the public us-atlas CDN
const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

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
    const jobs = useStore((state) => state.jobs);
    const selectedRoleIds = useStore((state) => state.selectedRoleIds);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [position, setPosition] = useState<{ coordinates: [number, number]; zoom: number }>({
        coordinates: [-97, 38],
        zoom: 1,
    });

    const activeJobs = useMemo(() => {
        if (selectedRoleIds.size === 0) return jobs;
        return jobs.filter((j) => selectedRoleIds.has(j.id));
    }, [jobs, selectedRoleIds]);

    // Build per-state employment totals, de-duped by SOC code so alias titles
    // (e.g. Marketing Manager + Brand Manager → 11-2021) don't double-count.
    const { stateData, maxEmployment, regionMarkers } = useMemo(() => {
        const { stateData: sd, maxEmployment: maxEmp } = aggregateByState(activeJobs);

        // Top MARKER_CAP states by employment get circle labels
        const markers = Object.entries(sd)
            .sort((a, b) => b[1].totalEmployment - a[1].totalEmployment)
            .slice(0, MARKER_CAP);

        return { stateData: sd, maxEmployment: maxEmp, regionMarkers: markers };
    }, [activeJobs]);

    // Cyan-tinted fill scale: dark slate → deep cyan
    const fillScale = useMemo(
        () => scaleLinear<string>().domain([0, maxEmployment]).range(['#1e293b', '#0e7490']).clamp(true),
        [maxEmployment]
    );

    const handleMoveEnd = useCallback(
        (pos: { coordinates: [number, number]; zoom: number }) => setPosition(pos),
        []
    );

    const handleStateEnter = useCallback(
        (e: React.MouseEvent, stateName: string) => {
            const data = stateData[stateName];
            setTooltip({
                x: e.clientX,
                y: e.clientY,
                name: stateName,
                totalEmployment: data?.totalEmployment ?? 0,
                bySoc: data?.bySoc ?? [],
                hasData: !!data,
            });
        },
        [stateData]
    );

    const handleStateMove = useCallback((e: React.MouseEvent) => {
        setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null));
    }, []);

    const handleStateLeave = useCallback(() => setTooltip(null), []);

    // Clear stuck tooltip when the window loses focus (mouseleave can be dropped mid-hover)
    useEffect(() => {
        const clear = () => setTooltip(null);
        window.addEventListener('blur', clear);
        document.addEventListener('visibilitychange', clear);
        return () => {
            window.removeEventListener('blur', clear);
            document.removeEventListener('visibilitychange', clear);
        };
    }, []);

    const isDefault = position.zoom === 1;

    return (
        <div className="w-full h-full bg-[#0f172a] relative overflow-hidden">
            {/* Reset view — small, conditional, only appears when zoomed/panned */}
            {!isDefault && (
                <div className="absolute top-32 right-6 z-50">
                    <button
                        onClick={() => setPosition({ coordinates: [-97, 38], zoom: 1 })}
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
                <p className="text-[10px] text-gray-600 mt-1">
                    Circle labels: top {MARKER_CAP} states &middot; Scroll to zoom &middot; Drag to pan
                </p>
            </div>

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
                                const fill = data ? fillScale(data.totalEmployment) : '#1e293b';

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
                                {tooltip.bySoc.map((entry) => (
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
                                <p className="text-[8px] text-gray-700 border-t border-white/[0.04] pt-1.5 mt-1.5">
                                    BLS OEWS May 2025 · TOT_EMP by SOC
                                </p>
                            </div>
                        ) : (
                            <p className="text-[10px] text-gray-600 italic">
                                No BLS OES data for selected roles in this state.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
