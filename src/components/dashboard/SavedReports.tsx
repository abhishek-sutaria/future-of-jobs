import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Empty } from '../ui/EmptyState';
import { IconSparkles, IconTarget, IconRocket, IconShield } from '../ui/Icons';
import type { StoredArtifact, ArtifactKind } from '../../lib/userData';
import type { ResumeAnalysisResult, StartupIdeasResult } from '../../utils/analysis';
import { summarizeArtifacts } from '../../utils/dashboardSelectors';

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
 * scenario/roadmap are role-specific — reopening means going to that role and
 * clicking Scenario/Roadmap again, which restores instantly from the same
 * cache this dashboard is reading (loadScenario/loadRoadmap check the saved
 * artifact before calling Claude). startup_ideas/skills_analysis are
 * resume-based, not role-based, so there is no "role" to navigate to — those
 * open a lightweight read-only viewer here instead.
 */
const ReportDetail: React.FC<{ artifact: StoredArtifact }> = ({ artifact }) => {
    if (artifact.kind === 'skills_analysis') {
        const r = artifact.payload as ResumeAnalysisResult;
        return (
            <div className="space-y-4 text-sm">
                <p className="text-gray-200 leading-relaxed">{r.feedback}</p>
                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <h4 className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2">Strengths</h4>
                        <ul className="space-y-1.5">{r.strengths.map((s, i) => <li key={i} className="text-gray-300 text-xs">• {s}</li>)}</ul>
                    </div>
                    <div>
                        <h4 className="text-[10px] uppercase tracking-wider text-red-400 font-semibold mb-2">Gaps</h4>
                        <ul className="space-y-1.5">{r.gaps.map((s, i) => <li key={i} className="text-gray-300 text-xs">• {s}</li>)}</ul>
                    </div>
                </div>
                <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold mb-2">5-Year Plan</h4>
                    <p className="text-gray-300 text-xs leading-relaxed">{r.plan}</p>
                </div>
            </div>
        );
    }

    // startup_ideas — a summary view; full per-idea execution detail lives in
    // StartupIdeasModal itself and isn't duplicated here.
    const r = artifact.payload as StartupIdeasResult;
    return (
        <div className="space-y-4 text-sm">
            {r.founderProfile?.summary && <p className="text-gray-200 leading-relaxed">{r.founderProfile.summary}</p>}
            <div className="space-y-2">
                {(r.ideas ?? []).map((idea, i) => (
                    <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
                        <p className="text-white font-medium text-sm">{idea.name}</p>
                        {idea.summary && <p className="text-gray-400 text-xs mt-1">{idea.summary}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
};

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
                        <button
                            key={artifact.id}
                            onClick={() => {
                                if (isRoleBased && artifact.jobId && artifact.jobTitle) {
                                    onOpenJob(artifact.jobId, artifact.jobTitle);
                                } else {
                                    setViewing(artifact);
                                }
                            }}
                            className="text-left bg-white/[0.02] border border-white/[0.06] hover:border-white/15 rounded-xl p-4 transition-colors"
                        >
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${meta.color}`}>
                                    {meta.icon} {meta.label}
                                </span>
                                <span className="text-[10px] text-gray-600 tabular-nums shrink-0">{formatDate(artifact.updatedAt)}</span>
                            </div>
                            {artifact.jobTitle && <p className="text-white font-medium text-sm mb-1">{artifact.jobTitle}</p>}
                            <p className="text-gray-400 text-xs leading-relaxed line-clamp-3">{summary?.preview || 'Open to view full report.'}</p>
                        </button>
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
                >
                    <ReportDetail artifact={viewing} />
                </Modal>
            )}
        </>
    );
};
