/**
 * Matching catalog courses to jobs (Step 2 of 3). Pure: no network, no Vite.
 * scripts/match_course_catalog.ts does the I/O and the Claude calls;
 * docs/course-matches.md explains the method and the results.
 *
 *   1. A cheap local filter: for each scored job, the ~30 catalog entries whose
 *      title, tags and description share the most (rare) words with the job's
 *      title, its O*NET tasks and its O*NET technology skills (BM25).
 *   2. Claude (the app's model) picks 0 to 5 of those 30 that would genuinely
 *      help someone in this job, with a one-line reason. It may only return IDs
 *      from the shortlist; any other ID is rejected. Picking none is expected:
 *      the catalog is mostly Microsoft and Google tech training.
 *
 * Nothing here is forced: a job with no good match gets [] and keeps the app's
 * existing course buttons (#99) in Step 3.
 */

import crypto from 'node:crypto';
import type { CatalogEntry } from './courseCatalog';

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

export const MATCH_PATHS = {
    catalog: 'data/course_catalog/catalog.json',
    scores: 'src/data/ai_scores_bls.json',
    tasks: 'data/db_30_1_text/Task Statements.txt',
    technology: 'data/db_30_1_text/Technology Skills.txt',
    occupations: 'data/db_30_1_text/Occupation Data.txt',
    matches: 'data/course_catalog/matches.json',
    responses: 'data/course_catalog/match_responses.json',
    runs: 'data/course_catalog/match_runs.json',
    doc: 'docs/course-matches.md',
} as const;

/** The app's model (src/shared/aiFeatures.ts AI_MODEL). */
export const MATCH_MODEL = 'claude-sonnet-5';
/** Bump when the prompt, the schema or the shortlist rules change: results from another version are re-run. */
export const PROMPT_VERSION = 'course-match-v3';
/**
 * v3 only tightened v2 (it adds four "does not fit" rules). Jobs for which v2
 * found nothing were not asked again: a stricter prompt cannot add a match.
 * Their v2 answer ([]) is kept and marked with its version.
 */
export const EMPTY_STILL_VALID = ['course-match-v2'];
export const SHORTLIST_SIZE = 30;
export const MAX_PICKS = 5;
export const MAX_TOKENS = 1024;

/** claude-sonnet-5, Message Batches (50% of list), USD per million tokens. */
export const BATCH_PRICE = { input: 1, output: 5 } as const;
export const costUsd = (inputTokens: number, outputTokens: number): number =>
    (inputTokens * BATCH_PRICE.input + outputTokens * BATCH_PRICE.output) / 1_000_000;

// ── Job inputs ──────────────────────────────────────────────────────────────

export interface JobProfile {
    soc: string;
    title: string;
    description: string;
    tasks: string[];
    technology: string[];
}

/** Tab-separated O*NET file → rows as objects. */
export function readOnetTsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const head = lines[0].split('\t');
    return lines.slice(1).map((l) => {
        const cells = l.split('\t');
        return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
    });
}

export const MAX_TASKS = 10;
export const MAX_TECH = 15;

/**
 * One job's profile from O*NET: the description, its tasks (Core first, in
 * O*NET's order, at most 10) and its technology skills (Hot Technology first,
 * at most 15), over every O*NET code the job's score used.
 */
