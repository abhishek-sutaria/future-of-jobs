/**
 * Career paths data (scripts/build_career_paths.ts, docs/career-paths.md) and
 * its reader (utils/careerPaths): every committed output is exactly what the
 * pinned O*NET 30.1 files build; --check and the independent Python verifier
 * pass, and both fail on a stale or tampered file; 10 hand-picked links match
 * the raw Related Occupations.txt rows, read here on their own; no self-links;
 * direction, pay and AI Exposure helpers, with "no data" / "not scored" cases;
 * only utils/careerPaths imports the chunks, and they stay out of the entry
 * chunk of a real Vite build.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { build as viteBuild, type Rollup } from 'vite';
import {
    buildCareerPaths,
    CAREER_PATHS_LABEL as BUILD_LABEL,
    CAREER_PATHS_PATHS,
    loadCareerPathsInputs,
    outputFiles,
    staleOutputs,
} from '../../scripts/lib/careerPaths';
import { blsScoresPlugin } from '../../scripts/lib/blsScoresPlugin';
import {
    aiExposureFor,
    CAREER_PATHS_COVERAGE,
    CAREER_PATHS_FIELDS,
    CAREER_PATHS_LABEL,
    directionFor,
    getCareerPaths,
    payChange,
    payChangeFor,
    publishedRiskFor,
    wageFieldsFor,
} from '../utils/careerPaths';
import { BLS_SCORE_RISK, KELLEY_SOC_SCORES } from '../utils/blsScores';
import { ONET_CODES_FOR_SOC, ONET_SPLIT_CODES_WITHOUT_TASKS } from '../config/onetSplitCodes';
import { INDEX_OCCUPATION_BY_SOC, OCCUPATION_INDEX } from '../utils/occupationIndex';
import { bandFor } from '../utils/roleScale';
import { WAGES_BY_SOC, WAGES_META } from '../utils/wages';

const { roleScaleFor } = await import('../utils/allRoleScale');
const { useStore } = await import('../store');

const ROOT = path.resolve(__dirname, '../..');
const built = buildCareerPaths(loadCareerPathsInputs(ROOT));

/** Every input file of the build, relative to the repo root. */
const INPUTS = [
    CAREER_PATHS_PATHS.sources,
    CAREER_PATHS_PATHS.occupationsIndex,
    'data/db_30_1_text/Related Occupations.txt',
    'data/db_30_1_text/Job Zones.txt',
    'data/db_30_1_text/Job Zone Reference.txt',
    'data/db_30_1_text/Occupation Data.txt',
    'data/db_30_1_text/Read Me.txt',
    'src/config/onetSplitCodes.ts',
];

/** A copy of the inputs and committed outputs under a temp root. */
function tmpCopy(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'career-paths-'));
    for (const rel of [...INPUTS, ...outputFiles(built).map(([r]) => r)]) {
        fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel));
    }
    return tmp;
}

// ── The raw file, read here with nothing from the build ──
const rawLines = fs.readFileSync(path.join(ROOT, 'data/db_30_1_text/Related Occupations.txt'), 'utf-8').split('\r\n');
const rawLine = (line: number) => rawLines[line - 1];

type Chunk = { socs: Record<string, { jobZone: number | null; jobZoneRule: string; links: { to: string; tier: string; index: number; rows: number[] }[] }> };
const chunk = (major: string): Chunk => JSON.parse(fs.readFileSync(path.join(ROOT, CAREER_PATHS_PATHS.outDir, `${major}.json`), 'utf-8'));
const stored = (soc: string) => chunk(soc.slice(0, 2)).socs[soc];
const storedLink = (soc: string, to: string) => stored(soc).links.find((l) => l.to === to);

