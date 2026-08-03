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
                                        {' '}(bundled national + state extract that drives the 3D map and US map). BLS has since published newer OES releases (through May 2025); a refresh is planned.
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">10-year growth projection</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        Bundled figures are from <SourceLink href="https://www.bls.gov/ooh/">BLS OOH 2022–2032</SourceLink>.
                                        The current handbook vintage is 2024–2034 — labels and rates will be refreshed to match.
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
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink>, reasoning over the BLS projection + O*NET tasks — cumulative % change in <em>total employment for the role</em> (human workforce level), not an "AI + human jobs" total and not a pure residual after full automation
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
                        with a modest display-only boost to the height change so the scrub reads clearly,
                        plus a touch of the Growth height mapping for extra motion.
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

                {/* 2D Map section */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <span className="text-lg leading-none">🗺️</span>
                        <h3 className="text-base font-semibold text-teal-400">2D US Map</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        The map shows state-level employment for each selected role, sourced from{' '}
                        <SourceLink href="https://www.bls.gov/oes/current/oessrcst.htm">BLS OES May 2023 state data</SourceLink>.
                        Values are the BLS <code className="text-[10px] bg-white/[0.06] rounded px-1">TOT_EMP</code> column
                        (cross-industry, detailed occupation level). The Location Quotient (LQ) shown in tooltips
                        comes from the BLS <code className="text-[10px] bg-white/[0.06] rounded px-1">LOC_QUOTIENT</code> column;
                        LQ&nbsp;&gt;&nbsp;1 means the occupation is more concentrated in that state than the national average.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Aggregation</strong>: employment is summed once per unique SOC code. Alias titles sharing a SOC (e.g. Marketing Manager and Brand Manager both map to 11-2021) are counted once per state.</li>
                        <li><strong>Coverage</strong>: 45 of 47 SOC codes have BLS state-level data. Two codes (13-1022, 13-1023) are not published at the detailed level in BLS OES May 2023.</li>
                        <li><strong>Map coordinates</strong>: state centroid lat/lng values are US Census Bureau geographic centroids — display-only, not BLS data.</li>
                        <li><strong>Circle labels</strong>: only the top 15 states by total employment receive a circle marker. All states with data still receive a choropleth fill.</li>
                        <li><strong>Automation risk is not encoded</strong> in the map — colour and circle size both represent employment volume only.</li>
                    </ul>
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
                        <li><strong>Workers</strong>: log-scaled implied headcount (BLS baseline × cumulative % at the selected year), with a stronger height-delta boost and a partial blend of the Growth height curve so the scrub feels responsive. Labels still show the real cumulative %.</li>
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
