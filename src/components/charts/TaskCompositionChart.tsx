import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { Task } from '../../types';
import { getTaskCategory, type TaskCategory } from '../../data';

interface TaskCompositionChartProps {
    tasks: Task[];
    year: number;
}

export const TaskCompositionChart: React.FC<TaskCompositionChartProps> = ({ tasks, year }) => {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!svgRef.current) return;

        // 1. Data Prep
        const counts: Record<TaskCategory, number> = {
            'Automatable': 0,
            'Augmentable': 0,
            'Human-Critical': 0
        };

        tasks.forEach(task => {
            const cat = getTaskCategory(task, year);
            counts[cat]++;
        });

        const total = tasks.length;
        const data = [
            { label: 'Automatable', value: counts['Automatable'], color: '#ef4444' }, // red
            { label: 'Augmentable', value: counts['Augmentable'], color: '#3b82f6' }, // blue
            { label: 'Human-Critical', value: counts['Human-Critical'], color: '#22c55e' } // green
        ];

        // 2. Setup Dimensions
        const width = 300;
        const height = 40;
        // const margin = { left: 0, right: 0, top: 0, bottom: 0 };

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); // Clear previous render

        // 3. xScale
        const xScale = d3.scaleLinear()
            .domain([0, total])
            .range([0, width]);

        // 4. Draw Bars
        let currentX = 0;

        // Animate width? simpler to just redraw on year change for "stepped" animation effect since year is 0.1 increments
        data.forEach(d => {
            const barWidth = xScale(d.value);
            if (barWidth > 0) {
                svg.append('rect')
                    .attr('x', currentX)
                    .attr('y', 0)
                    .attr('width', barWidth)
                    .attr('height', height)
                    .attr('fill', d.color)
                    .attr('rx', 4) // rounded corners logic is tricky for stacked- maybe just first/last? simple for now.
                    .attr('stroke', '#1f2937') // gap color
                    .attr('stroke-width', 2);

                // Label if space permits
                if (barWidth > 50) {
                    svg.append('text')
                        .attr('x', currentX + barWidth / 2)
                        .attr('y', height / 2)
                        .attr('dy', '0.35em')
                        .attr('text-anchor', 'middle')
                        .attr('fill', 'white')
                        .style('font-size', '10px')
                        .style('font-weight', 'bold')
                        .text(d.value > 0 ? d.label : '');
                }

                currentX += barWidth;
            }
        });

    }, [tasks, year]);

    return (
        <div className="w-full">
            <h4 className="text-xs uppercase text-gray-500 mb-1">Task Composition</h4>
            <svg ref={svgRef} width="100%" height="40" viewBox="0 0 300 40" className="w-full rounded overflow-hidden bg-gray-800" />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Automated</span>
                <span>Augmented</span>
                <span>Human</span>
            </div>
        </div>
    );
};