describe('the build', () => {
    it('writes exactly the committed files, and the same bytes every time', () => {
        const again = outputFiles(buildCareerPaths(loadCareerPathsInputs(ROOT)));
        expect(again).toEqual(outputFiles(built));
        expect(staleOutputs(ROOT, built)).toEqual([]);
        // 22 field chunks + index.json + zones.json + the report.
        expect(outputFiles(built)).toHaveLength(25);
    }, 30_000);

    it('--check passes on the committed files and fails when one is stale', () => {
        expect(() => execFileSync('npx', ['tsx', 'scripts/build_career_paths.ts', '--check'], { cwd: ROOT, stdio: 'pipe' })).not.toThrow();
        const tmp = tmpCopy();
        try {
            const ok = spawnSync('npx', ['tsx', 'scripts/build_career_paths.ts', '--check', '--root', tmp], { cwd: ROOT, encoding: 'utf-8' });
            expect(ok.status).toBe(0);
            const f = path.join(tmp, CAREER_PATHS_PATHS.outDir, '13.json');
            const before = fs.readFileSync(f, 'utf-8');
            const after = before.replace('{"to":"43-3031","tier":"Primary-Short","index":1,"rows":[1762]}', '{"to":"43-3031","tier":"Primary-Short","index":2,"rows":[1762]}');
            expect(after).not.toBe(before);
            fs.writeFileSync(f, after);
            fs.rmSync(path.join(tmp, CAREER_PATHS_PATHS.report));
            expect(staleOutputs(tmp, built)).toEqual([CAREER_PATHS_PATHS.report, `${CAREER_PATHS_PATHS.outDir}/13.json`]);
            const bad = spawnSync('npx', ['tsx', 'scripts/build_career_paths.ts', '--check', '--root', tmp], { cwd: ROOT, encoding: 'utf-8' });
            expect(bad.status).toBe(1);
            expect(bad.stderr).toContain('out of date: docs/career-paths.md, src/data/career_paths/13.json');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }, 60_000);

    it('stops when an input does not match its sha256', () => {
        const tmp = tmpCopy();
        try {
            const f = path.join(tmp, 'data/db_30_1_text/Job Zones.txt');
            fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace('13-2011.00\t4\t', '13-2011.00\t3\t'));
            expect(() => loadCareerPathsInputs(tmp)).toThrow(/sha256 mismatch for data\/db_30_1_text\/Job Zones\.txt/);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('pins version, release date and license of both O*NET files', () => {
        const s = JSON.parse(fs.readFileSync(path.join(ROOT, CAREER_PATHS_PATHS.sources), 'utf-8'));
        expect(s.onet.version).toBe('O*NET 30.1');
        expect(s.onet.release).toBe('December 2025 Release');
        expect(s.onet.license).toBe('CC BY 4.0');
        const paths = s.files.map((f: { path: string }) => f.path);
        expect(paths).toContain('data/db_30_1_text/Related Occupations.txt');
        expect(paths).toContain('data/db_30_1_text/Job Zones.txt');
        for (const f of s.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('the independent verifier (scripts/verify_career_paths.py)', () => {
    const verify = (root?: string) =>
        spawnSync('python3', ['-I', 'scripts/verify_career_paths.py', ...(root ? ['--root', root] : [])], { cwd: ROOT, encoding: 'utf-8' });

    it('passes on the committed data', () => {
        const r = verify();
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('All checks passed.');
    });

    it('fails on a link with a wrong tier, an invented link, a dropped row, and a wrong Job Zone', () => {
        const cases: [string, (s: string) => string, RegExp][] = [
            ['13.json', (s) => s.replace('"to":"43-3031","tier":"Primary-Short"', '"to":"43-3031","tier":"Primary-Long"'), /tier\/index Primary-Long\/1 != strongest row Primary-Short\/1/],
            ['47.json', (s) => s.replace('{"to":"47-2132","tier":"Supplemental","index":20,"rows":[13441]}', '{"to":"47-2132","tier":"Supplemental","index":20,"rows":[13441]},\n        {"to":"29-1141","tier":"Supplemental","index":20,"rows":[]}'), /47-2111 -> 29-1141: no source row/],
            ['13.json', (s) => s.replace('"to":"11-3031","tier":"Primary-Short","index":3,"rows":[1764,1766]', '"to":"11-3031","tier":"Primary-Short","index":3,"rows":[1764]'), /13-2011 -> 11-3031: rows \[1764\] != every row for the pair \[1764, 1766\]/],
            ['47.json', (s) => s.replace('"47-2111": {\n      "jobZone": 3,', '"47-2111": {\n      "jobZone": 4,'), /47-2111: Job Zone 4 \(\.00\) != 3 \(\.00\)/],
            // A combined job's link that also lists a part's sub-code row (the rule before this PR's Part A).
            ['29.json', (s) => s.replace('{"to":"29-2031","tier":"Primary-Short","index":5,"rows":[8706,8786]}', '{"to":"29-2031","tier":"Primary-Short","index":5,"rows":[8706,8735,8786]}'), /29-2010 -> 29-2031: line 8735 is from 29-2011\.01, but 29-2011\.00 has rows/],
        ];
        for (const [file, edit, message] of cases) {
            const tmp = tmpCopy();
            try {
                const f = path.join(tmp, CAREER_PATHS_PATHS.outDir, file);
                const before = fs.readFileSync(f, 'utf-8');
                expect(edit(before)).not.toBe(before);
                fs.writeFileSync(f, edit(before));
                const r = verify(tmp);
                expect(r.status).toBe(1);
                expect(r.stdout).toMatch(message);
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
        }
    }, 30_000);
});

describe('links match the raw O*NET file', () => {
    // Ten links, each with its raw rows copied here by hand from Related Occupations.txt.
    const PICKED: { soc: string; to: string; tier: string; index: number; rows: [number, string][] }[] = [
        // Accountants and Auditors -> Bookkeeping, Accounting, and Auditing Clerks
        { soc: '13-2011', to: '43-3031', tier: 'Primary-Short', index: 1, rows: [[1762, '13-2011.00\t43-3031.00\tPrimary-Short\t1']] },
        // Accountants and Auditors -> Financial Managers (two O*NET codes of 11-3031 merge; the stronger Index wins)
        { soc: '13-2011', to: '11-3031', tier: 'Primary-Short', index: 3, rows: [[1764, '13-2011.00\t11-3031.01\tPrimary-Short\t3'], [1766, '13-2011.00\t11-3031.00\tPrimary-Short\t5']] },
        // Budget Analysts -> Accountants and Auditors
        { soc: '13-2031', to: '13-2011', tier: 'Primary-Short', index: 1, rows: [[1822, '13-2031.00\t13-2011.00\tPrimary-Short\t1']] },
        // Budget Analysts -> Financial Managers (three rows, one Supplemental; the strongest tier wins)
        {
            soc: '13-2031', to: '11-3031', tier: 'Primary-Short', index: 2,
            rows: [[1823, '13-2031.00\t11-3031.01\tPrimary-Short\t2'], [1824, '13-2031.00\t11-3031.00\tPrimary-Short\t3'], [1836, '13-2031.00\t11-3031.03\tSupplemental\t15']],
        },
        // Electricians -> Lighting Technicians
        { soc: '47-2111', to: '27-4015', tier: 'Primary-Short', index: 1, rows: [[13422, '47-2111.00\t27-4015.00\tPrimary-Short\t1']] },
        // Electricians -> Electrical, Electronic, and Electromechanical Assemblers (a combined job, through 51-2022.00)
        { soc: '47-2111', to: '51-2028', tier: 'Primary-Long', index: 7, rows: [[13428, '47-2111.00\t51-2022.00\tPrimary-Long\t7']] },
        // Electricians -> Insulation Workers, Mechanical (the last one, Supplemental 20)
        { soc: '47-2111', to: '47-2132', tier: 'Supplemental', index: 20, rows: [[13441, '47-2111.00\t47-2132.00\tSupplemental\t20']] },
        // Buyers and Purchasing Agents (combined: 13-1021 + 13-1022 + 13-1023) -> Purchasing Managers
        {
            soc: '13-1020', to: '11-3061', tier: 'Primary-Short', index: 2,
            rows: [[1145, '13-1021.00\t11-3061.00\tPrimary-Short\t4'], [1165, '13-1022.00\t11-3061.00\tPrimary-Short\t4'], [1183, '13-1023.00\t11-3061.00\tPrimary-Short\t2']],
        },
        // Registered Nurses -> Nurse Practitioners: only the 29-1141.00 row (own code first), not the sub-codes' rows
        { soc: '29-1141', to: '29-1171', tier: 'Primary-Short', index: 2, rows: [[8023, '29-1141.00\t29-1171.00\tPrimary-Short\t2']] },
        // Software Developers -> Computer Occupations, All Other (five sub-codes of 15-1299)
        {
            soc: '15-1252', to: '15-1299', tier: 'Primary-Short', index: 1,
            rows: [
                [2342, '15-1252.00\t15-1299.08\tPrimary-Short\t1'],
                [2351, '15-1252.00\t15-1299.05\tPrimary-Long\t10'],
                [2353, '15-1252.00\t15-1299.07\tSupplemental\t12'],
                [2360, '15-1252.00\t15-1299.04\tSupplemental\t19'],
                [2361, '15-1252.00\t15-1299.09\tSupplemental\t20'],
            ],
        },
    ];

    it.each(PICKED.map((p) => [`${p.soc} -> ${p.to}`, p] as const))('%s', (_name, p) => {
        for (const [line, text] of p.rows) expect(rawLine(line)).toBe(text);
        expect(storedLink(p.soc, p.to)).toEqual({ to: p.to, tier: p.tier, index: p.index, rows: p.rows.map(([l]) => l) });
    });

    it('own code first: Registered Nurses\' links are exactly the 29-1141.00 rows, in O*NET order', () => {
        // Read here from the raw file: every 29-1141.00 row, in file order.
        const own = rawLines
            .map((text, i) => ({ line: i + 1, cells: text.split('\t') }))
            .filter((r) => r.cells[0] === '29-1141.00');
        expect(own).toHaveLength(20);
        // A related code maps to its seven-character SOC (every target here is an app job); self-links drop.
        const expected = own
            .filter((r) => r.cells[1].slice(0, 7) !== '29-1141')
            .map((r) => ({ to: r.cells[1].slice(0, 7), tier: r.cells[2], index: Number(r.cells[3]), rows: [r.line] }));
        expect(new Set(expected.map((e) => e.to)).size).toBe(expected.length); // no two rows share a target
        expect(stored('29-1141').links).toEqual(expected);
        expect(stored('29-1141').links).toHaveLength(16);
        // 29-1141.00 lists 4 of its own sub-codes (Index 1, 3, 4, 7): self-links, dropped.
        expect(own.filter((r) => r.cells[1].startsWith('29-1141.')).map((r) => Number(r.cells[3]))).toEqual([1, 3, 4, 7]);
        // Nothing from the sub-codes: Psychiatrists (29-1223) is related only to 29-1141.02.
        const psych = rawLines.findIndex((t) => t.startsWith('29-1141.02\t29-1223.00\t')) + 1;
        expect(psych).toBeGreaterThan(1);
        expect(stored('29-1141').links.some((l) => l.to === '29-1223')).toBe(false);
        expect(stored('29-1141').links.flatMap((l) => l.rows)).not.toContain(psych);
        expect(built.ownCodeChanges.find((x) => x.soc === '29-1141')).toMatchObject({ before: 27, after: 16, rowsNotUsed: 80 });
    });

    it('a target sub-code still maps to its parent job', () => {
        // Accountants and Auditors (own .00) -> 11-3031.01 and 11-3031.00 are both Financial Managers.
        expect(storedLink('13-2011', '11-3031')?.rows).toEqual([1764, 1766]);
        expect(rawLine(1764)).toBe('13-2011.00\t11-3031.01\tPrimary-Short\t3');
    });

    it('a combined job with no .00 code (13-1020) merges the rows of all its parts', () => {
        // A related code's job, written here: its own SOC if that is an app job, else the combined job listing it.
        const appSocs = new Set(OCCUPATION_INDEX.occupations.map((o) => o.soc));
        const targetJob = (code: string): string | undefined => {
            const soc = code.slice(0, 7);
            if (appSocs.has(soc)) return soc;
            return Object.entries({ ...ONET_CODES_FOR_SOC }).find(([, cs]) => cs.some((c) => c.slice(0, 7) === soc))?.[0]
                ?? Object.entries({ ...ONET_SPLIT_CODES_WITHOUT_TASKS }).find(([, cs]) => cs.some((c) => c.slice(0, 7) === soc))?.[0];
        };
        const partRows = rawLines
            .map((text, i) => ({ line: i + 1, cells: text.split('\t') }))
            .filter((r) => ['13-1021.00', '13-1022.00', '13-1023.00'].includes(r.cells[0]));
        expect(partRows).toHaveLength(60);
        const job = stored('13-1020');
        expect(job.onetCodes).toEqual(['13-1021.00', '13-1022.00', '13-1023.00']);
        const used = job.links.flatMap((l) => l.rows).sort((a, b) => a - b);
        // Every part row is in exactly one link, except rows between the parts themselves (self-links).
        const parts = /^13-102[123]\./;
        const expectedRows = partRows.filter((r) => !parts.test(r.cells[1])).map((r) => r.line);
        expect(used).toEqual(expectedRows);
        const rank: Record<string, number> = { 'Primary-Short': 0, 'Primary-Long': 1, Supplemental: 2 };
        for (const l of job.links) {
            const rows = l.rows.map((n) => rawLine(n).split('\t'));
            for (const c of rows) expect(targetJob(c[1])).toBe(l.to);
            const best = rows.map((c) => [rank[c[2]], Number(c[3])]).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
            expect([rank[l.tier], l.index]).toEqual(best);
        }
        expect(job.jobZone).toBeNull();
        expect(job.jobZoneRule).toBe('mixed');
    });

    it('a combined job takes each part\'s own .00 rows only (29-2010 and 53-1047), the same rule as its Job Zone', () => {
        const rows = rawLines.map((text, i) => ({ line: i + 1, cells: text.split('\t') }));
        // 29-2010 = 29-2011 + 29-2012. Both parts have a .00 code with rows, and sub-codes with rows too.
        const fromCode = (c: string) => rows.filter((r) => r.cells[0] === c);
        for (const c of ['29-2011.00', '29-2012.00', '29-2011.01', '29-2011.02', '29-2011.04', '29-2012.01']) expect(fromCode(c)).toHaveLength(20);
        const job = stored('29-2010');
        expect(job.onetCodes).toEqual(['29-2011.00', '29-2012.00']);
        const used = new Set(job.links.flatMap((l) => l.rows));
        for (const c of ['29-2011.01', '29-2011.02', '29-2011.04', '29-2012.01']) {
            for (const r of fromCode(c)) expect(used.has(r.line), `${c} line ${r.line}`).toBe(false);
        }
        // Every .00 row of both parts is used, except rows between the two parts (self-links).
        const expected = [...fromCode('29-2011.00'), ...fromCode('29-2012.00')].filter((r) => !/^29-201[12]\./.test(r.cells[1])).map((r) => r.line);
        expect([...used].sort((a, b) => a - b)).toEqual(expected);
        expect(job.links).toHaveLength(19);
        // Its zone reads the same codes: each part's .00 (4 and 3, so mixed).
        expect(job.jobZoneRule).toBe('mixed');
        expect(built.mixed.find((m) => m.soc === '29-2010')?.codes.map((c) => c.code)).toEqual(['29-2011.00', '29-2012.00']);
        // 53-1047: 53-1042.01 is not used, 53-1042.00 is.
        expect(fromCode('53-1042.01')).toHaveLength(20);
        expect(stored('53-1047').onetCodes).toEqual(['53-1042.00', '53-1043.00', '53-1044.00']);
        const used53 = new Set(stored('53-1047').links.flatMap((l) => l.rows));
        for (const r of fromCode('53-1042.01')) expect(used53.has(r.line)).toBe(false);
        expect(built.ownCodeChanges.filter((x) => x.combined).map((x) => [x.soc, x.subCodes, x.after])).toEqual([
            ['29-2010', ['29-2011.01', '29-2011.02', '29-2011.04', '29-2012.01'], 19],
            ['53-1047', ['53-1042.01'], 23],
        ]);
        // A part with no .00 code still uses its sub-code: 47-4090 = 47-4091.00 + 47-4099.03 (47-4099.00 has no rows).
        expect(fromCode('47-4099.00')).toHaveLength(0);
        expect(stored('47-4090').onetCodes).toEqual(['47-4091.00', '47-4099.03']);
        expect(built.counts.links).toBe(14_896);
    });

    it('stores no self-link, and every link has source rows naming its own job and its target', () => {
        let links = 0;
        for (const major of CAREER_PATHS_FIELDS) {
            for (const [soc, job] of Object.entries(chunk(major).socs)) {
                const targets = new Set<string>();
                for (const l of job.links) {
                    links++;
                    expect(l.to).not.toBe(soc);
                    expect(targets.has(l.to)).toBe(false);
                    targets.add(l.to);
                    expect(l.rows.length).toBeGreaterThan(0);
                    for (const line of l.rows) expect(rawLine(line)).toMatch(/^\d\d-\d{4}\.\d\d\t\d\d-\d{4}\.\d\d\t(Primary-Short|Primary-Long|Supplemental)\t\d+$/);
                }
            }
        }
        expect(links).toBe(built.counts.links);
    });

    it('keeps O*NET order: tier, then Index', () => {
        const rank = { 'Primary-Short': 0, 'Primary-Long': 1, Supplemental: 2 } as Record<string, number>;
        for (const major of CAREER_PATHS_FIELDS) {
            for (const job of Object.values(chunk(major).socs)) {
                const keys = job.links.map((l) => rank[l.tier] * 1000 + l.index);
                expect(keys).toEqual([...keys].sort((a, b) => a - b));
            }
        }
        expect(stored('47-2111').links.map((l) => l.index)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('stores nothing for a job O*NET has nothing for, and says so in the coverage', () => {
        expect(CAREER_PATHS_COVERAGE).toMatchObject({ jobs: 830, withLinks: 783, withFivePlus: 783, noData: 47 });
        expect(stored('11-9039')).toBeUndefined(); // Education Administrators, All Other
        expect(built.unmapped.map((u) => u.code)).toEqual(['11-1031.00', '45-3031.00']);
        expect(CAREER_PATHS_LABEL).toBe('Similar jobs you could move to (O*NET, by similar skills and work)');
        expect(BUILD_LABEL).toBe(CAREER_PATHS_LABEL);
    });
});

describe('the reader (utils/careerPaths)', () => {
    it('getCareerPaths gives each link its direction from the Job Zone difference', async () => {
        const cp = await getCareerPaths('13-2011');
        expect(cp?.jobZone).toBe(4);
        expect(cp?.links.map((l) => l.to)).toEqual(stored('13-2011').links.map((l) => l.to));
        const bookkeeping = cp!.links.find((l) => l.to === '43-3031')!;
        expect([bookkeeping.jobZone, bookkeeping.direction]).toEqual([3, 'down']);
        const budget = cp!.links.find((l) => l.to === '13-2031')!;
        expect([budget.jobZone, budget.direction]).toEqual([4, 'same']);
        const electricians = await getCareerPaths('47-2111');
        expect(electricians?.jobZone).toBe(3);
        expect(electricians?.links.find((l) => l.to === '27-4015')?.direction).toBe('same');
        // Electricians' 20 related jobs are all zone 2 or 3: none is a step up.
        expect(electricians!.links.some((l) => l.direction === 'up')).toBe(false);
        for (const l of electricians!.links) expect(l.direction).toBe(l.jobZone === 3 ? 'same' : 'down');
        // Bookkeeping clerks (zone 3) -> Accountants and Auditors (zone 4) is a step up.
        const clerks = await getCareerPaths('43-3031');
        expect(clerks?.links.find((l) => l.to === '13-2011')).toMatchObject({ tier: 'Supplemental', index: 11, jobZone: 4, direction: 'up' });
    });

    it('direction is null when either zone is missing (mixed)', async () => {
        const buyers = await getCareerPaths('13-1020');
        expect(buyers?.jobZone).toBeNull();
        expect(buyers?.jobZoneRule).toBe('mixed');
        expect(buyers!.links.every((l) => l.direction === null)).toBe(true);
        const dev = await getCareerPaths('15-1252');
        expect(dev?.links.find((l) => l.to === '15-1299')).toMatchObject({ jobZone: null, direction: null });
        expect(directionFor(2, 4)).toBe('up');
        expect(directionFor(4, 4)).toBe('same');
        expect(directionFor(5, 1)).toBe('down');
        expect(directionFor(null, 3)).toBeNull();
        expect(directionFor(3, undefined)).toBeNull();
    });

    it('returns null ("no data") for a job O*NET has nothing for, and for a SOC that is not an app job', async () => {
        expect(await getCareerPaths('11-9039')).toBeNull();
        expect(await getCareerPaths('99-9999')).toBeNull();
    });

    it('pay change is the difference of the two published median annual wages', () => {
        const a = INDEX_OCCUPATION_BY_SOC.get('13-2011')!.annualMedian!;
        const b = INDEX_OCCUPATION_BY_SOC.get('13-2031')!.annualMedian!;
        expect(payChangeFor('13-2011', '13-2031')).toEqual({ kind: 'change', from: a, to: b, difference: b - a });
        expect(payChange({ annualMedian: 50_000, topcoded: {} }, { annualMedian: 62_500, topcoded: {} })).toEqual({ kind: 'change', from: 50_000, to: 62_500, difference: 12_500 });
    });

    it('a top-coded wage gives a flag with the BLS cap, never an exact difference', () => {
        const top = { annualMedian: null, topcoded: { annualMedian: true } };
        const plain = { annualMedian: 80_000, topcoded: {} };
        const cap = WAGES_META.topcode.annual;
        expect(cap).toBe(239_200);
        expect(payChange(plain, top)).toEqual({ kind: 'topcoded', fromTopcoded: false, toTopcoded: true, cap });
        expect(payChange(top, plain)).toEqual({ kind: 'topcoded', fromTopcoded: true, toTopcoded: false, cap });
        expect(payChange(top, top)).toEqual({ kind: 'topcoded', fromTopcoded: true, toTopcoded: true, cap });
        // Even if a top-coded entry carried a number, it is not used as an exact wage.
        expect(payChange(plain, { annualMedian: cap, topcoded: { annualMedian: true } })).toMatchObject({ kind: 'topcoded' });
    });

    it('a missing wage gives null: hourly-only jobs, unpublished wages, unknown SOCs', () => {
        // Actors: BLS publishes only hourly wages, so there is no annual median.
        expect(INDEX_OCCUPATION_BY_SOC.get('27-2011')!.annualMedian).toBeNull();
        expect(payChangeFor('13-2011', '27-2011')).toBeNull();
        expect(payChangeFor('27-2011', '13-2011')).toBeNull();
        expect(payChangeFor('13-2011', '99-9999')).toBeNull();
        expect(payChange({ annualMedian: null, topcoded: { annualMedian: true } }, { annualMedian: null, topcoded: {} })).toBeNull();
        expect(payChange(null, { annualMedian: 1, topcoded: {} })).toBeNull();
    });

    it('reads the same wages as the role panel: national_wages.json for Kelley codes, the occupations data for the rest', async () => {
        for (const [soc, w] of Object.entries(WAGES_BY_SOC)) {
            expect(wageFieldsFor(soc)).toEqual({ annualMedian: w.annualMedian, topcoded: w.topcoded });
            expect(INDEX_OCCUPATION_BY_SOC.get(soc)?.annualMedian).toBe(w.annualMedian);
        }
        expect(wageFieldsFor('47-2111')).toEqual({ annualMedian: INDEX_OCCUPATION_BY_SOC.get('47-2111')!.annualMedian, topcoded: {} });
        expect(wageFieldsFor('47-2111', { annualMedian: null, topcoded: { annualMedian: true } })).toEqual({ annualMedian: null, topcoded: { annualMedian: true } });
    });

    it('no OEWS May 2025 annual median is top-coded, and the index holds the same median as each occupation file', async () => {
        // The index carries no top-code flag. That is safe only while this holds;
        // if a data refresh brings a top-coded median, carry the flag into the index.
        const { loadContinentFile, INDEX_CONTINENTS } = await import('../utils/occupationIndex');
        let checked = 0;
        for (const c of INDEX_CONTINENTS) {
            const file = await loadContinentFile(c.code);
            for (const [soc, e] of Object.entries(file.occupations)) {
                expect(e.topcoded.annualMedian ?? false).toBe(false);
                expect(INDEX_OCCUPATION_BY_SOC.get(soc)?.annualMedian).toBe(e.annualMedian);
                checked++;
            }
        }
        expect(checked).toBe(OCCUPATION_INDEX.occupations.length);
        for (const w of Object.values(WAGES_BY_SOC)) expect(w.topcoded.annualMedian).toBe(false);
    }, 30_000);

    it('AI Exposure is the map\'s own band from the published score, or "not scored"', () => {
        const scale = roleScaleFor(useStore.getState().jobs);
        // A non-Kelley job (bundled risks) and a Kelley job (its SOC entry).
        expect(BLS_SCORE_RISK.has('47-2111')).toBe(true);
        expect(aiExposureFor('47-2111', scale)).toEqual({ risk: BLS_SCORE_RISK.get('47-2111'), band: bandFor(BLS_SCORE_RISK.get('47-2111')!, scale) });
        expect(KELLEY_SOC_SCORES.has('13-2011')).toBe(true);
        const r = KELLEY_SOC_SCORES.get('13-2011')!.automationCostIndex;
        expect(aiExposureFor('13-2011', scale)).toEqual({ risk: r, band: bandFor(r, scale) });
        // Every scored job has a published risk; the 47 with no tasks are "not scored".
        const unscored = OCCUPATION_INDEX.occupations.filter((o) => publishedRiskFor(o.soc) === undefined).map((o) => o.soc);
        expect(unscored).toHaveLength(47);
        // They are exactly the 47 jobs with no career paths data.
        expect(unscored).toEqual(built.noData.map((j) => j.soc));
        expect(aiExposureFor('11-9039', scale)).toBe('not scored');
        expect(aiExposureFor('99-9999', scale)).toBe('not scored');
    });
});

describe('loading', () => {
    it('only utils/careerPaths imports the chunks, through import.meta.glob, not eagerly', () => {
        const IMPORTS = /(?:from\s*|import\s*\(\s*|import\.meta\.glob[^(]*\(\s*)['"][^'"]*career_paths\//;
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (e.name !== '__tests__' && e.name !== 'data') walk(p);
                } else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && IMPORTS.test(fs.readFileSync(p, 'utf-8'))) hits.push(path.relative(ROOT, p));
            }
        };
        walk(path.join(ROOT, 'src'));
        expect(hits).toEqual(['src/utils/careerPaths.ts']);
        const src = fs.readFileSync(path.join(ROOT, 'src/utils/careerPaths.ts'), 'utf-8');
        expect(src.match(/^import .*career_paths.*$/gm)).toEqual(["import indexJson from '../data/career_paths/index.json';"]);
        expect(src).toContain("import.meta.glob<FieldChunk>('../data/career_paths/[0-9][0-9].json', { import: 'default' })");
        expect(src).toContain("import.meta.glob<ZonesChunk>('../data/career_paths/zones.json', { import: 'default' })");
        expect(src).not.toMatch(/eager:\s*true/);
        expect(CAREER_PATHS_FIELDS).toHaveLength(22);
        // index.json, the only file a static import reaches, stays small.
        expect(fs.statSync(path.join(ROOT, CAREER_PATHS_PATHS.index)).size).toBeLessThan(4_000);
    });

    it('a real Vite build keeps every chunk out of the entry chunk', async () => {
        const result = (await viteBuild({
            configFile: false,
            root: ROOT,
            logLevel: 'silent',
            plugins: [blsScoresPlugin()],
            build: {
                write: false,
                minify: false,
                rollupOptions: { input: path.join(ROOT, 'src/utils/careerPaths.ts'), preserveEntrySignatures: 'strict' },
            },
        })) as Rollup.RollupOutput | Rollup.RollupOutput[];
        const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
        const entry = outputs.filter((o) => o.isEntry);
        expect(entry).toHaveLength(1);
        const code = entry[0].code;
        expect(code).not.toContain('lazy chunk; only src/utils/careerPaths.ts loads it');
        expect(code).not.toContain('jobZoneRows');
        expect(code).toContain('Similar jobs you could move to (O*NET, by similar skills and work)');
        for (const major of CAREER_PATHS_FIELDS) {
            const own = outputs.filter((o) => !o.isEntry && o.code.includes(`BLS SOC major group ${major}-0000`));
            expect(own, `chunk for ${major}`).toHaveLength(1);
            expect(entry[0].dynamicImports).toContain(own[0].fileName);
        }
        const zones = outputs.filter((o) => !o.isEntry && o.code.includes('Job Zone of every app job'));
        expect(zones).toHaveLength(1);
        expect(entry[0].dynamicImports).toContain(zones[0].fileName);
    }, 120_000);
});