export function buildProfiles(
    scored: Record<string, { title: string; onetCodes: string[] }>,
    taskRows: Record<string, string>[],
    techRows: Record<string, string>[],
    occRows: Record<string, string>[],
): JobProfile[] {
    const byCode = <T>(rows: Record<string, string>[], f: (r: Record<string, string>) => T) => {
        const m = new Map<string, T[]>();
        for (const r of rows) m.set(r['O*NET-SOC Code'], [...(m.get(r['O*NET-SOC Code']) ?? []), f(r)]);
        return m;
    };
    const tasks = byCode(taskRows, (r) => ({ text: r.Task, core: r['Task Type'] === 'Core' }));
    const tech = byCode(techRows, (r) => ({ name: r.Example, hot: r['Hot Technology'] === 'Y' }));
    const desc = new Map(occRows.map((r) => [r['O*NET-SOC Code'], r.Description]));
    return Object.entries(scored).map(([soc, s]) => {
        const t = s.onetCodes.flatMap((c) => tasks.get(c) ?? []);
        const orderedTasks = [...t.filter((x) => x.core), ...t.filter((x) => !x.core)].map((x) => x.text);
        const k = s.onetCodes.flatMap((c) => tech.get(c) ?? []);
        const orderedTech = [...new Set([...k.filter((x) => x.hot), ...k.filter((x) => !x.hot)].map((x) => x.name))];
        return {
            soc,
            title: s.title,
            description: s.onetCodes.map((c) => desc.get(c)).find(Boolean) ?? '',
            tasks: [...new Set(orderedTasks)].slice(0, MAX_TASKS),
            technology: orderedTech.slice(0, MAX_TECH),
        };
    });
}

// ── The local filter (BM25) ─────────────────────────────────────────────────

/**
 * Catalog entries never offered: those whose own description carries a
 * retirement warning ("This certification and the renewal assessment are
 * retired", "...will retire on November 30, 2026"). The Step 1 retired check
 * only knew one wording; these 35 or so passed it.
 */
export const RETIREMENT_WARNING = /\b(is|are|was|were|has been|have been|been)\s+(fully\s+)?retired\b|\bwill retire\b|\bassessment has been retired\b/i;
/**
 * Generic office-software certifications (Microsoft Office Specialist: Word,
 * Excel, Outlook, PowerPoint, Access, Microsoft 365 Apps) are never offered
 * either: O*NET lists Office for almost every job, and the first full run
 * (prompt v2) gave them to 113 jobs, 300 of 610 matches, mostly weak (freight
 * agents, file clerks, production supervisors). The two that teach a subject,
 * Excel for Accounting and Excel for Business Finance, stay.
 */
export const GENERIC_OFFICE = /^Microsoft Office Specialist:(?!.*\bfor (Accounting|Business Finance)\b)/i;
export const usable = (e: CatalogEntry): boolean => !RETIREMENT_WARNING.test(`${e.title} ${e.description ?? ''}`) && !GENERIC_OFFICE.test(e.title);

const STOP = new Set(`a an the and or of for to in on with by at from as into over under about via per than then that this these those is are be been being it its their them they you your we our us not no nor all any each other such may can will would should must also more most both either etc
use used using uses perform performs performing provide provides providing ensure ensures maintain maintains maintaining prepare prepares preparing review reviews reviewing work works working worker workers others other duties duty task tasks job jobs including include includes related various specific specified according needed necessary required requirements make makes making determine determines activities activity information new based well able
learn learning course courses training module modules path paths introduction intro basic basics fundamentals overview get started getting start guide part level beginner intermediate advanced microsoft google cloud certified certification certificate professional skills skill badge`.split(/\s+/));

