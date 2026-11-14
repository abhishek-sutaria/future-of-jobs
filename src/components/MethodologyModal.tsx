import React from 'react';
import { Modal } from './ui/Modal';
import { IconBrain, IconActivity, IconTrendingUp, IconLayers } from './ui/Icons';
import { EP_PATH_MAX, INDEX_CONTINENTS, INDEX_OCCUPATION_BY_SOC, OCCUPATION_INDEX } from '../utils/occupationIndex';
import { STATE_MAP_COVERAGE } from '../utils/stateMapData';
import { formatCount } from '../utils/roleFormat';
import { BLS_SCORES_META, SCORE_COUNTS, SCORE_COVERAGE, scoredRangeLabel } from '../utils/blsScores';
import { LEGACY_SCORES_DATE } from '../utils/bakedScores';
import { SCORES_BADGE_MONTHS } from '../utils/scoreDates';
import { isCombinedSoc } from '../config/onetSplitCodes';

// Every figure quoted below is read from the dataset, never typed in.
const COUNTS = OCCUPATION_INDEX._meta.counts;
const EP_TOTAL = OCCUPATION_INDEX._meta.sources.ep.allOccupations;
const TALLEST = OCCUPATION_INDEX.occupations.find(
    (o) => o.epEmployment2025 === EP_PATH_MAX || o.epEmployment2035 === EP_PATH_MAX,
);
/** No O*NET tasks anywhere: no list of their own and no split codes (47). */
const NO_TASK_COUNT = OCCUPATION_INDEX.occupations.filter((o) => o.taskCount === 0 && !isCombinedSoc(o.soc)).length;
/** No list of their own, but O*NET splits the job into smaller codes that have tasks (12). */
const SPLIT_JOB_COUNT = OCCUPATION_INDEX.occupations.filter((o) => o.taskCount === 0 && isCombinedSoc(o.soc)).length;
const smallest = [...INDEX_CONTINENTS].sort((a, b) => a.ep.employment2025 - b.ep.employment2025)[0];
const largest = [...INDEX_CONTINENTS].sort((a, b) => b.ep.employment2025 - a.ep.employment2025)[0];
const SCORED_RANGE = scoredRangeLabel(BLS_SCORES_META?.firstScoredAt ?? null, BLS_SCORES_META?.lastScoredAt ?? null);
const RULES = BLS_SCORES_META?.rules ?? {};
const ruleCount = (rule: string) => formatCount(RULES[rule] ?? 0);
const MORE_SCORED = SCORE_COUNTS.bls > 0;
/** Every scored occupation is on the one method (ai_scores_bls.json): the Kelley SOCs are in too. */
const ALL_ONE_METHOD = SCORE_COUNTS.oneMethod === SCORE_COUNTS.scored;
const LEGACY_MONTH = LEGACY_SCORES_DATE
    ? new Date(LEGACY_SCORES_DATE).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
const n = formatCount;

