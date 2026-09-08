import React from 'react';
import type { StartupIdeasResult } from '../../utils/analysis';

/**
 * Full-fidelity renderer for a saved Startup Ideas report.
 *
 * The dashboard used to show only each idea's name and summary, with a comment
 * conceding the execution detail "lives in StartupIdeasModal and isn't
 * duplicated here" — so most of what the user generated was unreachable once
 * saved. Every field the schema can carry is rendered here; anything empty is
 * simply skipped, since the schema defaults most fields to '' or [].
 */
const List: React.FC<{ label: string; items?: string[] }> = ({ label, items }) =>
    items && items.length > 0 ? (
        <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1 print:text-black">{label}</p>
            <ul className="space-y-1">
                {items.map((s, i) => <li key={i} className="text-gray-300 text-xs print:text-black">&bull; {s}</li>)}
            </ul>
        </div>
    ) : null;

const Field: React.FC<{ label: string; value?: string }> = ({ label, value }) =>
    value ? (
        <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1 print:text-black">{label}</p>
            <p className="text-gray-300 text-xs leading-relaxed print:text-black">{value}</p>
        </div>
    ) : null;

export const StartupIdeasReport: React.FC<{ result: StartupIdeasResult }> = ({ result }) => {
    const profile = result.founderProfile;
    const topByName = new Map((result.topThree ?? []).map((t) => [t.name.trim().toLowerCase(), t]));

    return (
        <div className="space-y-5 text-sm">
            {profile && (
                <div data-print-card className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 space-y-3">
                    <h4 className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold print:text-black">Founder profile</h4>
                    {profile.summary && <p className="text-gray-200 leading-relaxed text-xs print:text-black">{profile.summary}</p>}
                    <div className="grid sm:grid-cols-2 gap-3">
                        <List label="Core skills" items={profile.coreSkills} />
                        <List label="Domains" items={profile.domains} />
                        <List label="Unfair advantages" items={profile.unfairAdvantages} />
                        <List label="Gaps" items={profile.gaps} />
                    </div>
                </div>
            )}

            {result.startHere && (
                <div data-print-card className="bg-amber-500/[0.05] border border-amber-500/20 rounded-xl p-4">
                    <p className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold mb-1 print:text-black">Start here</p>
                    <p className="text-gray-200 text-xs leading-relaxed print:text-black">{result.startHere}</p>
                </div>
            )}

            <div className="space-y-3">
                {(result.ideas ?? []).map((idea, i) => {
                    const detail = topByName.get(idea.name?.trim().toLowerCase() ?? '');
                    const merged = { ...idea, ...(detail ?? {}) } as Record<string, unknown>;
                    const str = (k: string) => (typeof merged[k] === 'string' ? (merged[k] as string) : undefined);
                    const arr = (k: string) => (Array.isArray(merged[k]) ? (merged[k] as string[]) : undefined);
                    return (
                        <div key={i} data-print-card className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 space-y-3">
                            <div>
                                <p className="text-white font-medium text-sm print:text-black">
                                    {i + 1}. {idea.name}
                                </p>
                                {str('summary') && <p className="text-gray-400 text-xs mt-1 print:text-black">{str('summary')}</p>}
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <List label="Applicable skills" items={arr('applicableSkills')} />
                                <List label="Skills needed" items={arr('skillsNeeded')} />
                                <List label="Tech stack" items={arr('techStack')} />
                                <List label="First customers" items={arr('firstCustomers')} />
                                <List label="Risks" items={arr('risks')} />
                            </div>
                            <div className="space-y-2">
                                <Field label="MVP plan" value={str('mvpPlan')} />
                                <Field label="First customer path" value={str('firstCustomerPath')} />
                                <Field label="Pricing model" value={str('pricingModel')} />
                                <Field label="Path to $10k MRR" value={str('pathTo10kMrr')} />
                                <Field label="Path to scale" value={str('pathToScale')} />
                                <Field label="Validation" value={str('validation')} />
                                <Field label="Validate in 48 hours" value={str('validation48h')} />
                                <Field label="MVP in 7 days" value={str('mvp7day')} />
                                <Field label="Launch in 30 days" value={str('launch30day')} />
                                <Field label="Revenue in 90 days" value={str('revenue90day')} />
                                <Field label="Outreach script" value={str('outreachScript')} />
                                <Field label="Kill criteria" value={str('killCriteria')} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
