import React from 'react';
import { CHART } from '../../config/constants';

interface SparklineProps {
    data: number[];
    color?: string;
    width?: number;
    height?: number;
    label?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
    data,
    color = CHART.SPARKLINE.DEFAULT_COLOR,
    width = CHART.SPARKLINE.WIDTH,
    height = CHART.SPARKLINE.HEIGHT,
    label
}) => {
    if (!data || data.length < 2) return null;

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    // Scale points to fit SVG constraints
    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((d - min) / range) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="flex flex-col items-center justify-center">
            <svg width={width} height={height} className="overflow-visible">
                {/* Line */}
                <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    points={points}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="drop-shadow-[0_0_4px_rgba(34,211,238,0.5)]"
                />
                {/* End Dot */}
                <circle
                    cx={(data.length - 1) * (width / (data.length - 1))} // Last X
                    cy={height - ((data[data.length - 1] - min) / range) * height} // Last Y
                    r="3"
                    fill={color}
                    className="animate-pulse"
                />
            </svg>
            {label && <span className="text-[10px] text-gray-400 mt-2 font-mono uppercase tracking-widest">{label}</span>}
        </div>
    );
};
