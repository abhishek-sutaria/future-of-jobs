import React, { useMemo, useState, useCallback } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { scaleLinear } from 'd3-scale';
import { useStore } from '../store';
import { CLUSTER_COLORS, FALLBACK_COLORS } from '../config/theme';

// Low-res US state boundaries from the public us-atlas CDN
const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

interface TooltipState {
    x: number;
    y: number;
    name: string;
    totalJobs: number;
    jobs: Array<{ title: string; count: number; color: string }>;
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

    // Build per-state employment totals and breakdown
    const { stateData, maxEmployment, regionMarkers } = useMemo(() => {
        const byState: Record<string, {
            totalJobs: number;
            jobs: Array<{ title: string; count: number; color: string }>;
            coordinates: [number, number];
        }> = {};

        activeJobs.forEach((job, idx) => {
            if (!job.locations) return;
            const color = CLUSTER_COLORS[job.cluster] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
            job.locations.forEach((loc) => {
                if (!byState[loc.name]) {
                    byState[loc.name] = { totalJobs: 0, jobs: [], coordinates: [loc.lng, loc.lat] };
                }
                byState[loc.name].totalJobs += loc.employment;
                byState[loc.name].jobs.push({ title: job.title, count: loc.employment, color });
            });
        });

        const maxEmp = Math.max(...Object.values(byState).map((d) => d.totalJobs), 1);
        const markers = Object.entries(byState)
            .sort((a, b) => b[1].totalJobs - a[1].totalJobs)
            .slice(0, 15); // top 15 states get a circle marker

        return { stateData: byState, maxEmployment: maxEmp, regionMarkers: markers };
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
            if (!data) return;
            setTooltip({
                x: e.clientX,
                y: e.clientY,
                name: stateName,
                totalJobs: data.totalJobs,
                jobs: data.jobs.sort((a, b) => b.count - a.count),
            });
        },
        [stateData]
    );

    const handleStateMove = useCallback((e: React.MouseEvent) => {
        setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null));
    }, []);

    const handleStateLeave = useCallback(() => setTooltip(null), []);

    const isDefault = position.zoom === 1;

    return (
        <div className="w-full h-full bg-[#0f172a] relative overflow-hidden">
            {/* Reset view — small, conditional, only appears when zoomed/panned.
                Close Map lives in the Header beside the search bar. */}
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

            {/* Legend */}
            <div className="absolute bottom-6 left-6 z-10 flex flex-col gap-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Employment volume</p>
                <div className="flex items-center gap-2">
                    <div className="w-28 h-2.5 rounded-full" style={{ background: 'linear-gradient(to right, #1e293b, #0e7490)' }} />
                    <span className="text-[10px] text-gray-500">Low → High</span>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">Scroll to zoom · Drag to pan</p>
            </div>

            {/* Source */}
            <div className="absolute bottom-6 right-6 z-10 text-[10px] text-gray-600 font-mono">
                BLS OES May 2023
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
                                const fill = data ? fillScale(data.totalJobs) : '#1e293b';

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

                    {/* Circle markers for top states */}
                    {regionMarkers.map(([name, data]) => (
                        <Marker key={name} coordinates={data.coordinates}>
                            <circle
                                r={Math.max(3, Math.log(data.totalJobs / 1000 + 1) * 3)}
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
                    <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl w-52">
                        <div className="flex justify-between items-baseline border-b border-white/[0.06] pb-2 mb-2">
                            <span className="text-white text-xs font-bold truncate">{tooltip.name}</span>
                            <span className="text-cyan-400 text-[10px] font-mono ml-2 shrink-0">
                                {tooltip.totalJobs.toLocaleString()}
                            </span>
                        </div>
                        <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                            {tooltip.jobs.map((j, i) => (
                                <div key={i} className="flex justify-between items-center text-[10px]">
                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: j.color }} />
                                        <span className="text-gray-300 truncate max-w-[110px]">{j.title}</span>
                                    </div>
                                    <span className="text-gray-500 font-mono ml-2">{j.count.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
