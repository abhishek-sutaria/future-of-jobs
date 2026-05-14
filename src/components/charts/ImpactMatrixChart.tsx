import React, { useMemo } from 'react';
import * as d3 from 'd3';
import type { Task } from '../../types';
import { VISUALIZATION_THRESHOLDS } from '../../config/GameMechanics';
import { RISK_THRESHOLDS, CHART } from '../../config/constants';
import { CHART_COLORS } from '../../config/theme';

interface ImpactMatrixChartProps {
    tasks: Task[];
}

export const ImpactMatrixChart: React.FC<ImpactMatrixChartProps> = ({ tasks }) => {
    const { WIDTH: width, HEIGHT: height, MARGIN: margin } = CHART.IMPACT_MATRIX;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const xScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([0, innerWidth]), [innerWidth]);
    const yScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]), [innerHeight]);

    const xTicks = useMemo(() => xScale.ticks(3), [xScale]);
    const yTicks = useMemo(() => yScale.ticks(3), [yScale]);

    const points = useMemo(() => {
        return tasks.map(t => {
            const currentAi = Math.min(1, t.aiCapabilityScore);
            const color = t.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE ? CHART_COLORS.success : (currentAi > RISK_THRESHOLDS.PROJECTED_HIGH_RISK_AI ? CHART_COLORS.danger : CHART_COLORS.warning);
            return { name: t.name, cx: xScale(currentAi), cy: yScale(t.humanCriticalityScore), color };
        });
    }, [tasks, xScale, yScale]);

    return (
        <div className="w-full flex justify-center">
            <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: '350px' }}>
                <g transform={`translate(${margin.left},${margin.top})`}>
                    {/* Safe Zone */}
                    <rect
                        x={0} y={0}
                        width={xScale(VISUALIZATION_THRESHOLDS.SAFE_ZONE_MIN_HUMAN_SCORE)}
                        height={yScale(VISUALIZATION_THRESHOLDS.SAFE_ZONE_MIN_HUMAN_SCORE)}
                        fill={CHART_COLORS.success} opacity={0.05}
                    />
                    {/* Danger Zone */}
                    <rect
                        x={xScale(VISUALIZATION_THRESHOLDS.DANGER_ZONE_MIN_AI_SCORE)}
                        y={yScale(VISUALIZATION_THRESHOLDS.DANGER_ZONE_MIN_AI_SCORE)}
                        width={xScale(1) - xScale(VISUALIZATION_THRESHOLDS.DANGER_ZONE_MIN_AI_SCORE)}
                        height={yScale(0)}
                        fill={CHART_COLORS.danger} opacity={0.05}
                    />

                    {/* X-axis gridlines */}
                    {xTicks.map(t => (
                        <g key={`x-${t}`} transform={`translate(${xScale(t)},0)`}>
                            <line y1={0} y2={innerHeight} stroke={CHART_COLORS.grid} strokeDasharray="2,2" />
                            <text y={innerHeight + 14} fill={CHART_COLORS.text} fontSize={10} textAnchor="middle">{t}</text>
                        </g>
                    ))}

                    {/* Y-axis gridlines */}
                    {yTicks.map(t => (
                        <g key={`y-${t}`} transform={`translate(0,${yScale(t)})`}>
                            <line x1={0} x2={innerWidth} stroke={CHART_COLORS.grid} strokeDasharray="2,2" />
                            <text x={-8} fill={CHART_COLORS.text} fontSize={10} textAnchor="end" dominantBaseline="middle">{t}</text>
                        </g>
                    ))}

                    {/* Axes */}
                    <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke={CHART_COLORS.grid} />
                    <line x1={0} y1={0} x2={0} y2={innerHeight} stroke={CHART_COLORS.grid} />

                    {/* X label */}
                    <text x={innerWidth / 2} y={innerHeight + 30} fill={CHART_COLORS.text} fontSize={10} textAnchor="middle" style={{ textTransform: 'uppercase' }}>
                        AI Capability (Automation Risk)
                    </text>
                    {/* Y label */}
                    <text transform="rotate(-90)" x={-innerHeight / 2} y={-30} fill={CHART_COLORS.text} fontSize={10} textAnchor="middle" style={{ textTransform: 'uppercase' }}>
                        Human Criticality
                    </text>

                    {/* Data Points */}
                    {points.map((p, i) => (
                        <circle key={i} cx={p.cx} cy={p.cy} r={6} fill={p.color} stroke="#111827" strokeWidth={1.5} opacity={0.9}>
                            <title>{p.name}</title>
                        </circle>
                    ))}
                </g>
            </svg>
        </div>
    );
};