/** The jobs BLS publishes no state data for, by their BLS titles. */
const NO_STATE_DATA_TITLES = STATE_MAP_COVERAGE.noStateData
    .map((soc) => INDEX_OCCUPATION_BY_SOC.get(soc)?.title ?? soc)
    .join('; ');

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
                        per-role employment. Claude is probabilistic: treat its scores as structured
                        judgment, not additional official statistics.
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
                                        {' '}(official employment levels in 2025 and 2035; landscape interpolates in a straight line between them).
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
                                        {' '}({NO_TASK_COUNT} of the {COUNTS.occupations} BLS occupations have no O*NET tasks at all, and their panel says so. For {SPLIT_JOB_COUNT} more, O*NET has no list under the job&apos;s own code because it splits the job into smaller codes; their panel names those codes.)
                                    </td>
                                </tr>
                                <tr className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2">AI capability score per task</td>
                                    <td className="px-3 py-2 text-gray-400">
                                        <SourceLink href="https://www.anthropic.com/claude">Claude</SourceLink> analyzing the O*NET task above ({SCORE_COVERAGE.short}{SCORE_COUNTS.unscored > 0 && `; the other ${formatCount(SCORE_COUNTS.unscored)} have no score`})
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
                                        BLS Employment Projections percent change 2025–35, with a straight-line path between those years (same vintage as landscape peak height)
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
                        Peak height on the 3D landscape and the Growth Outlook tile on each role page
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
                        The 3D map holds all {COUNTS.occupations} detailed occupations BLS publishes, grouped into the
                        {' '}{INDEX_CONTINENTS.length} major groups of the Standard Occupational Classification (SOC), one field per group.
                    </p>
                    <ul className="list-disc list-inside text-xs text-gray-400 ml-1 space-y-1">
                        <li><strong>Size is data.</strong> A field&apos;s area is proportional to its 2025 employment in the BLS Employment Projections summary row for that group: all workers, self-employed included. The {INDEX_CONTINENTS.length} rows add up to the {formatCount(EP_TOTAL.employment2025)} workers BLS counts in total, from {smallest.title} ({formatCount(smallest.ep.employment2025)}) to {largest.title} ({formatCount(largest.ep.employment2025)}).</li>
                        <li><strong>Position and shape are layout only.</strong> The fields are grouped by the five official BLS job families (the high-level aggregation in Table 6 of the BLS 2018 SOC User Guide), outlined on the map: area is workers, while positions within a family follow BLS code order. Each family block and each field is shaped to stay close to square, and inside a field peaks sit on an even grid in SOC order. Neither position nor shape carries any data.</li>
                        <li><strong>Peak height is data.</strong> Each peak&apos;s height is that occupation&apos;s Employment Projections job count, on a linear scale. On the whole map, one national scale runs up to the largest value on the 2025–2035 path ({formatCount(EP_PATH_MAX)}, {TALLEST?.title}), so no peak is capped. Open a family or a field and the map zooms into it: the same block, magnified, with every occupation next to the same neighbours (inside a field it is also drawn closer to a square so its labels can be read). Its hills are drawn to one fixed scale of its own, as the note beside its figures says: the largest job count any of its occupations reaches from 2025 to 2035 is full height and the rest are in proportion. So each hill rises or falls with its own BLS number as the slider moves, and the largest may sit a little under full height in 2025. Hills blend where they overlap, so a small hill on a larger neighbour&apos;s slope can move with that neighbour. Where a hill stands is layout only: related jobs sit together, one block per BLS minor group. Labels and panels always show the published numbers.</li>
                        {MORE_SCORED ? (
                            <>
                                {ALL_ONE_METHOD ? (
                                    <li data-testid="method-coverage"><strong>AI scores cover {SCORE_COVERAGE.short}, all scored the same way.</strong> All {n(SCORE_COUNTS.scored)}, the {SCORE_COUNTS.kelleyTitles} Kelley roles ({SCORE_COUNTS.kelleySocs} BLS occupations) included, were scored{SCORED_RANGE ? ` from ${SCORED_RANGE}` : ''} with the same model, the same prompt, the same BLS inputs (Employment Projections 2025–35 growth and OEWS May 2025 employment) and five O*NET tasks each, picked by the four rules below (fewer only where O*NET lists fewer). Every scored role is one app: it opens the same panel, with the same features (Analyze, Strategic Insight, Roadmap, Scenario, Defend / Build, Save role, Human Resilience), and is ranked on the same scale as every other.{SCORE_COUNTS.unscored > 0 && ` ${SCORE_COVERAGE.unscoredReason} They are drawn in slate and their panels show the BLS and O*NET numbers only; no score is estimated in their place.`}</li>
                                ) : (
                                    <li data-testid="method-coverage"><strong>AI scores cover {SCORE_COVERAGE.short}.</strong> {n(SCORE_COUNTS.oneMethod)} of them were scored the same way{SCORED_RANGE ? `, from ${SCORED_RANGE}` : ''}: the same model, the same prompt, the same BLS inputs (Employment Projections 2025–35 growth and OEWS May 2025 employment) and five O*NET tasks each, picked by the four rules below (fewer only where O*NET lists fewer). {SCORE_COUNTS.legacyKelleyTitles === SCORE_COUNTS.kelleyTitles ? `The ${SCORE_COUNTS.kelleyTitles} Kelley roles` : `${SCORE_COUNTS.legacyKelleyTitles} Kelley roles`} still show their first scores{LEGACY_MONTH ? ` from ${LEGACY_MONTH}` : ''}, made before this method with an older prompt, older BLS inputs and their own task lists; each moves to the same method as soon as its BLS occupation is re-scored. Every scored role is one app: it opens the same panel, with the same features (Analyze, Strategic Insight, Roadmap, Scenario, Defend / Build, Save role, Human Resilience), and is ranked on the same scale as every other.{SCORE_COUNTS.unscored > 0 && ` ${SCORE_COVERAGE.unscoredReason} They are drawn in slate and their panels show the BLS and O*NET numbers only; no score is estimated in their place.`}</li>
                                )}
                                <li data-testid="task-rules"><strong>Which tasks are scored: four rules.</strong> Every task is a real O*NET task, copied word for word. One of four rules decides each job&apos;s tasks:
                                    <ul className="list-[circle] list-inside ml-4 mt-1 space-y-1">
                                        <li><strong>Own list</strong>: the job has its own O*NET task list, and its first five tasks are used, in O*NET&apos;s order ({ruleCount('first-5-onet-order')} scored jobs).</li>
                                        <li><strong>Smaller codes</strong>: there is no list of its own, but O*NET has smaller codes under it (for example the kinds of &ldquo;Managers, All Other&rdquo;). One task is taken from each smaller code in turn, and a task whose text word for word repeats another smaller code&apos;s task is skipped, so no task is scored twice ({ruleCount('round-robin-sub-codes')} scored jobs).</li>
                                        <li><strong>Split job</strong>: BLS counts one job where O*NET has two or more codes, such as Teaching Assistants (O*NET splits them into preschool-to-secondary and special education). One task is taken from each O*NET code in turn, and the job&apos;s panel names the codes ({ruleCount('round-robin-onet-codes')} scored jobs).</li>
                                        <li><strong>No tasks</strong>: O*NET lists no tasks for the job anywhere, so it is not scored ({n(NO_TASK_COUNT)} jobs, all &ldquo;All Other&rdquo; groups).</li>
                                    </ul>
                                </li>
                            </>
                        ) : (
                            <li><strong>AI scores cover the {SCORE_COUNTS.kelleyTitles} Kelley roles for now.</strong> Those peaks carry the Job Security colours. Every other occupation is drawn in slate and its panel says &ldquo;AI scores coming soon&rdquo;; no score is estimated in their place.</li>
                        )}
                        <li>Kelley titles that share one BLS code (Marketing / Brand Manager, BI Analyst / Data Scientist, Buyer / Purchasing Agent) keep their own peaks, each with an equal share of that code&apos;s jobs, and their own Kelley labels. {SCORE_COUNTS.kelleyOnFile > 0 ? 'Scored by the same method as every other job, both titles of a code have that code’s tasks and scores.' : 'Until their BLS code is re-scored, each still shows its own first score.'} In the ranks each BLS code counts once: {n(SCORE_COUNTS.ranked)} scored occupations.</li>
                        <li><strong>The task view</strong> covers every scored role in the open field, family or whole map. <strong>The state map</strong> covers every job there, all {n(SCORE_COUNTS.total)} of them, scored or not: it uses BLS state employment (OEWS May 2025). A grey state is one where BLS publishes no number for the job.</li>
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
                        <li><strong>Relative labels</strong> grade each role against all {n(SCORE_COUNTS.ranked)} scored occupations (each BLS code once) rather than against absolute thresholds. Human Resilience ranks a role&apos;s average human-criticality score among all of them (top quarter Future-Proof, middle half High, bottom quarter At Risk), and peak colours grade its AI Exposure in thirds of the same {n(SCORE_COUNTS.ranked)}. The two are rated separately, so a role can be Future-Proof and still red; hover a label on the role page to see its cut-offs. The scores themselves never change; only where a role sits among the others.</li>
                        <li>Every score is published with the app, so every visitor sees the same figures; the &ldquo;AI Scores&rdquo; badge in the header shows the months they were made{SCORES_BADGE_MONTHS ? ` (${SCORES_BADGE_MONTHS})` : ''}. Opening a role adds Claude&apos;s reasoning (<strong>Analyze</strong>) without changing any score. Re-scoring from that badge uses your own Claude key, re-scores the Kelley roles and changes the figures only in your browser, until a newer published set arrives or 30 days pass.</li>
                        <li><strong>Saved shared answers.</strong> Strategic Insight, Scenario, Roadmap and Defend / Build are written by Claude the first time anyone asks for them on a role, and checked. When saving is on, the answer is saved on the server and every later visitor sees that same answer, with no new Claude call; a note under each answer says whether it was saved. An answer is tied to the role&apos;s exact inputs and the prompt version, so if either changes, a new answer is written. A visitor can ask for only so many new answers per hour and per day (an answer that fails does not count); saved answers always open.</li>
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
                        <li><strong>Coverage</strong>: all {n(SCORE_COUNTS.total)} jobs, Kelley or not, scored or not, from one file: the BLS OEWS May 2025 state file (50 states, DC, Guam, Puerto Rico and the Virgin Islands). The map shows every job in the open field, family or whole map. Each job uses its own BLS code, including 13-1020 (Wholesale &amp; Retail Buyer / Purchasing Agent) and the other combined codes, which BLS publishes as they are.</li>
                        <li><strong>Grey states</strong>: BLS does not publish every job in every state. Where it marks the number as not available (&ldquo;**&rdquo;) or lists no row, the state is grey and its tooltip says &ldquo;No data from BLS&rdquo;; nothing is estimated. For {STATE_MAP_COVERAGE.none} jobs BLS publishes no state numbers at all ({NO_STATE_DATA_TITLES}), and the map says so instead of drawing an empty map.</li>
                        <li><strong>Map coordinates</strong>: state centroid lat/lng values are US Census Bureau geographic centroids — display-only, not BLS data.</li>
                        <li><strong>Circle labels</strong>: only the top 15 states by total employment receive a circle marker. All states with data still receive a choropleth fill.</li>
                        <li><strong>AI Exposure is not encoded</strong> in the map — colour and circle size both represent employment volume only.</li>
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
                        2025 and 2035 employment levels (linear visual scale, not log). The whole map uses one
                        national scale up to {formatCount(EP_PATH_MAX)}; an open family or field uses its own, so
                        compare heights within one, not across them.
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