export function tokens(s: string): string[] {
    return s
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9+#]+/)
        .filter((w) => w.length > 1 && !/^\d+$/.test(w))
        .map((w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
        .filter((w) => !STOP.has(w));
}

export interface Index {
    docs: { id: string; tf: Map<string, number>; len: number }[];
    df: Map<string, number>;
    avgLen: number;
}

/** Title counts 3 times, tags twice, description once. */
export function buildIndex(entries: CatalogEntry[]): Index {
    const docs = entries.map((e) => {
        const words = [...tokens(e.title), ...tokens(e.title), ...tokens(e.title), ...(e.tags ?? []).flatMap((t) => [...tokens(t), ...tokens(t)]), ...tokens(e.description ?? '')];
        const tf = new Map<string, number>();
        for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
        return { id: e.id, tf, len: words.length };
    });
    const df = new Map<string, number>();
    for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    return { docs, df, avgLen: docs.reduce((a, d) => a + d.len, 0) / Math.max(docs.length, 1) };
}

/** Query words and weights: job title 3, technology skills 2, tasks 1 (each word counted once per source). */
export function queryFor(job: JobProfile): Map<string, number> {
    const q = new Map<string, number>();
    const add = (text: string, w: number) => { for (const t of new Set(tokens(text))) q.set(t, Math.max(q.get(t) ?? 0, w)); };
    for (const t of job.tasks) add(t, 1);
    for (const t of job.technology) add(t, 2);
    add(job.title, 3);
    return q;
}

export interface Scored { id: string; score: number }

/** BM25 (k1 1.2, b 0.75), the top `size` with a score above zero, ties by id. */
export function shortlist(index: Index, job: JobProfile, size = SHORTLIST_SIZE): Scored[] {
    const q = queryFor(job);
    const n = index.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    const out: Scored[] = [];
    for (const d of index.docs) {
        let s = 0;
        for (const [w, weight] of q) {
            const tf = d.tf.get(w);
            if (!tf) continue;
            const df = index.df.get(w) ?? 0;
            const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
            s += weight * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.len) / index.avgLen)));
        }
        if (s > 0) out.push({ id: d.id, score: s });
    }
    return out.sort((a, b2) => b2.score - a.score || a.id.localeCompare(b2.id)).slice(0, size);
}

// ── The prompt ──────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You recommend courses for a career website used by university students and working people. You get one job, with its main tasks and the tools and technology it uses, and a list of candidate courses and certifications from a fixed catalog.

Pick 0 to 5 candidates that would genuinely help someone doing this job, or training for it, do the job's actual work better or earn a credential employers value for it.

A candidate fits only if its subject is central to this job's listed tasks or tools. These do not fit:
- a candidate that only shares a word with the job, or is generic (general AI, Copilot, cloud or productivity training);
- general office software courses and certifications (Word, Excel, Outlook, PowerPoint, Access, Microsoft 365 apps), unless working in that software is a core part of this job's listed tasks, as it is for accounting, bookkeeping or financial analysis;
- a course written for the people who set up, administer, customize or build a product (its tags name roles such as Administrator, Developer or Functional Consultant) when this job only uses the product;
- a course about a product this job does not list;
- a course about a tool that is only in the tool list but not used in the main tasks above: the tool list includes every program any worker in the job reported, so a tool there (SQL, Python, Kafka, a database) counts only when the main tasks are that kind of work;
- AI assistant and chatbot courses (Copilot, Gemini and similar), unless the job itself builds or runs AI systems;
- a certification for a different occupation: a credential fits only the people it certifies (a fitness certification fits fitness trainers, not drivers or clinicians).

Most of the catalog is Microsoft and Google technology training, so for many jobs, especially hands-on, care, trade and service jobs, nothing fits: returning no picks is correct and common. Never pick a weak match just to have something.

