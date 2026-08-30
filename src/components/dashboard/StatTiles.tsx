import React from 'react';
import { RadialGauge } from '../charts/RadialGauge';
import { IconBookmark, IconClock, IconAward } from '../ui/Icons';
import type { PortfolioStats } from '../../utils/dashboardSelectors';

const Tile: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; accent: string }> = ({
    icon, label, value, accent,
}) => (
    <div className="bg-white/[0.03] rounded-xl p-4 border border-white/[0.06] flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 ${accent}`}>
            {icon}
        </div>
        <div className="min-w-0">
            <div className="text-2xl font-bold text-white tabular-nums leading-none">{value}</div>
            <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider mt-1">{label}</div>
        </div>
    </div>
);

export const StatTiles: React.FC<{ stats: PortfolioStats }> = ({ stats }) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
            icon={<IconBookmark size={18} className="text-indigo-400" />}
            accent="bg-indigo-500/10 border-indigo-500/20"
            label="Saved roles"
            value={stats.savedCount}
        />
        <Tile
            icon={<IconClock size={18} className="text-cyan-400" />}
            accent="bg-cyan-500/10 border-cyan-500/20"
            label="Explored"
            value={stats.exploredCount}
        />
        <Tile
            icon={<IconAward size={18} className="text-amber-400" />}
            accent="bg-amber-500/10 border-amber-500/20"
            label="Trained"
            value={stats.trainedCount}
        />
        <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06] flex items-center justify-center">
            {stats.averageRisk !== null ? (
                <RadialGauge value={stats.averageRisk} label="Portfolio Risk" sublabel={`${stats.savedCount} saved roles`} size={88} />
            ) : (
                <div className="text-center py-2">
                    <div className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider">Portfolio Risk</div>
                    <div className="text-xs text-gray-600 italic mt-1">Save a scored role to see this</div>
                </div>
            )}
        </div>
    </div>
);
