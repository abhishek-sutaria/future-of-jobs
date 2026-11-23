import React from 'react';
import { useWorldStore } from '../../worldStore';
import { IconCareerPaths } from '../ui/Icons';

/**
 * The small "Career paths" button on the role panels (JobDetailPanel,
 * OccupationPanel): opens the Career Paths view centred on this job. It only
 * opens a view of stored O*NET data, so it never starts a Claude call. The
 * ::after box makes the tap area 44px tall without making the row taller.
 */
export const OpenCareerPathsButton: React.FC<{ soc: string; roleKey?: string }> = ({ soc, roleKey }) => {
    const open = useWorldStore((s) => s.openCareerPaths);
    return (
        <button
            type="button"
            onClick={() => open(soc, roleKey ?? null)}
            data-testid="panel-career-paths"
            title="Career Paths: similar jobs you could move to (O*NET)"
            className="relative inline-flex items-center gap-1.5 px-2 py-0.5 min-h-[24px] rounded text-[10px] font-semibold uppercase tracking-wider text-cyan-200 bg-cyan-500/10 border border-cyan-400/20 hover:bg-cyan-500/20 hover:text-white transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']"
        >
            <IconCareerPaths size={12} aria-hidden="true" />
            Career paths
        </button>
    );
};
