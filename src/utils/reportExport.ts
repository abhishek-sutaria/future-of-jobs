/**
 * Turns a saved report into a portable document.
 *
 * Pure string in / string out: no DOM, no network, so the whole export path is
 * unit-testable. The payloads are stored complete (userData.StoredArtifact), so
 * nothing here should ever summarise or drop a field — the dashboard viewer
 * already lost most of a Startup Ideas plan that way.
 */

import type { StoredArtifact, ArtifactKind } from '../lib/userData';
import type {
    ScenarioResult,
    RoadmapResult,
    ResumeAnalysisResult,
    StartupIdeasResult,
} from './analysis';

const KIND_TITLE: Record<ArtifactKind, string> = {
    scenario: 'Day in the Life',
    roadmap: 'Career Roadmap',
    startup_ideas: 'Startup Ideas',
    skills_analysis: 'Resume Health Check',
};

const bullets = (label: string, items?: string[]): string[] =>
    items && items.length > 0 ? [`**${label}**`, '', ...items.map((i) => `- ${i}`), ''] : [];

const field = (label: string, value?: string): string[] =>
    value ? [`**${label}**`, '', value, ''] : [];

function scenarioBody(r: ScenarioResult): string[] {
    return [
        ...(r.story ? [r.story, ''] : []),
        ...(r.keyChanges?.length ? ['## Key shifts', '', ...r.keyChanges.map((c, i) => `${i + 1}. ${c}`), ''] : []),
    ];
}

function roadmapBody(r: RoadmapResult): string[] {
    const out: string[] = [];
    for (const phase of r.phases ?? []) {
        out.push(`## ${phase.title}`, '');
        out.push(...(phase.items ?? []).map((i) => `- ${i}`), '');
    }
    if (r.resources?.length) {
        out.push('## Recommended resources', '');
        for (const res of r.resources) out.push(...bullets(res.category, res.items));
    }
    if (r.successMetrics?.length) out.push('## Success milestones', '', ...r.successMetrics.map((m) => `- ${m}`), '');
    return out;
}

function skillsBody(r: ResumeAnalysisResult): string[] {
    return [
        ...(r.feedback ? [r.feedback, ''] : []),
        ...bullets('Strengths', r.strengths),
        ...bullets('Gaps', r.gaps),
        ...(r.plan ? ['## 5-year plan', '', r.plan, ''] : []),
    ];
}

function startupBody(r: StartupIdeasResult): string[] {
    const out: string[] = [];
    const p = r.founderProfile;
    if (p) {
        out.push('## Founder profile', '');
        if (p.summary) out.push(p.summary, '');
        out.push(...bullets('Core skills', p.coreSkills));
        out.push(...bullets('Domains', p.domains));
        out.push(...bullets('Unfair advantages', p.unfairAdvantages));
        out.push(...bullets('Gaps', p.gaps));
    }
    if (r.startHere) out.push('## Start here', '', r.startHere, '');

    const detail = new Map((r.topThree ?? []).map((t) => [t.name?.trim().toLowerCase() ?? '', t]));
    (r.ideas ?? []).forEach((idea, i) => {
        const merged = { ...idea, ...(detail.get(idea.name?.trim().toLowerCase() ?? '') ?? {}) } as Record<string, unknown>;
        const str = (k: string) => (typeof merged[k] === 'string' ? (merged[k] as string) : undefined);
        const arr = (k: string) => (Array.isArray(merged[k]) ? (merged[k] as string[]) : undefined);
        out.push(`## ${i + 1}. ${idea.name}`, '');
        if (str('summary')) out.push(str('summary')!, '');
        out.push(...bullets('Applicable skills', arr('applicableSkills')));
        out.push(...bullets('Skills needed', arr('skillsNeeded')));
        out.push(...bullets('Tech stack', arr('techStack')));
        out.push(...bullets('First customers', arr('firstCustomers')));
        out.push(...bullets('Risks', arr('risks')));
        out.push(...field('MVP plan', str('mvpPlan')));
        out.push(...field('First customer path', str('firstCustomerPath')));
        out.push(...field('Pricing model', str('pricingModel')));
        out.push(...field('Path to $10k MRR', str('pathTo10kMrr')));
        out.push(...field('Path to scale', str('pathToScale')));
        out.push(...field('Validation', str('validation')));
        out.push(...field('Validate in 48 hours', str('validation48h')));
        out.push(...field('MVP in 7 days', str('mvp7day')));
        out.push(...field('Launch in 30 days', str('launch30day')));
        out.push(...field('Revenue in 90 days', str('revenue90day')));
        out.push(...field('Outreach script', str('outreachScript')));
        out.push(...field('Kill criteria', str('killCriteria')));
    });
    return out;
}

export function reportToMarkdown(artifact: StoredArtifact): string {
    const title = KIND_TITLE[artifact.kind];
    const head = [
        `# ${title}${artifact.jobTitle ? `: ${artifact.jobTitle}` : ''}`,
        '',
        `_Saved ${new Date(artifact.updatedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · AI & Future of Work · futureofjobs.vercel.app_`,
        '',
    ];

    let body: string[];
    switch (artifact.kind) {
        case 'scenario': body = scenarioBody(artifact.payload as ScenarioResult); break;
        case 'roadmap': body = roadmapBody(artifact.payload as RoadmapResult); break;
        case 'skills_analysis': body = skillsBody(artifact.payload as ResumeAnalysisResult); break;
        case 'startup_ideas': body = startupBody(artifact.payload as StartupIdeasResult); break;
    }

    return [...head, ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Filesystem-safe, human-readable, and stable for the same report. */
export function reportFilename(artifact: StoredArtifact, ext: 'md' = 'md'): string {
    const slug = (s: string) =>
        s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
    const subject = artifact.jobTitle ? slug(artifact.jobTitle) : 'resume';
    const date = new Date(artifact.updatedAt).toISOString().slice(0, 10);
    return `future-of-jobs-${slug(artifact.kind)}-${subject}-${date}.${ext}`;
}

export { KIND_TITLE };
