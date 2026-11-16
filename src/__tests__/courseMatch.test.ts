/**
 * Matching catalog courses to jobs (scripts/lib/courseMatch.ts): the job
 * profiles from O*NET, the local shortlist, the prompt, and the strict check
 * of Claude's answer (shortlist IDs only, at most 5, each once). Plus the
 * committed matches.json: every ID is in catalog.json. No network here.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    assembleMatches,
    buildIndex,
    buildProfiles,
    checkPicks,
    costUsd,
    coverage,
    customIdFor,
    matchProblems,
    parseAnswer,
    PILOT_SOCS,
    PROMPT_VERSION,
    queryFor,
    readOnetTsv,
    requestParams,
    shortlist,
    socForCustomId,
    tokens,
    usable,
    userPrompt,
    type JobProfile,
    type SavedResponse,
} from '../../scripts/lib/courseMatch';
import type { CatalogEntry } from '../../scripts/lib/courseCatalog';

const entry = (id: string, title: string, description = '', tags: string[] = []): CatalogEntry =>
    ({ id, title, provider: 'Microsoft Learn', url: `https://learn.microsoft.com/en-us/training/paths/${id}/`, type: 'course', price: 'unknown', description, tags, lastChecked: '2026-11-15' });

const CATALOG = [
    entry('excel-accounting', 'Microsoft Office Specialist: Excel for Accounting Associate', 'Prepare accounting data, a trial balance and financial statements.', ['Excel', 'Finance']),
    entry('powerbi', 'Analyze data with Power BI', 'Build reports and dashboards.', ['Power BI', 'Data Analyst']),
    entry('kubernetes', 'Manage Kubernetes clusters', 'Deploy containers.', ['Kubernetes']),
    entry('audit', 'Audit and search activity in Microsoft Purview', 'Audit logs for compliance investigations.', ['Auditor']),
    entry('retired', 'Microsoft Certified: Old Thing', 'Warning This certification and the renewal assessment are retired. Learn more.'),
];

const ACCOUNTANT: JobProfile = {
    soc: '13-2011',
    title: 'Accountants and Auditors',
    description: 'Examine, analyze, and interpret accounting records to prepare financial statements.',
    tasks: ['Prepare detailed reports on audit findings.', 'Prepare, examine, or analyze accounting records and financial statements.'],
    technology: ['Microsoft Excel', 'Intuit QuickBooks'],
};

describe('job profiles from O*NET', () => {
    it('reads O*NET tab files and puts Core tasks and Hot Technology first, over every O*NET code of the job', () => {
        const tasks = readOnetTsv('O*NET-SOC Code\tTask ID\tTask\tTask Type\n13-2011.00\t1\tSupplemental task.\tSupplemental\n13-2011.00\t2\tCore task.\tCore\n13-2011.01\t3\tOther code task.\tCore\n');
        const tech = readOnetTsv('O*NET-SOC Code\tExample\tCommodity Code\tCommodity Title\tHot Technology\tIn Demand\n13-2011.00\tAcme\t1\tx\tN\tN\n13-2011.00\tMicrosoft Excel\t2\tx\tY\tN\n13-2011.01\tMicrosoft Excel\t2\tx\tY\tN\n');
        const occ = readOnetTsv('O*NET-SOC Code\tTitle\tDescription\n13-2011.00\tAccountants\tExamine records.\n');
        const [p] = buildProfiles({ '13-2011': { title: 'Accountants and Auditors', onetCodes: ['13-2011.00', '13-2011.01'] } }, tasks, tech, occ);
        expect(p).toEqual({ soc: '13-2011', title: 'Accountants and Auditors', description: 'Examine records.', tasks: ['Core task.', 'Other code task.', 'Supplemental task.'], technology: ['Microsoft Excel', 'Acme'] });
    });
});

describe('the local shortlist', () => {
    it('drops stop words, generic course words and provider names; singularizes', () => {
        expect(tokens('Learn the basics of Microsoft Excel spreadsheets for Accountants')).toEqual(['excel', 'spreadsheet', 'accountant']);
        expect(tokens('C# and C++ on Google Cloud')).toEqual(['c#', 'c++']);
    });

    it('weights the job title above technology above tasks', () => {
        const q = queryFor(ACCOUNTANT);
        expect(q.get('accountant')).toBe(3);
        expect(q.get('excel')).toBe(2);
        expect(q.get('financial')).toBe(1);
    });

    it('ranks the entries that share the job\'s rare words, leaves out unrelated ones', () => {
        const list = shortlist(buildIndex(CATALOG), ACCOUNTANT, 30).map((s) => s.id);
        expect(list[0]).toBe('excel-accounting');
        expect(list).toContain('audit');
        expect(list).not.toContain('kubernetes');
    });

    it('never offers an entry whose own description says it is retired or will retire', () => {
        expect(usable(CATALOG[0])).toBe(true);
        expect(usable(CATALOG[4])).toBe(false);
        expect(usable(entry('x', 'X', 'Warning This certification, and related exam will retire on November 30, 2026.'))).toBe(false);
        expect(usable(entry('y', 'Y', 'MOS 2013 certifications were fully retired on June 30, 2024.'))).toBe(false);
        expect(usable(entry('z', 'Retirement planning basics', 'Plan for retirement savings.'))).toBe(true);
    });

    it('never offers generic Office Specialist certifications, only the two that teach a subject', () => {
        expect(usable(entry('a', 'Microsoft Office Specialist: Excel Associate (Office 2019)'))).toBe(false);
        expect(usable(entry('b', 'Microsoft Office Specialist: Excel for Operational Management Associate'))).toBe(false);
        expect(usable(entry('c', 'Microsoft Office Specialist: Outlook Associate (Office 2019)'))).toBe(false);
        expect(usable(entry('d', 'Microsoft Office Specialist: Excel for Accounting Associate'))).toBe(true);
        expect(usable(entry('e', 'Microsoft Office Specialist: Excel for Business Finance Associate'))).toBe(true);
        expect(usable(entry('f', 'Analyze data with Power BI'))).toBe(true);
    });
});

describe('the prompt', () => {
    it('gives the job, its tasks and tools, and every candidate with its id', () => {
        const text = userPrompt(ACCOUNTANT, CATALOG.slice(0, 2));
        expect(text).toContain('Job: Accountants and Auditors (SOC 13-2011)');
        expect(text).toContain('- Prepare detailed reports on audit findings.');
        expect(text).toContain('Tools and technology they use: Microsoft Excel, Intuit QuickBooks');
        expect(text).toContain('- id: excel-accounting');
        expect(text).toContain('Candidate courses (2):');
    });

    it('is the app\'s model with thinking off and a fixed answer schema (no stream, batch-ready)', () => {
        const p = requestParams(ACCOUNTANT, CATALOG.slice(0, 2));
        expect(p.model).toBe('claude-sonnet-5');
        expect(p.thinking).toEqual({ type: 'disabled' });
        expect(p.output_config.format.type).toBe('json_schema');
        expect(p.output_config.format.schema.required).toEqual(['picks']);
        expect(p).not.toHaveProperty('stream');
        expect(p).not.toHaveProperty('temperature');
        expect(p.system).toMatch(/returning no picks is correct and common/);
        // the schema is the same for every job, so it compiles once
        expect(JSON.stringify(requestParams({ ...ACCOUNTANT, soc: '15-1252' }, CATALOG).output_config)).toBe(JSON.stringify(p.output_config));
    });

    it('custom ids round-trip and fit the batch pattern', () => {
        expect(customIdFor('13-2011')).toBe('soc-132011');
        expect(customIdFor('13-2011')).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        expect(socForCustomId('soc-132011')).toBe('13-2011');
        expect(socForCustomId('nope')).toBeNull();
    });
});

describe('checking Claude\'s answer', () => {
    const allowed = ['excel-accounting', 'audit', 'powerbi', 'a', 'b', 'c'];

    it('keeps only shortlist IDs, each once, with a reason, at most 5', () => {
        const got = checkPicks({ picks: [
            { id: 'excel-accounting', reason: ' Prepares trial balances  in Excel. ' },
            { id: 'kubernetes', reason: 'Not offered.' },
            { id: 'excel-accounting', reason: 'Again.' },
            { id: 'audit', reason: '' },
            { id: 'powerbi', reason: 'Reports.' },
            { id: 'a', reason: 'A.' }, { id: 'b', reason: 'B.' }, { id: 'c', reason: 'C.' },
            { id: 'audit', reason: 'Audit logs.' },
        ] }, allowed);
        expect(got.kept.map((k) => k.id)).toEqual(['excel-accounting', 'powerbi', 'a', 'b', 'c']);
        expect(got.kept[0].reason).toBe('Prepares trial balances in Excel.');
        expect(got.rejected).toEqual([
            { id: 'kubernetes', why: 'not in the shortlist' },
            { id: 'excel-accounting', why: 'picked twice' },
            { id: 'audit', why: 'no reason' },
            { id: 'audit', why: 'more than 5 picks' },
        ]);
    });

    it('accepts no picks, and rejects a malformed answer', () => {
        expect(checkPicks({ picks: [] }, allowed)).toEqual({ kept: [], rejected: [] });
        expect(checkPicks({ courses: [] }, allowed).kept).toEqual([]);
        expect(checkPicks(null, allowed).rejected[0].why).toMatch(/no picks/);
    });

    it('reads the JSON text block; a cut-off answer is an error, not an empty match', () => {
        expect(parseAnswer({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"picks":[]}' }] })).toEqual({ picks: [] });
        expect(() => parseAnswer({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"picks":[' }] })).toThrow(/max_tokens/);
        expect(() => parseAnswer({ stop_reason: 'end_turn', content: [] })).toThrow(/no text/);
    });
});

describe('matches.json', () => {
    const saved = (soc: string, kept: { id: string; reason: string }[], extra: Partial<SavedResponse> = {}): SavedResponse =>
        ({ soc, title: soc, promptVersion: PROMPT_VERSION, model: 'claude-sonnet-5', batchId: 'msgbatch_x', run: 'msgbatch_x', promptSha256: 'x', shortlist: kept.map((k) => k.id), usage: { input_tokens: 1, output_tokens: 1 }, kept, rejected: [], ...extra });
    const ids = new Set(CATALOG.map((e) => e.id));

    it('keeps only current-version answers without errors; a job may have none', () => {
        const { matches, missing } = assembleMatches({
            '13-2011': saved('13-2011', [{ id: 'excel-accounting', reason: 'Excel.' }]),
            '29-1141': saved('29-1141', []),
            '15-1252': saved('15-1252', [], { promptVersion: 'old' }),
            '15-2051': saved('15-2051', [], { promptVersion: 'course-match-v2' }),
            '13-1161': saved('13-1161', [{ id: 'powerbi', reason: 'Reports.' }], { promptVersion: 'course-match-v2' }),
            '47-2111': saved('47-2111', [], { error: 'errored' }),
        }, ['13-2011', '29-1141', '15-1252', '47-2111', '53-3032', '15-2051', '13-1161'], ids);
        // an empty v2 answer still stands under the stricter v3; a v2 answer with matches must be asked again
        expect(matches).toEqual({ '13-2011': [{ id: 'excel-accounting', reason: 'Excel.' }], '29-1141': [], '15-2051': [] });
        expect(missing).toEqual(['13-1161', '15-1252', '47-2111', '53-3032']);
    });

    it('fails the build on an ID that is not in the catalog', () => {
        expect(() => assembleMatches({ '13-2011': saved('13-2011', [{ id: 'ghost', reason: 'x' }]) }, ['13-2011'], ids)).toThrow(/ghost is not in catalog.json/);
        expect(matchProblems({ '13-2011': [{ id: 'ghost', reason: 'x' }] }, ids)).toEqual(['13-2011: ghost is not in catalog.json']);
    });

    it('coverage by SOC major group', () => {
        expect(coverage({ '13-2011': [{ id: 'a', reason: 'r' }], '13-1161': [], '29-1141': [] })).toEqual([
            { group: '13', name: 'Business and Financial Operations', jobs: 2, matched: 1, none: 1 },
            { group: '29', name: 'Healthcare Practitioners and Technical', jobs: 1, matched: 0, none: 1 },
        ]);
    });

    it('batch pricing: $1 / $5 per million tokens', () => {
        expect(costUsd(1_000_000, 100_000)).toBeCloseTo(1.5);
        expect(PILOT_SOCS).toHaveLength(20);
        expect(new Set(PILOT_SOCS).size).toBe(20);
    });

    const file = path.join(__dirname, '../../data/course_catalog/matches.json');
    it.skipIf(!fs.existsSync(file))('the committed matches.json: every ID is in catalog.json, at most 5 per job, the current prompt and model', () => {
        const m = JSON.parse(fs.readFileSync(file, 'utf8')) as { _meta: { promptVersion: string; model: string }; matches: Record<string, { id: string; reason: string }[]> };
        const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/course_catalog/catalog.json'), 'utf8')) as { entries: CatalogEntry[] };
        const catalogIds = new Set(catalog.entries.map((e) => e.id));
        expect(m._meta.promptVersion).toBe(PROMPT_VERSION);
        expect(m._meta.model).toBe('claude-sonnet-5');
        expect(matchProblems(m.matches, catalogIds)).toEqual([]);
        const retired = new Set(catalog.entries.filter((e) => !usable(e)).map((e) => e.id));
        for (const list of Object.values(m.matches)) for (const x of list) expect(retired.has(x.id)).toBe(false);
    });
});
