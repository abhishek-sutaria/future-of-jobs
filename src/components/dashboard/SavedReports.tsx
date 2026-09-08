import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Empty } from '../ui/EmptyState';
import { IconSparkles, IconTarget, IconRocket, IconShield } from '../ui/Icons';
import type { StoredArtifact, ArtifactKind } from '../../lib/userData';
import type { ResumeAnalysisResult, StartupIdeasResult, ScenarioResult, RoadmapResult } from '../../utils/analysis';
import { summarizeArtifacts } from '../../utils/dashboardSelectors';
import { reportToMarkdown, reportFilename } from '../../utils/reportExport';
import { ScenarioReport } from '../reports/ScenarioReport';
import { RoadmapReport } from '../reports/RoadmapReport';
import { SkillsReport } from '../reports/SkillsReport';
import { StartupIdeasReport } from '../reports/StartupIdeasReport';

const KIND_META: Record<ArtifactKind, { label: string; icon: React.ReactNode; color: string }> = {
    scenario: { label: 'Day in the Life', icon: <IconSparkles size={13} />, color: 'text-violet-300 border-violet-500/25 bg-violet-500/[0.06]' },
    roadmap: { label: 'Career Roadmap', icon: <IconTarget size={13} />, color: 'text-blue-300 border-blue-500/25 bg-blue-500/[0.06]' },
    startup_ideas: { label: 'Startup Ideas', icon: <IconRocket size={13} />, color: 'text-amber-300 border-amber-500/25 bg-amber-500/[0.06]' },
    skills_analysis: { label: 'Skills Analysis', icon: <IconShield size={13} />, color: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.06]' },
};

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Every kind renders here, in full. Previously scenario/roadmap navigated the
 * user out of the dashboard to the map, and startup_ideas rendered only each
 * idea's name and summary — so most of a saved report was unreachable from the
 * place it was saved. Ray asked whether these can be viewed, printed or
 * downloaded from the dashboard; this is the "viewed" half.
 */
const ReportDetail: React.FC<{ artifact: StoredArtifact }> = ({ artifact }) => {
    switch (artifact.kind) {
        case 'scenario':
            return <ScenarioReport result={artifact.payload as ScenarioResult} />;
        case 'roadmap':
            return <RoadmapReport result={artifact.payload as RoadmapResult} />;
        case 'skills_analysis':
            return <SkillsReport result={artifact.payload as ResumeAnalysisResult} />;
        case 'startup_ideas':
            return <StartupIdeasReport result={artifact.payload as StartupIdeasResult} />;
    }
};

function downloadMarkdown(artifact: StoredArtifact): void {
    const blob = new Blob([reportToMarkdown(artifact)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFilename(artifact);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

interface SavedReportsProps {
    artifacts: StoredArtifact[];
    onOpenJob: (jobId: string, jobTitle: string) => void;
}

export const SavedReports: React.FC<SavedReportsProps> = ({ artifacts, onOpenJob }) => {
    const [viewing, setViewing] = useState<StoredArtifact | null>(null);
    const summaries = summarizeArtifacts(artifacts);

    if (artifacts.length === 0) {
        return (
            <Empty>
                Scenarios and roadmaps are saved automatically when you generate them. Startup Ideas
                and Skills analyses are saved only when you choose to.
            </Empty>
        );
    }

    return (
        <>
            <div className="grid sm:grid-cols-2 gap-3">
                {artifacts.map((artifact) => {
                    const meta = KIND_META[artifact.kind];
                    const summary = summaries.find((s) => s.id === artifact.id);
                    const isRoleBased = artifact.kind === 'scenario' || artifact.kind === 'roadmap';
                    return (
                        <div
                            key={artifact.id}
                            className="text-left bg-white/[0.02] border border-white/[0.06] hover:border-white/15 rounded-xl p-4 transition-colors"
                        >
                        <button onClick={() => setViewing(artifact)} className="text-left w-full">
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${meta.color}`}>
                                    {meta.icon} {meta.label}
                                </span>
                                <span className="text-[10px] text-gray-600 tabular-nums shrink-0">{formatDate(artifact.updatedAt)}</span>
                            </div>
                            {artifact.jobTitle && <p className="text-white font-medium text-sm mb-1">{artifact.jobTitle}</p>}
                            <p className="text-gray-400 text-xs leading-relaxed line-clamp-3">{summary?.preview || 'Open to view full report.'}</p>
                        </button>
                        {isRoleBased && artifact.jobId && artifact.jobTitle && (
                            <button
                                onClick={() => onOpenJob(artifact.jobId!, artifact.jobTitle!)}
                                className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
                            >
                                Open this role &rsaquo;
                            </button>
                        )}
                        </div>
                    );
                })}
            </div>

            {viewing && (
                <Modal
                    isOpen={true}
                    onClose={() => setViewing(null)}
                    title={KIND_META[viewing.kind].label}
                    size="lg"
                    layer="top"
                    printable
                    footer={
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-gray-500 text-[11px]">futureofjobs.vercel.app</p>
                            <div className="flex gap-2 print:hidden">
                                <button
                                    onClick={() => downloadMarkdown(viewing)}
                                    className="px-4 py-2 bg-white/[0.06] hover:bg-white/10 text-gray-300 text-sm font-semibold rounded-lg transition-colors"
                                >
                                    Download
                                </button>
                                <button
                                    onClick={() => window.print()}
                                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition-colors"
                                >
                                    Print / Save as PDF
                                </button>
                            </div>
                        </div>
                    }
                >
                    {/* Print-only header, so a printed page identifies itself. */}
                    <div className="hidden print:block mb-6 pb-4 border-b border-gray-300">
                        <h1 className="text-2xl font-bold text-gray-900">
                            {KIND_META[viewing.kind].label}{viewing.jobTitle ? `: ${viewing.jobTitle}` : ''}
                        </h1>
                        <p className="text-gray-600 text-sm mt-1">
                            Saved {formatDate(viewing.updatedAt)} &middot; futureofjobs.vercel.app
                        </p>
                    </div>
                    <ReportDetail artifact={viewing} />
                </Modal>
            )}
        </>
    );
};