For each pick, give its id exactly as written in the list and one plain sentence (at most 25 words) naming the listed task or tool of this job it helps with. Do not claim the job does something that is not in its task or tool list. Order picks from most to least useful.`;

export const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        picks: {
            type: 'array',
            items: {
                type: 'object',
                properties: { id: { type: 'string' }, reason: { type: 'string' } },
                required: ['id', 'reason'],
                additionalProperties: false,
            },
        },
    },
    required: ['picks'],
    additionalProperties: false,
} as const;

const clip = (s: string | undefined, n: number) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
};

/** One line per candidate: id, title, provider, type, level, a short description, a few tags. */
export function candidateLine(e: CatalogEntry): string {
    const meta = [e.provider, e.type, e.level].filter(Boolean).join(', ');
    const tags = (e.tags ?? []).slice(0, 5).join(', ');
    return `- id: ${e.id}\n  ${e.title} (${meta})${e.description ? `\n  ${clip(e.description, 160)}` : ''}${tags ? `\n  Tags: ${tags}` : ''}`;
}

export function userPrompt(job: JobProfile, candidates: CatalogEntry[]): string {
    return [
        `Job: ${job.title} (SOC ${job.soc})`,
        job.description ? `What they do: ${clip(job.description, 400)}` : '',
        job.tasks.length ? `Main tasks:\n${job.tasks.map((t) => `- ${t}`).join('\n')}` : '',
        job.technology.length ? `Tools and technology they use: ${job.technology.join(', ')}` : '',
        '',
        `Candidate courses (${candidates.length}):`,
        ...candidates.map(candidateLine),
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

/** The Messages request body for one job (no stream: it goes into a batch). */
export function requestParams(job: JobProfile, candidates: CatalogEntry[]) {
    return {
        model: MATCH_MODEL,
        max_tokens: MAX_TOKENS,
        // Same as the app's scoring calls: Sonnet 5 with thinking off, so the token budget goes to the answer.
        thinking: { type: 'disabled' as const },
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema' as const, schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user' as const, content: userPrompt(job, candidates) }],
    };
}

/** Batch custom_id: ^[a-zA-Z0-9_-]{1,64}$. */
export const customIdFor = (soc: string) => `soc-${soc.replace(/[^0-9]/g, '')}`;
export const socForCustomId = (id: string) => {
    const m = id.match(/^soc-(\d{2})(\d{4})$/);
    return m ? `${m[1]}-${m[2]}` : null;
};

// ── The answer ──────────────────────────────────────────────────────────────

export interface Match { id: string; reason: string }
export interface Checked { kept: Match[]; rejected: { id: string; why: string }[] }

/** Only IDs from this job's shortlist, each once, at most 5, each with a reason. */
export function checkPicks(raw: unknown, shortlistIds: string[]): Checked {
    const allowed = new Set(shortlistIds);
    const kept: Match[] = [];
    const rejected: { id: string; why: string }[] = [];
    const picks = (raw as { picks?: unknown })?.picks;
    if (!Array.isArray(picks)) return { kept, rejected: [{ id: '', why: 'answer has no picks array' }] };
    for (const p of picks) {
        const id = typeof (p as Match)?.id === 'string' ? (p as Match).id.trim() : '';
        const reason = typeof (p as Match)?.reason === 'string' ? (p as Match).reason.replace(/\s+/g, ' ').trim() : '';
        if (!allowed.has(id)) rejected.push({ id, why: 'not in the shortlist' });
        else if (kept.some((k) => k.id === id)) rejected.push({ id, why: 'picked twice' });
        else if (!reason) rejected.push({ id, why: 'no reason' });
        else if (kept.length >= MAX_PICKS) rejected.push({ id, why: 'more than 5 picks' });
        else kept.push({ id, reason: reason.length > 240 ? `${reason.slice(0, 239)}…` : reason });
    }
    return { kept, rejected };
}

/** The answer text of a succeeded message: its first text block, as JSON. */
export function parseAnswer(message: { content?: { type: string; text?: string }[]; stop_reason?: string }): unknown {
    if (message.stop_reason && message.stop_reason !== 'end_turn') throw new Error(`stop_reason ${message.stop_reason}`);
    const text = message.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new Error('no text block');
    return JSON.parse(text);
}

// ── The saved responses and matches.json ────────────────────────────────────

export interface SavedResponse {
    soc: string;
    title: string;
    promptVersion: string;
    model: string;
    batchId: string;
    run: string;
    promptSha256: string;
    shortlist: string[];
    usage: { input_tokens: number; output_tokens: number };
    kept: Match[];
    rejected: { id: string; why: string }[];
    error?: string;
}

/** Every saved answer of the current prompt version, as matches.json; throws if any ID is not in the catalog. */
export function assembleMatches(responses: Record<string, SavedResponse>, scoredSocs: string[], catalogIds: Set<string>) {
    const matches: Record<string, Match[]> = {};
    const missing: string[] = [];
    for (const soc of [...scoredSocs].sort()) {
        const r = responses[soc];
        const current = r?.promptVersion === PROMPT_VERSION || (r && EMPTY_STILL_VALID.includes(r.promptVersion) && r.kept.length === 0);
        if (!r || !current || r.error) { missing.push(soc); continue; }
        for (const m of r.kept) if (!catalogIds.has(m.id)) throw new Error(`matches: ${soc} → ${m.id} is not in catalog.json`);
        matches[soc] = r.kept;
    }
    return { matches, missing };
}

/** The check the tests and the build run: every matched ID exists in the catalog, at most 5 per job, each once. */
export function matchProblems(matches: Record<string, Match[]>, catalogIds: Set<string>): string[] {
    const problems: string[] = [];
    for (const [soc, list] of Object.entries(matches)) {
        if (!/^\d{2}-\d{4}$/.test(soc)) problems.push(`${soc}: not a SOC code`);
        if (!Array.isArray(list)) { problems.push(`${soc}: not a list`); continue; }
        if (list.length > MAX_PICKS) problems.push(`${soc}: ${list.length} matches`);
        if (new Set(list.map((m) => m.id)).size !== list.length) problems.push(`${soc}: duplicate`);
        for (const m of list) {
            if (!catalogIds.has(m.id)) problems.push(`${soc}: ${m.id} is not in catalog.json`);
            if (!m.reason?.trim()) problems.push(`${soc}: ${m.id} has no reason`);
        }
    }
    return problems;
}

/** SOC major group names (2018 SOC), for the coverage table. */
export const SOC_MAJOR: Record<string, string> = {
    '11': 'Management', '13': 'Business and Financial Operations', '15': 'Computer and Mathematical', '17': 'Architecture and Engineering',
    '19': 'Life, Physical, and Social Science', '21': 'Community and Social Service', '23': 'Legal', '25': 'Educational Instruction and Library',
    '27': 'Arts, Design, Entertainment, Sports, and Media', '29': 'Healthcare Practitioners and Technical', '31': 'Healthcare Support',
    '33': 'Protective Service', '35': 'Food Preparation and Serving Related', '37': 'Building and Grounds Cleaning and Maintenance',
    '39': 'Personal Care and Service', '41': 'Sales and Related', '43': 'Office and Administrative Support', '45': 'Farming, Fishing, and Forestry',
    '47': 'Construction and Extraction', '49': 'Installation, Maintenance, and Repair', '51': 'Production', '53': 'Transportation and Material Moving',
};

export function coverage(matches: Record<string, Match[]>): { group: string; name: string; jobs: number; matched: number; none: number }[] {
    const rows = new Map<string, { jobs: number; matched: number }>();
    for (const [soc, list] of Object.entries(matches)) {
        const g = soc.slice(0, 2);
        const r = rows.get(g) ?? { jobs: 0, matched: 0 };
        r.jobs++;
        if (list.length > 0) r.matched++;
        rows.set(g, r);
    }
    return [...rows.entries()].sort().map(([group, r]) => ({ group, name: SOC_MAJOR[group] ?? group, jobs: r.jobs, matched: r.matched, none: r.jobs - r.matched }));
}

/** 20 jobs from different fields, for the pilot. */
export const PILOT_SOCS = [
    '29-1141', '31-1131', // nursing
    '47-2111', '47-2152', '49-3023', // trades
    '41-4012', '41-2031', // sales
    '13-2011', '43-3031', // accounting
    '15-1252', '15-1212', // software, security
    '15-2051', '13-1161', // data, marketing analytics
    '11-1021', '13-1071', '25-2021', '35-2014', '43-4051', '53-3032', '39-9031',
];
