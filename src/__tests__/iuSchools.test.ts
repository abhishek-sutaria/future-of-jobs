/**
 * The IU Bloomington schools data (scripts/build_iu_schools.ts): the committed
 * files are exactly what the committed sources build, twice over; spot checks
 * against the real NCES crosswalk; the SOC roll-up; and the rules never guess
 * (a code IU Bloomington does not report at a program's level is dropped, and a
 * program with no rule stops the build). Method and gaps: docs/iu-schools.md.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildIuSchools,
    collectPrograms,
    IU_SCHOOLS_PATHS,
    loadIuSchoolInputs,
    matchProgram,
    parseCrosswalk,
    parseIpeds,
    reportedAt,
    serialize,
    sha256,
    socRollup,
    subjectOf,
    type IuSchoolsFull,
    type IuSchoolsSlim,
    type Program,
    type RulesFile,
} from '../../scripts/lib/iuSchools';
import fullFile from '../data/iu_schools.json';
import slimFile from '../data/iu_school_jobs.json';
import planAll from '../../data/bls_score_plan_all.json';

const ROOT = path.resolve(__dirname, '../..');
const inputs = loadIuSchoolInputs(ROOT);
const built = buildIuSchools(inputs);
const full = fullFile as unknown as IuSchoolsFull;
const slim = slimFile as unknown as IuSchoolsSlim;
const xw = parseCrosswalk(inputs.crosswalk);
const ipeds = parseIpeds(inputs.ipedsCsv);
const indianapolis = parseIpeds(inputs.otherIpeds['151111'], '151111');
const appSocs = new Set(inputs.occupations.map((o) => o.soc));
const school = (id: string) => full.schools.find((s) => s.id === id)!;

describe('the build', () => {
    it('writes exactly the committed files, and the same bytes every time', () => {
        const again = buildIuSchools(loadIuSchoolInputs(ROOT));
        expect(serialize(again.full)).toBe(serialize(built.full));
        expect(again.report).toBe(built.report);
        expect(serialize(built.full)).toBe(fs.readFileSync(path.join(ROOT, IU_SCHOOLS_PATHS.full), 'utf-8'));
        expect(serialize(built.slim)).toBe(fs.readFileSync(path.join(ROOT, IU_SCHOOLS_PATHS.slim), 'utf-8'));
        expect(built.report).toBe(fs.readFileSync(path.join(ROOT, IU_SCHOOLS_PATHS.report), 'utf-8'));
    });

    it('checks every raw source against the sha256 in sources.json', () => {
        for (const f of inputs.sources.files) {
            expect(sha256(fs.readFileSync(path.join(ROOT, 'data/iu_schools', f.path))), f.path).toBe(f.sha256);
            expect(f.url).toMatch(/^https:\/\//);
            expect(f.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        expect(inputs.sources.files.map((f) => f.url)).toEqual(expect.arrayContaining([
            'https://nces.ed.gov/ipeds/cipcode/Files/CIP2020_SOC2018_Crosswalk.xlsx',
            'https://nces.ed.gov/ipeds/datacenter/data/C2024_A.zip',
        ]));
    });

    it('holds IU Bloomington only (UNITID 151351) in the IPEDS extract', () => {
        expect(() => parseIpeds(inputs.ipedsCsv, '999999')).toThrow(/151351/);
        expect(ipeds.size).toBeGreaterThan(150);
    });

    it('lists the 16 degree-granting schools by their official names, Hutton Honors left out', () => {
        expect(full.schools.map((s) => s.name)).toEqual([
            'College of Arts and Sciences',
            'Eskenazi School of Art, Architecture, and Design',
            'Graduate School Bloomington',
            'Hamilton Lugar School of Global and International Studies',
            'Jacobs School of Music',
            'Kelley School of Business',
            'Luddy School of Informatics, Computing, and Engineering',
            'Maurer School of Law',
            'The Media School',
            'O’Neill School of Public and Environmental Affairs',
            'School of Education',
            'School of Medicine',
            'School of Nursing',
            'School of Optometry',
            'School of Public Health - Bloomington',
            'School of Social Work',
        ]);
        expect(full._meta.excludedSchools.map((e) => e.name)).toEqual(['Hutton Honors College']);
    });

    it('keeps a school with no jobs out of the dropdown data, and says so in the report', () => {
        const empty = full.schools.filter((s) => s.jobs.length === 0);
        for (const s of full.schools) expect(s.inDropdown, s.name).toBe(s.jobs.length > 0);
        expect(slim.schools.map((s) => s.id)).toEqual(full.schools.filter((s) => s.inDropdown).map((s) => s.id));
        for (const s of empty) expect(built.report).toContain(s.name);
        expect(built.report).toMatch(/Kept out of the dropdown \(0 jobs\)/);
    });

    it('gives the app only real app jobs, the same as the full file', () => {
        for (const s of slim.schools) {
            expect(s.jobs, s.name).toEqual(school(s.id).jobs);
            for (const soc of s.jobs) expect(appSocs.has(soc), `${s.name} ${soc}`).toBe(true);
            expect([...s.jobs].sort()).toEqual(s.jobs);
        }
    });

    it('uses only codes IU Bloomington reports at each program\'s own level (or, for a reviewed campus rule, that campus)', () => {
        for (const s of full.schools) {
            for (const m of s.majors) {
                const data = m.campusUnitid === '151111' ? indianapolis : ipeds;
                if (m.campusUnitid) expect(m.campusUnitid).toBe('151111');
                for (const cip of m.cips) expect(reportedAt(data, cip, m.level), `${m.name} ${m.degree} ${cip}`).toBe(true);
                if (m.cips.length === 0) expect(m.reason, `${m.name} ${m.degree}`).toBeTruthy();
            }
        }
    });

    it('keeps the "Not scored" jobs: a school can lead to them like any other', () => {
        const unscored = new Set((planAll as { jobs: { soc: string; taskRule: string }[] }).jobs.filter((j) => j.taskRule === 'no-tasks').map((j) => j.soc));
        expect(unscored.size).toBe(47);
        const reached = slim.schools.flatMap((s) => s.jobs).filter((soc) => unscored.has(soc));
        expect(reached.length).toBeGreaterThan(0);
    });
});

describe('spot checks against the real crosswalk', () => {
    it('Accounting (52.0301) leads to Accountants and Auditors; general business (52.0101) does not', () => {
        expect(xw.cipTitle.get('52.0301')).toBe('Accounting.');
        expect(xw.cipSocs.get('52.0301')).toContain('13-2011');
        expect(xw.cipSocs.get('52.0101')).not.toContain('13-2011');
    });

    it('Computer Science (11.0701) leads to Software Developers', () => {
        expect(xw.cipSocs.get('11.0701')).toContain('15-1252');
        expect(xw.socTitle.get('15-1252')).toBe('Software Developers');
    });

    it('Kelley reaches Accountants and Auditors through its master\'s in accounting, not the BSB major', () => {
        const kelley = school('kelley');
        expect(kelley.jobs).toContain('13-2011');
        const bsb = kelley.majors.find((m) => m.name === 'Accounting' && m.degree === 'Bachelor of Science in Business')!;
        expect(bsb.cips).toEqual(['52.0101']);
        expect(bsb.basis).toBe('degree');
        expect(bsb.jobs).not.toContain('13-2011');
        const msa = kelley.majors.find((m) => m.degree === 'Master of Science in Accounting with Data and Analytics')!;
        expect(msa.cips).toEqual(['52.0301', '52.0305']);
        expect(msa.jobs).toContain('13-2011');
    });

    it('a Luddy Computer Science major leads to Software Developers', () => {
        const cs = school('luddy').majors.find((m) => m.name === 'Computer Science' && m.degree === 'Bachelor of Science in Computer Science')!;
        expect(cs.cips).toEqual(['11.0701']);
        expect(cs.jobs).toContain('15-1252');
        expect(school('luddy').jobs).toContain('15-1252');
    });

    it('Nursing (BSN) is 51.3801, as IU Indianapolis reports it, and leads to Registered Nurses', () => {
        expect(reportedAt(ipeds, '51.3801', 'B')).toBe(false);
        expect(indianapolis.get('51.3801')?.get('5')).toBe(555);
        expect(() => parseIpeds(inputs.otherIpeds['151111'], '151351')).toThrow(/151111/);
        const nursing = school('nursing');
        expect(nursing.inDropdown).toBe(true);
        const bsn = nursing.majors.filter((m) => m.degree === 'Bachelor of Science in Nursing');
        expect(bsn).toHaveLength(3);
        for (const m of bsn) expect(m).toMatchObject({ cips: ['51.3801'], campusUnitid: '151111', basis: 'reviewed' });
        expect(nursing.jobs).toEqual(['25-1072', '29-1141']);
        const msn = nursing.majors.find((m) => m.degree === 'Master of Science in Nursing')!;
        expect(msn.cips).toEqual([]);
        expect(full.cips['51.3801']).toMatchObject({ iubAwards: {}, campusAwards: { '151111': { '5': 555, '7': 0 } } });
        expect(built.report).toMatch(/### Codes confirmed at another IU campus[\s\S]*51\.3801, as IU Indianapolis \(UNITID 151111\)/);
    });

    it('Optometry leads to Optometrists; the Maurer J.D. to Lawyers', () => {
        expect(school('optometry').jobs).toContain('29-1041');
        const jd = school('maurer').majors.find((m) => m.degree === 'Doctor of Jurisprudence')!;
        expect(jd.cips).toEqual(['22.0101']);
        expect(jd.jobs).toContain('23-1011');
    });
});

describe('SOC roll-up', () => {
    const { parts, toApp } = socRollup(appSocs);

    it('a detailed code the app has is itself; one inside a combined BLS code rolls up to it', () => {
        expect(toApp('15-1252')).toBe('15-1252');
        expect(toApp('13-1022')).toBe('13-1020');
        expect(toApp('13-2022')).toBe('13-2020');
        expect(toApp('21-1014')).toBe('21-1018');
        expect(toApp('25-9049')).toBe('25-9045');
        expect(toApp('53-1049')).toBe('53-1047');
    });

    it('anything else is not an app job', () => {
        expect(toApp('55-1015')).toBeNull();
        expect(toApp('11-1031')).toBeNull();
    });

    it('covers every app code that is not a SOC 2018 detailed code', () => {
        const combined = [...appSocs].filter((soc) => !xw.socTitle.has(soc)).sort();
        expect(Object.keys(parts)).toEqual(combined);
        expect(combined).toHaveLength(12);
        for (const list of Object.values(parts)) for (const soc of list) expect(xw.socTitle.has(soc), soc).toBe(true);
    });
});

describe('matching rules never guess', () => {
    const rules = inputs.rules;
    const program = (over: Partial<Program>): Program => ({
        url: 'https://example.invalid/p', name: 'X', degree: 'Master of Public Health', typeName: 'Master of Public Health', level: 'M', subject: 'X', schools: ['public-health'], ...over,
    });

    it('drops a code IU Bloomington does not report at the program\'s level, with the reason', () => {
        const m = matchProgram(program({ name: 'Epidemiology', subject: 'Epidemiology' }), rules, ipeds);
        expect(reportedAt(ipeds, '26.1309', 'M')).toBe(false);
        expect(m.cips).toEqual([]);
        expect(m.reason).toMatch(/26\.1309 is not reported by IU Bloomington at master's level/);
    });

    it('a campus rule is checked against that campus, and dropped if it does not report the code there', () => {
        const others = new Map([['151111', indianapolis]]);
        const bsn = program({ name: 'Nursing', subject: 'Nursing', degree: 'Bachelor of Science in Nursing', level: 'B', schools: ['nursing'] });
        expect(matchProgram(bsn, rules, ipeds, others)).toMatchObject({ cips: ['51.3801'], campusUnitid: '151111' });
        const doctoral = matchProgram({ ...bsn, level: 'D' }, rules, ipeds, others);
        expect(doctoral.cips).toEqual([]);
        expect(doctoral.reason).toMatch(/not reported by IU Indianapolis at doctoral level/);
        expect(() => matchProgram(bsn, rules, ipeds)).toThrow(/no IPEDS extract/);
    });

    it('stops on a program with no rule rather than guessing', () => {
        expect(() => matchProgram(program({ name: 'Underwater Basket Weaving', subject: 'Underwater Basket Weaving' }), rules, ipeds)).toThrow(/No rule/);
        const bare: RulesFile = { ...rules, subjectRules: [] };
        expect(() => buildIuSchools({ ...inputs, rules: bare })).toThrow(/programs have no rule/);
    });

    it('a double major takes both codes; a whole degree takes its one code', () => {
        const dm = matchProgram(program({ name: 'Computer Science/Philosophy', degree: 'Bachelor of Arts', level: 'B', subject: 'Computer Science/Philosophy' }), rules, ipeds);
        expect(dm.cips.sort()).toEqual(['11.0701', '38.0101']);
        expect(dm.basis).toBe('double-major');
        const bsb = matchProgram(program({ name: 'Finance', degree: 'Bachelor of Science in Business', level: 'B', subject: 'Finance' }), rules, ipeds);
        expect(bsb).toMatchObject({ cips: ['52.0101'], basis: 'degree' });
    });

    it('reads a program\'s subject without its parentheses or BFA tag', () => {
        expect(subjectOf('Art History (History BA)')).toBe('Art History');
        expect(subjectOf('Contemporary Dance (Dance BFA)')).toBe('Contemporary Dance');
        expect(subjectOf('Musical Theatre BFA')).toBe('Musical Theatre');
        expect(subjectOf('Business  Analytics (100% online)')).toBe('Business Analytics');
    });

    it('merges rows that share a URL into one program with every listed school', () => {
        const { programs } = collectPrograms(inputs.api, rules, inputs.schools);
        expect(new Set(programs.map((p) => p.url)).size).toBe(programs.length);
        const cl = programs.find((p) => p.url.endsWith('/master-of-science/computational-linguistics.html'))!;
        // Listed under the College and the Graduate School: the College is its academic home.
        expect(cl.schools).toEqual(['coas']);
    });
});
