import React from 'react';
import { Modal } from './ui/Modal';
import { IconBrain, IconActivity, IconTrendingUp, IconLayers } from './ui/Icons';
import { EP_PATH_MAX, INDEX_CONTINENTS, OCCUPATION_INDEX } from '../utils/occupationIndex';
import { formatCount } from '../utils/roleFormat';

// Every figure quoted below is read from the dataset, never typed in.
const COUNTS = OCCUPATION_INDEX._meta.counts;
const EP_TOTAL = OCCUPATION_INDEX._meta.sources.ep.allOccupations;
const TALLEST = OCCUPATION_INDEX.occupations.find(
    (o) => o.epEmployment2025 === EP_PATH_MAX || o.epEmployment2035 === EP_PATH_MAX,
);
const NO_TASK_COUNT = COUNTS.occupations - COUNTS.withTasks;
const smallest = [...INDEX_CONTINENTS].sort((a, b) => a.ep.employment2025 - b.ep.employment2025)[0];
const largest = [...INDEX_CONTINENTS].sort((a, b) => b.ep.employment2025 - a.ep.employment2025)[0];

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
                        Labor-market figures shown as metrics come from the bundled BLS / O*NET snapshot
                        or from Claude outputs that are explicitly conditioned on those inputs. The live
                        BLS CPS feed powers only the national unemployment rate in the header — not
                        per-role employment. Claude is probabilistic: treat its scores and year curves
                        as structured judgment, not additional official statistics.
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
                                    <td className="px-3 py-2">Workers (role panel) and the size of each field</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/emp/tables/occupational-projections-and-characteristics.htm">BLS Employment Projections 2025–2035</SourceLink>
                                        {' '}2025 employment: every worker, self-employed included. A field&apos;s size is the BLS summary row for its whole group, as published (not a sum of its occupations).
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Payroll employment (OES badge, and the base of the pay figures)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/oes/">BLS OEWS May 2025</SourceLink>
                                        {' '}national extract: payroll employees only, so it is smaller than the Employment Projections count.
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Pay (role panel / Pay badge)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/oes/">BLS OEWS May 2025</SourceLink>
                                        {' '}national annual median wage, with the annual mean beside it. Same survey and year as the payroll employment above (payroll employees only, so not the Employment Projections worker count), copied exactly as BLS publishes it. Wages BLS caps show as &ldquo;&ge;&rdquo; the cap. Roles that share one BLS code show the same pay.
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">3D peak height (jobs over time)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/emp/tables/occupational-projections-and-characteristics.htm">BLS Employment Projections 2025–2035</SourceLink>
                                        {' '}(official employment levels in 2025 and 2035; peaks move in a straight line between them).
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">10-year growth % (role panel)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/emp/tables/occupational-projections-and-characteristics.htm">BLS Employment Projections 2025–2035</SourceLink>
                                        {' '}(official percent change by occupation, shown to one decimal as BLS publishes it).
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">US unemployment rate (header only)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/cps/">BLS CPS (real-time API)</SourceLink>
                                        {' '}— national rate; does not feed per-role employment or peak height.
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">State-level employment (US map)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.bls.gov/oes/current/oessrcst.htm">BLS OEWS State (May 2025)</SourceLink>
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Day-to-day task descriptions</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.onetcenter.org/database.html">O*NET 30.1</SourceLink>
                                        {' '}({NO_TASK_COUNT} of the {COUNTS.occupations} BLS occupations have no O*NET task list; their panel says so)
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">AI capability score per task</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink> analyzing the O*NET task above (the 50 Kelley roles; other occupations: coming soon)
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Human criticality score per task</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink> analyzing the O*NET task above
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">Growth outlook (role page)</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        BLS Employment Projections percent change 2025–35, with a straight-line path between those years (same vintage as the peak heights on the globe)
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
                        Peak height on the 3D globe and the Growth Outlook tile on each role page
                        both follow BLS Employment Projections only (2025→2035, straight-line path).
                        Neither uses Claude employment forecasts.
                    </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                {/* The 22 fields */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconLayers size={18} className="text-cyan-400" />
                        <h3 className="text-base font-semibold text-cyan-400">The 22 fields</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        The 3D globe holds all {COUNTS.occupations} detailed occupations BLS publishes, grouped into the
                        {' '}{INDEX_CONTINENTS.length} major groups of the Standard Occupational Classification (SOC), one field (continent) per group.
                        Tap a continent to zoom into that field, drawn flat.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Size is data.</strong> A field&apos;s area is proportional to its 2025 employment in the BLS Employment Projections summary row for that group: all workers, self-employed included. The {INDEX_CONTINENTS.length} rows add up to the {formatCount(EP_TOTAL.employment2025)} workers BLS counts in total, from {smallest.title} ({formatCount(smallest.ep.employment2025)}) to {largest.title} ({formatCount(largest.ep.employment2025)}).</li>
                        <li><strong>The globe is equal-area, so continent sizes are true to the BLS counts.</strong> The continents are laid out on a Lambert cylindrical equal-area projection (longitude across, the sine of latitude up), which keeps area exactly, and then wrapped onto the sphere: a field with twice the workers covers twice the surface. A test measures every continent on the sphere and checks its share against its BLS share to within 1%.</li>
                        <li><strong>Position and shape are layout only.</strong> The continents are grouped by the five official BLS job families (the high-level aggregation in Table 6 of the BLS 2018 SOC User Guide), outlined on the ocean: area is workers, while positions within a family follow BLS code order (north to south, west to east). Each family and each continent is shaped to stay close to square. Their rounded, slightly uneven coastlines, the ocean between them and the empty polar caps are layout too: every continent gives the same share of its space to the ocean, and the coastlines are allowed only because the 1% area test still passes. Inside a field, peaks sit on an even grid in SOC order. None of this carries data.</li>
                        <li><strong>Peak height is data.</strong> Each peak&apos;s height is that occupation&apos;s Employment Projections job count, on a linear scale. On the globe, one national scale runs up to the largest value on the 2025–2035 path ({formatCount(EP_PATH_MAX)}, {TALLEST?.title}), so no peak is capped; the whole scale is shrunk by one factor to fit the sphere, so heights still compare across continents. When you zoom into a field, its peaks switch to that field&apos;s own scale: its largest occupation in the slider year is drawn full height and the rest in proportion, as the note under the field name says. Labels and panels always show the published numbers.</li>
                        <li><strong>AI scores cover the 50 Kelley roles for now.</strong> Those peaks carry the Job Security colours. Every other occupation is drawn in slate and its panel says &ldquo;AI scores coming soon&rdquo;; no score is estimated in their place. Kelley titles that share one BLS code (Marketing / Brand Manager, BI Analyst / Data Scientist, Buyer / Purchasing Agent) keep their own peaks, each with an equal share of that code&apos;s jobs, as before.</li>
                        <li><strong>The state map and the task view</strong> cover the 50 Kelley roles for now.</li>
                    </ul>
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
                        <li><strong>Relative labels</strong> grade each role against the other 49 rather than against absolute thresholds. Human Resilience ranks a role&apos;s average human-criticality score (top quarter Future-Proof, middle half High, bottom quarter At Risk), and peak colours grade its Automation Risk against the full range of roles.</li>
                        <li>The scores for all 50 roles are published with the app as one dated set, so every visitor sees the same figures; the &ldquo;AI Scores&rdquo; badge in the header shows the month they were produced. Clicking <strong>Analyze</strong> on a role adds Claude&apos;s reasoning without changing any score. Re-scoring from that badge uses your own Claude key and changes the figures only in your browser, until a newer published set arrives or 30 days pass.</li>
                    </ul>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                        <IconActivity size={18} className="text-blue-400" />
                        <h3 className="text-base font-semibold text-blue-400">Capability is not adoption</h3>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        Just because a task <em>can</em> be automated doesn't mean it <em>will</em>{' '}
                        be. The AI capability score measures how easily current GenAI could do a task
                        today. It does not model cost, regulation, or how quickly employers adopt the
                        technology. For a cost-based view of which automation pays off, see the{' '}
                        <SourceLink href="https://futuretech.mit.edu/">
                            <strong>MIT Iceberg Index</strong>
                        </SourceLink>.
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
                        <SourceLink href="https://www.bls.gov/oes/current/oessrcst.htm">BLS OEWS May 2025 state data</SourceLink>.
                        Values are the BLS <code className="text-[10px] bg-white/[0.06] rounded px-1">TOT_EMP</code> column
                        (cross-industry, detailed occupation level). The Location Quotient (LQ) shown in tooltips
                        comes from the BLS <code className="text-[10px] bg-white/[0.06] rounded px-1">LOC_QUOTIENT</code> column;
                        LQ&nbsp;&gt;&nbsp;1 means the occupation is more concentrated in that state than the national average.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Aggregation</strong>: employment is summed once per unique SOC code. Alias titles sharing a SOC (e.g. Marketing Manager and Brand Manager both map to 11-2021) are counted once per state.</li>
                        <li><strong>Coverage</strong>: all 47 SOC codes have BLS state-level data, including 13-1020 (Wholesale &amp; Retail Buyer / Purchasing Agent), the broad group BLS now publishes after retiring the two detailed codes it used to comprise.</li>
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
                        Peak height is the number of jobs from BLS Employment Projections. Drag the year
                        slider from 2025 to 2035; each peak moves in a straight line between the official
                        2025 and 2035 employment levels (linear visual scale, not log). The globe uses one
                        national scale up to {formatCount(EP_PATH_MAX)}; a zoomed-in field uses its own, so
                        compare heights within a field, not across zoomed fields.
                    </p>
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
