import React from 'react';
import { Modal } from './ui/Modal';
import { IconBrain, IconActivity, IconTrendingUp } from './ui/Icons';

interface MethodologyModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const linkClass =
    "text-cyan-300 hover:text-cyan-200 underline decoration-cyan-500/40 hover:decoration-cyan-300 underline-offset-2 transition-colors";

const SourceLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {children}
    </a>
);

export const MethodologyModal: React.FC<MethodologyModalProps> = ({ isOpen, onClose }) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Methodology & Data Sources" size="md" layer="top">
            <div className="space-y-6">

                {/* Data provenance — every number traced to a source */}
                <div className="space-y-2">
                    <h3 className="text-base font-semibold text-white">Where every number comes from</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        Labor-market figures shown as metrics come from the bundled BLS / O*NET snapshot,
                        optional live BLS overlays when the API succeeds, or from Claude outputs that are
                        explicitly conditioned on those inputs. Claude is probabilistic: treat its scores
                        and year curves as structured judgment, not additional official statistics.
                    </p>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        The <strong>Coverage</strong> percentage on job cards is a simple index of how many
                        fields are populated from live BLS versus the static snapshot — it is not a BLS
                        accuracy or confidence grade.
                    </p>

                    <div className="mt-3 rounded-lg border border-white/[0.08] overflow-hidden">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-white/[0.04] text-gray-400 uppercase tracking-wider text-[10px]">
                                    <th className="text-left px-3 py-2 font-semibold">Value</th>
                                    <th className="text-left px-3 py-2 font-semibold">Source</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-300">
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Employment headcount</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/oes/">BLS OES May 2023</SourceLink>
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">10-year growth projection</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/ooh/">BLS OOH 2022–2032</SourceLink>
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">US unemployment rate (live)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/cps/">BLS CPS (real-time API)</SourceLink>
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">State-level employment</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/oes/current/oessrcst.htm">BLS OES State (May 2023)</SourceLink>
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Day-to-day task descriptions</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.onetcenter.org/database.html">O*NET 28.2 (April 2024)</SourceLink>
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">AI capability score per task</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink> analyzing the O*NET task above
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Human criticality score per task</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink> analyzing the O*NET task above
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Year-by-year forecast</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink>, reasoning over the BLS projection + O*NET tasks
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">"Day in 2030" scenarios, roadmaps, courses</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink>, conditioned on the selected role
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <p className="text-[11px] text-gray-500 leading-relaxed mt-2 italic">
                        Before Claude finishes scoring a role, task-level AI / human scores stay at
                        their pending baseline. In <strong>Growth</strong> mode, peak motion follows
                        Claude&apos;s stored year-by-year forecast when present; otherwise a linear
                        cumulative path from 0% at 2025 to the BLS OOH 10-year % at 2030.{' '}
                        <strong>Workers</strong> mode uses the same cumulative % to scale baseline
                        BLS employment into an implied headcount, then log-scales that for peak height,
                        with a modest display-only boost to the height change so the scrub reads clearly.
                    </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconBrain size={18} className="text-cyan-400" />
                        <h3 className="text-base font-semibold text-cyan-400">How Claude scores tasks</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        For each O*NET task we pass the exact task text to{' '}
                        <SourceLink href="https://www.anthropic.com/claude"><strong>Claude</strong></SourceLink>{' '}
                        and ask for two numbers between 0 and 1: how easily current GenAI could
                        automate it (AI capability), and how much human judgment, empathy, or
                        physical presence it requires (human criticality). Each task gets its own
                        score — the role-level number is just the average.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Relative Risk labels</strong> are dynamic — they grade jobs on a curve (top 25% by AI capability = "High Risk") rather than against absolute thresholds.</li>
                        <li>Scores are cached for 30 days in your browser; click the green "AI Scores Live" badge in the header to re-score with fresh Claude data.</li>
                    </ul>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconActivity size={18} className="text-blue-400" />
                        <h3 className="text-base font-semibold text-blue-400">
                            Economic viability: <SourceLink href="https://futuretech.mit.edu/">MIT Iceberg Index</SourceLink>
                        </h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        Just because a task <em>can</em> be automated doesn't mean it <em>will</em>{' '}
                        be. We reference the{' '}
                        <SourceLink href="https://futuretech.mit.edu/">
                            <strong>Iceberg Index cost model</strong>
                        </SourceLink>{' '}
                        to filter out automation that isn't ROI-positive yet — high cost/complexity
                        tasks remain human-led even when AI is technically capable.
                    </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconTrendingUp size={18} className="text-emerald-400" />
                        <h3 className="text-base font-semibold text-emerald-400">3D peak height</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        Use the toggle on the year-slider panel to flip peak height between:
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Growth</strong>: per-year cumulative % from Claude&apos;s forecast when available; otherwise a linear path from 0% at 2025 to the BLS OOH 10-year % for that role at 2030 (until Claude fills in a forecast).</li>
                        <li><strong>Workers</strong>: log-scaled implied headcount (BLS baseline × cumulative % at the selected year). Peak height applies a small display-only multiplier to the change from baseline so the scrub is easier to see.</li>
                    </ul>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06] text-center">
                <p className="text-xs text-gray-500 italic">
                    "The goal is not to predict the future perfectly, but to prepare for it strategically."
                </p>
            </div>
        </Modal>
    );
};
