import React from 'react';
import { CHART } from '../../config/constants';
import { CHART_COLORS } from '../../config/theme';
import { percentOf } from '../../utils/scoreRounding';

interface RadialGaugeProps {
    value: number; // 0 to 1
    label: string;
    sublabel?: string;
    size?: number;
    /** Ring colour. The dashboard passes the map's own band colour (utils/roleScale bandFor), so it matches the hills. */
    color: string;
}

export const RadialGauge: React.FC<RadialGaugeProps> = ({ value, label, sublabel, size = CHART.RADIAL_GAUGE.SIZE, color }) => {
    const strokeWidth = CHART.RADIAL_GAUGE.STROKE_WIDTH;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - value * circumference;

    return (
        <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                {/* Background Circle */}
                <circle
                    stroke={CHART_COLORS.grid}
                    strokeWidth={strokeWidth}
                    fill="transparent"
                    r={radius}
                    cx={size / 2}
                    cy={size / 2}
                />
                {/* Progress Circle */}
                <circle
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${circumference} ${circumference}`}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    fill="transparent"
                    r={radius}
                    cx={size / 2}
                    cy={size / 2}
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold text-white drop-shadow-md">
                    {percentOf(value)}%
                </span>
                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold mt-1">
                    {label}
                </span>
                {sublabel && (
                    <span className="text-[9px] text-gray-500 mt-0.5">
                        {sublabel}
                    </span>
                )}
            </div>
        </div>
    );
};
