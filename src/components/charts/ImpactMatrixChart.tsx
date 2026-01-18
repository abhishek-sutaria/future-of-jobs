import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { Task } from '../../types';

interface ImpactMatrixChartProps {
    tasks: Task[];
    year: number;
}

export const ImpactMatrixChart: React.FC<ImpactMatrixChartProps> = ({ tasks, year }) => {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!svgRef.current) return;

        const width = 300;
        const height = 220; // Increased height
        const margin = { top: 20, right: 20, bottom: 40, left: 40 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // Scales
        const xScale = d3.scaleLinear().domain([0, 1]).range([0, innerWidth]);
        const yScale = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);

        // Background Intelligence Zones
        // Safe Zone (High Human, Low AI)
        g.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', xScale(0.5))
            .attr('height', yScale(0.5))
            .attr('fill', '#22c55e')
            .attr('opacity', 0.05);

        // Danger Zone (Low Human, High AI)
        g.append('rect')
            .attr('x', xScale(0.5))
            .attr('y', yScale(0.5))
            .attr('width', xScale(1) - xScale(0.5))
            .attr('height', yScale(0))
            .attr('fill', '#ef4444')
            .attr('opacity', 0.05);

        // Axes with Gridlines
        const xAxis = d3.axisBottom(xScale).ticks(3).tickSize(-innerHeight);
        const yAxis = d3.axisLeft(yScale).ticks(3).tickSize(-innerWidth);

        g.append('g')
            .attr('transform', `translate(0,${innerHeight})`)
            .call(xAxis)
            .selectAll('line')
            .attr('stroke', '#374151') // gray-700
            .attr('stroke-dasharray', '2,2');

        g.append('g')
            .call(yAxis)
            .selectAll('line')
            .attr('stroke', '#374151')
            .attr('stroke-dasharray', '2,2');

        g.selectAll('.domain').attr('stroke', '#4b5563');
        g.selectAll('text').attr('fill', '#9ca3af').style('font-size', '10px');

        // Axis Labels
        g.append('text')
            .attr('x', innerWidth / 2)
            .attr('y', innerHeight + 30)
            .attr('fill', '#9ca3af')
            .style('font-size', '10px')
            .style('text-anchor', 'middle')
            .style('text-transform', 'uppercase')
            .text('AI Capability (Automation Risk)');

        g.append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -innerHeight / 2)
            .attr('y', -30)
            .attr('fill', '#9ca3af')
            .style('font-size', '10px')
            .style('text-anchor', 'middle')
            .style('text-transform', 'uppercase')
            .text('Human Criticality');

        // Data Points
        const points = tasks.map(t => {
            const yearsPassed = year - 2025;
            const currentAi = Math.min(1, t.aiCapabilityScore + (yearsPassed * 0.02)); // AI Grows
            return { ...t, currentAi };
        });

        g.selectAll('circle')
            .data(points)
            .enter()
            .append('circle')
            .attr('cx', d => xScale(d.currentAi))
            .attr('cy', d => yScale(d.humanCriticalityScore))
            .attr('r', 6)
            .attr('fill', d => d.humanCriticalityScore > 0.6 ? '#22c55e' : (d.currentAi > 0.7 ? '#ef4444' : '#eab308'))
            .attr('stroke', '#111827')
            .attr('stroke-width', 1.5)
            .attr('opacity', 0.9)
            .append('title')
            .text(d => `${d.name}`);

    }, [tasks, year]);

    return (
        <div className="w-full flex justify-center">
            <svg ref={svgRef} width="100%" height="220" viewBox="0 0 300 220" style={{ maxWidth: '350px' }} />
        </div>
    );
};
