import React, { useMemo } from 'react';
import * as d3 from 'd3';
import type { Task } from '../../types';
import { getTaskCategory } from '../../data';
import { CHART, TASK_CATEGORY_COLORS } from '../../config/constants';

interface TaskCompositionChartProps {
    tasks: Task[];
}

export const TaskCompositionChart: React.FC<TaskCompositionChartProps> = ({ tasks }) => {
    const { WIDTH: width, HEIGHT: height } = CHART.TASK_COMPOSITION;

    const segments = useMemo(() => {
        const counts = { 'Automatable': 0, 'Augmentable': 0, 'Human-Critical': 0 } as Record<string, number>;
        tasks.forEach(task => { counts[getTaskCategory(task)]++; });

        const total = tasks.length;
        const xScale = d3.scaleLinear().domain([0, total]).range([0, width]);

        const data = [
            { label: 'Automatable', value: counts['Automatable'], color: TASK_CATEGORY_COLORS['Automatable'] },
            { label: 'Augmentable', value: counts['Augmentable'], color: TASK_CATEGORY_COLORS['Augmentable'] },
            { label: 'Human-Critical', value: counts['Human-Critical'], color: TASK_CATEGORY_COLORS['Human-Critical'] },
        ];

        let currentX = 0;
        return data.filter(d => d.value > 0).map(d => {
            const barWidth = xScale(d.value);
            const seg = { ...d, x: currentX, width: barWidth, showLabel: barWidth > 50 };
            currentX += barWidth;
            return seg;
        });
    }, [tasks]);

    return (
        <div className="w-full">
            <h4 className="text-xs uppercase text-gray-500 mb-1">Task Composition</h4>
            <svg width="100%" height="40" viewBox="0 0 300 40" className="w-full rounded overflow-hidden bg-gray-800">
                {segments.map((seg, i) => (
                    <g key={i}>
                        <rect
                            x={seg.x} y={0} width={seg.width} height={height}
                            fill={seg.color} rx={4} stroke="#1f2937" strokeWidth={2}
                        />
                        {seg.showLabel && (
                            <text
                                x={seg.x + seg.width / 2} y={height / 2} dy="0.35em"
                                textAnchor="middle" fill="white" fontSize={10} fontWeight="bold"
                            >
                                {seg.label}
                            </text>
                        )}
                    </g>
                ))}
            </svg>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Automated</span>
                <span>Augmented</span>
                <span>Human</span>
            </div>
        </div>
    );
};
