/**
 * The IU Bloomington schools data (scripts/build_iu_schools.ts): the committed
 * files are exactly what the committed sources build, twice over; spot checks
 * against the real NCES crosswalk; the SOC roll-up; and the rules never guess
 * (a code IU Bloomington does not report at a program's level is dropped, and a
 * program with no rule stops the build). A 'title-match' major (IPEDS files its
 * whole degree under one general code) takes the CIP 2020 code its name matches,
 * and the Kelley School always includes the 50 Kelley roles. Method and gaps:
 * docs/iu-schools.md.
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
    parseCampusIpeds,
    parseCipCodes,
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
import { KELLEY_SOC_SET } from '../utils/kelleySocs';

const ROOT = path.resolve(__dirname, '../..');
const inputs = loadIuSchoolInputs(ROOT);
const built = buildIuSchools(inputs);
const full = fullFile as unknown as IuSchoolsFull;
const slim = slimFile as unknown as IuSchoolsSlim;
const xw = parseCrosswalk(inputs.crosswalk);
const ipeds = parseIpeds(inputs.ipedsCsv);
const indianapolis = parseCampusIpeds(inputs).get('151111')!;
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
                if (m.basis === 'title-match') {
                    // Its own code is not in IPEDS; the general code IPEDS files its degree under is.
                    expect(m.campusUnitid).toBeUndefined();
                    expect(reportedAt(ipeds, m.ipedsCip!, m.level), `${m.name} ${m.degree} ${m.ipedsCip}`).toBe(true);
                    continue;
                }
                expect(m.ipedsCip).toBeUndefined();
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

    it('Kelley reaches Accountants and Auditors through the BSB Accounting major (title match) and its master\'s in accounting', () => {
        const kelley = school('kelley');
        expect(kelley.jobs).toContain('13-2011');
        const bsb = kelley.majors.find((m) => m.name === 'Accounting' && m.degree === 'Bachelor of Science in Business')!;
        expect(bsb).toMatchObject({ cips: ['52.0301'], basis: 'title-match', ipedsCip: '52.0101' });
        expect(bsb.jobs).toContain('13-2011');
        const msa = kelley.majors.find((m) => m.degree === 'Master of Science in Accounting with Data and Analytics')!;
        expect(msa.cips).toEqual(['52.0301', '52.0305']);
        expect(msa.jobs).toContain('13-2011');
    });

    it('every Kelley major IPEDS files under 52.0101 has its own rule: 32 majors (13 BSB, 18 MBA, the PhD)', () => {
        const kelley = school('kelley');
        const lumped = kelley.majors.filter((m) => m.ipedsCip === '52.0101' || m.cips.includes('52.0101'));
        expect(lumped.length).toBe(32);
        expect(lumped.filter((m) => m.degree === 'Bachelor of Science in Business').length).toBe(13);
        expect(lumped.filter((m) => m.degree === 'Master of Business Administration').length).toBe(18);
        const keep = lumped.filter((m) => m.basis !== 'title-match').map((m) => `${m.degree} / ${m.name}`).sort();
        expect(keep).toEqual([
            'Bachelor of Science in Business / Business',
            'Bachelor of Science in Business / Economic Consulting',
            'Bachelor of Science in Business / Management',
            'Doctor of Philosophy / Business',
            'Master of Business Administration / Management (80-99% online)',
            'Master of Business Administration / Strategic Analysis Accounting Information',
            'Master of Business Administration / Strategic Management Consulting',
            'Master of Business Administration / Strategy and Leadership',
            'Master of Business Administration / Strategy and Leadership (80-99% online)',
            'Master of Business Administration / Technology Leadership in Organizations (80-99% online)',
        ]);
        for (const m of keep) expect(lumped.find((x) => `${x.degree} / ${x.name}` === m)!.cips).toEqual(['52.0101']);
    });

    it('Marketing and Professional Sales (52.1401 + 52.1804) leads to sales jobs; Marketing to marketing jobs', () => {
        const kelley = school('kelley');
        const mps = kelley.majors.find((m) => m.name === 'Marketing and Professional Sales')!;
        expect(mps).toMatchObject({ cips: ['52.1401', '52.1804'], basis: 'title-match' });
        expect(xw.cipTitle.get('52.1804')).toBe('Selling Skills and Sales Operations.');
        expect(mps.jobs).toEqual(expect.arrayContaining(['11-2021', '13-1161', '41-3091', '41-4011']));
        const mkt = kelley.majors.find((m) => m.name === 'Marketing' && m.degree === 'Bachelor of Science in Business')!;
        expect(mkt.cips).toEqual(['52.1401']);
        expect(mkt.jobs).toContain('11-2021');
        expect(xw.cipSocs.get('52.0101')!.some((soc) => soc.startsWith('41-'))).toBe(false);
    });

    it('the Kelley School always includes the 50 Kelley roles, labelled kelley-roles', () => {
        const kelley = school('kelley');
        const roles = [...KELLEY_SOC_SET].sort();
        expect(roles.length).toBe(47);
        expect(kelley.roles).toMatchObject({ basis: 'kelley-roles', jobs: roles });
        for (const soc of roles) expect(kelley.jobs, soc).toContain(soc);
        expect(kelley.roles!.added).toEqual(roles.filter((soc) => !kelley.majorJobs.includes(soc)));
        expect(kelley.jobs).toEqual([...new Set([...kelley.majorJobs, ...roles])].sort());
        expect(slim.schools.find((s) => s.id === 'kelley')!.jobs).toEqual(kelley.jobs);
        // No other school has roles added; its jobs are exactly what its majors lead to.
        for (const s of full.schools.filter((x) => x.id !== 'kelley')) {
            expect(s.roles, s.name).toBeUndefined();
            expect(s.jobs, s.name).toEqual(s.majorJobs);
        }
    });

    it('every title-match code is a CIP 2020 code with the crosswalk\'s title, and every major rule has a note', () => {
        const cip2020 = parseCipCodes(inputs.cipCodesCsv);
        expect(cip2020.get('52.1401')).toBe('Marketing/Marketing Management, General.');
        for (const r of inputs.rules.majorRules) {
            expect(r.note.length, `${r.degree} / ${r.subject}`).toBeGreaterThan(20);
            if (r.basis === 'title-match') {
                expect(r.ipedsCip, `${r.degree} / ${r.subject}`).toBeTruthy();
                for (const c of r.cips) expect(cip2020.get(c), c).toBe(xw.cipTitle.get(c));
            } else {
                expect(r.ipedsCip).toBeUndefined();
            }
        }
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
        expect(() => parseIpeds(inputs.otherIpeds['raw/ipeds_c2024_a_unitid_151111_cip51_38.csv'], '151351')).toThrow(/151111/);
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

    it('the BSW is 44.0701, as IU Indianapolis reports it; IU Bloomington reports it only for the MSW', () => {
        expect(reportedAt(ipeds, '44.0701', 'B')).toBe(false);
        expect(reportedAt(ipeds, '44.0701', 'M')).toBe(true);
        expect(indianapolis.get('44.0701')?.get('5')).toBe(134);
        const sw = school('social-work');
        const bsw = sw.majors.find((m) => m.degree === 'Bachelor of Social Work')!;
        expect(bsw).toMatchObject({ cips: ['44.0701'], campusUnitid: '151111', basis: 'reviewed' });
        expect(bsw.jobs).toContain('21-1021');
        for (const m of sw.majors.filter((x) => x.degree === 'Master of Social Work')) expect(m.campusUnitid).toBeUndefined();
        expect(sw.matchedMajorCount).toBe(sw.majorCount);
        expect(full.cips['44.0701'].campusAwards?.['151111']?.['5']).toBe(134);
        expect(built.report).toMatch(/Social Work, Bachelor of Social Work \(School of Social Work\): 44\.0701, as IU Indianapolis \(UNITID 151111\) reports it at bachelor's level; IU Bloomington reports it only at master's level\./);
    });

    it('each IU Indianapolis extract holds only its own codes, and the two never overlap', () => {
        const nursing = parseIpeds(inputs.otherIpeds['raw/ipeds_c2024_a_unitid_151111_cip51_38.csv'], '151111');
        const social = parseIpeds(inputs.otherIpeds['raw/ipeds_c2024_a_unitid_151111_cip44_0701.csv'], '151111');
        expect([...nursing.keys()].every((c) => c.startsWith('51.38'))).toBe(true);
        expect([...social.keys()]).toEqual(['44.0701']);
        expect(indianapolis.size).toBe(nursing.size + social.size);
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
        const bsb = matchProgram(program({ name: 'Business', degree: 'Bachelor of Science in Business', level: 'B', subject: 'Business' }), rules, ipeds);
        expect(bsb).toMatchObject({ cips: ['52.0101'], basis: 'degree' });
        const fin = matchProgram(program({ name: 'Finance', degree: 'Bachelor of Science in Business', level: 'B', subject: 'Finance' }), rules, ipeds);
        expect(fin).toMatchObject({ cips: ['52.0801'], basis: 'title-match', ipedsCip: '52.0101' });
    });

    it('a new major of a reviewed degree stops the build until it has its own rule', () => {
        expect(() => matchProgram(program({ name: 'Underwater Finance', degree: 'Bachelor of Science in Business', level: 'B', subject: 'Underwater Finance' }), rules, ipeds)).toThrow(/No major rule/);
    });

    it('a title match needs its degree\'s general code reported at the program\'s level, and a kept code must be the degree\'s', () => {
        const bad: RulesFile = { ...rules, majorRules: rules.majorRules.map((r) => (r.degree === 'Bachelor of Science in Business' && r.subject === 'Finance' ? { ...r, ipedsCip: '52.0301' } : r)) };
        expect(reportedAt(ipeds, '52.0301', 'B')).toBe(false);
        expect(() => matchProgram(program({ name: 'Finance', degree: 'Bachelor of Science in Business', level: 'B', subject: 'Finance' }), bad, ipeds)).toThrow(/ipedsCip/);
        const wrongKeep: RulesFile = { ...rules, majorRules: rules.majorRules.map((r) => (r.degree === 'Bachelor of Science in Business' && r.subject === 'Management' ? { ...r, cips: ['52.0201'] } : r)) };
        expect(() => matchProgram(program({ name: 'Management', degree: 'Bachelor of Science in Business', level: 'B', subject: 'Management' }), wrongKeep, ipeds)).toThrow(/keeps its degree's code/);
        const ghost: RulesFile = { ...rules, majorRules: [...rules.majorRules, { degree: 'Bachelor of Science in Business', subject: 'Ghost', cips: ['52.0801'], basis: 'title-match', ipedsCip: '52.0101', note: 'test' }] };
        expect(() => buildIuSchools({ ...inputs, rules: ghost })).toThrow(/matches no program/);
        const notCip: RulesFile = { ...rules, majorRules: rules.majorRules.map((r) => (r.subject === 'Real Estate' ? { ...r, cips: ['52.9998'] } : r)) };
        expect(() => buildIuSchools({ ...inputs, rules: notCip })).toThrow(/not a CIP 2020 code/);
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
