/**
 * Outside-study check: do published, independent AI-exposure scores rank jobs
 * the way our Automation Risk does? A CHECK only: it reads files and writes
 * data/outside_study/results.json. It changes no score, colour or app code and
 * makes no API call.
 *
 *   npx tsx scripts/outside_study_check.ts
 *
 * Inputs (all pinned in data/outside_study/sources.json, sha256 checked here):
 *   src/data/ai_scores_bls.json                    our 783 scored jobs
 *   data/outside_study/raw/occ_level.csv           GPTs are GPTs, job level (alpha, beta, gamma; GPT-4 and human raters)
 *   data/outside_study/raw/full_labelset.tsv       GPTs are GPTs, task level (same labels, one row per O*NET task)
 *   data/outside_study/raw/ms_ai_applicability_scores.csv  Microsoft "Working with AI", AI applicability score
 *   data/db_30_1_text/Task Ratings.txt, Task Statements.txt  O*NET 30.1 importance and Core/Supplemental
 *
 * Our colours come from the app's own code (buildRiskScale + riskBand over all
 * 783 scored jobs). Their thirds use the same rule (value at floor(n x 1/3) and
 * floor(n x 2/3) of the sorted list; at or above the upper cut is red) over the
 * jobs that match. Nothing is estimated or filled in: a job with no match is
 * listed as unmatched.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRiskScale, riskBand, type RiskBand } from '../src/config/theme';
import { parseBlsScores, type RawBlsFile } from '../src/utils/blsScoresData';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rd = (rel: string) => fs.readFileSync(path.join(ROOT, rel));
const OUT = 'data/outside_study/results.json';

// ── Pinned inputs ───────────────────────────────────────────────────────────
interface SourceFile { path: string; sha256: string }
const sources = JSON.parse(rd('data/outside_study/sources.json').toString()) as { files: SourceFile[] };
for (const f of sources.files) {
    const got = crypto.createHash('sha256').update(rd(f.path)).digest('hex');
    if (got !== f.sha256) throw new Error(`sha256 mismatch for ${f.path}: ${got}`);
}

/** Delimited text with "quoted" fields ("" inside quotes is one quote). */
function parseDelimited(text: string, sep: string): Record<string, string>[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"' && field === '') quoted = true;
        else if (c === sep) { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const [head, ...body] = rows;
    return body.map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
}

// ── Our scores and colours (the app's own code) ─────────────────────────────
const rawOurs = JSON.parse(rd('src/data/ai_scores_bls.json').toString()) as RawBlsFile & {
    scores: Record<string, { rule: string; onetCodes: string[] }>;
};
const ours = parseBlsScores(rawOurs).scores;
const SOCS = [...ours.keys()].sort();
const appScale = buildRiskScale(SOCS.map((s) => ours.get(s)!.automationCostIndex));
const ourBand = new Map<string, RiskBand>(SOCS.map((s) => [s, riskBand(ours.get(s)!.automationCostIndex, appScale)]));

// ── GPTs are GPTs ───────────────────────────────────────────────────────────
const MEASURES = ['human_rating_beta', 'dv_rating_beta', 'human_rating_alpha', 'dv_rating_alpha', 'human_rating_gamma', 'dv_rating_gamma'] as const;
type Measure = (typeof MEASURES)[number];
const occRows = parseDelimited(rd('data/outside_study/raw/occ_level.csv').toString(), ',');
const occ = new Map(occRows.map((r) => [r['O*NET-SOC Code'], r]));

/** Their O*NET codes for one of our SOCs: every code under the same 6-digit SOC, else the combine table's codes. */
function gptCodesFor(soc: string): { codes: string[]; how: string } {
    const under = [...occ.keys()].filter((c) => c.slice(0, 7) === soc).sort();
    if (under.length === 1) return { codes: under, how: 'same code' };
    if (under.length > 1) return { codes: under, how: `mean of ${under.length} O*NET codes under ${soc}` };
    const split = (rawOurs.scores[soc].onetCodes ?? []).filter((c) => occ.has(c));
    if (split.length) return { codes: split, how: `mean of ${split.length} split codes (${split.join(', ')})` };
    return { codes: [], how: 'unmatched' };
}

// ── Microsoft Working with AI ───────────────────────────────────────────────
const msRows = parseDelimited(rd('data/outside_study/raw/ms_ai_applicability_scores.csv').toString(), ',');
const ms = new Map(msRows.map((r) => [r['SOC Code'], Number(r.ai_applicability_score)]));
function msFor(soc: string): { value: number | null; how: string } {
    if (ms.has(soc)) return { value: ms.get(soc)!, how: 'same code' };
    const six = [...new Set((rawOurs.scores[soc].onetCodes ?? []).map((c) => c.slice(0, 7)))].filter((c) => ms.has(c));
    if (six.length) return { value: mean(six.map((c) => ms.get(c)!)), how: `mean of ${six.join(', ')}` };
    return { value: null, how: 'unmatched' };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct1 = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);

/** Average ranks, 1 = smallest. */
function ranks(xs: number[]): number[] {
    const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const out = new Array<number>(xs.length);
    for (let i = 0; i < idx.length;) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
        for (let k = i; k <= j; k++) out[idx[k][1]] = (i + j) / 2 + 1;
        i = j + 1;
    }
    return out;
}
function pearson(a: number[], b: number[]): number {
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return num / Math.sqrt(da * db);
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

/** Same rule as buildRiskScale, but zero is a real score here (it is not "unscored"). */
function thirds(values: number[]): { lower: number; upper: number } {
    const s = [...values].sort((x, y) => x - y);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    return { lower: at(1 / 3), upper: at(2 / 3) };
}
const bandOf = (v: number, t: { lower: number; upper: number }): RiskBand => (v >= t.upper ? 'high' : v >= t.lower ? 'hybrid' : 'safe');

// ── (a) Matching ────────────────────────────────────────────────────────────
interface Match { soc: string; codes: string[]; how: string; values: Record<Measure, number> }
const matched: Match[] = [];
const unmatched: { soc: string; title: string }[] = [];
const codeOwner = new Map<string, string>();
for (const soc of SOCS) {
    const { codes, how } = gptCodesFor(soc);
    if (!codes.length) { unmatched.push({ soc, title: ours.get(soc)!.title }); continue; }
    for (const c of codes) {
        if (codeOwner.has(c)) throw new Error(`${c} would count for both ${codeOwner.get(c)} and ${soc}`);
        codeOwner.set(c, soc);
    }
    const values = Object.fromEntries(MEASURES.map((m) => [m, mean(codes.map((c) => Number(occ.get(c)![m])))])) as Record<Measure, number>;
    matched.push({ soc, codes, how, values });
}
const MAIN: Measure = 'human_rating_beta';

// ── (b) + (c) Agreement for every measure ───────────────────────────────────
function agreement(pairs: { soc: string; theirs: number }[]) {
    const oursV = pairs.map((p) => ours.get(p.soc)!.automationCostIndex);
    const theirsV = pairs.map((p) => p.theirs);
    const t = thirds(theirsV);
    const bandTheirs = new Map(pairs.map((p) => [p.soc, bandOf(p.theirs, t)]));
    let same = 0, redGreen = 0, greenRed = 0;
    const cross: Record<string, number> = {};
    for (const p of pairs) {
        const a = ourBand.get(p.soc)!, b = bandTheirs.get(p.soc)!;
        cross[`${a}>${b}`] = (cross[`${a}>${b}`] ?? 0) + 1;
        if (a === b) same++;
        if (a === 'high' && b === 'safe') redGreen++;
        if (a === 'safe' && b === 'high') greenRed++;
    }
    const count = (band: RiskBand, m: Map<string, RiskBand>) => pairs.filter((p) => m.get(p.soc) === band).length;
    return {
        n: pairs.length,
        spearman: r3(spearman(oursV, theirsV)),
        theirCutoffs: { lower: r3(t.lower), upper: r3(t.upper) },
        sameThirdPct: pct1(same, pairs.length),
        sameThird: same,
        redOursGreenTheirs: redGreen,
        greenOursRedTheirs: greenRed,
        oursBandCounts: { green: count('safe', ourBand), amber: count('hybrid', ourBand), red: count('high', ourBand) },
        theirsBandCounts: { green: count('safe', bandTheirs), amber: count('hybrid', bandTheirs), red: count('high', bandTheirs) },
        crossTab: cross,
        bandTheirs,
    };
}
const byMeasure = Object.fromEntries(MEASURES.map((m) => [m, agreement(matched.map((x) => ({ soc: x.soc, theirs: x.values[m] })))]));
const msPairs = SOCS.map((soc) => ({ soc, ...msFor(soc) })).filter((p) => p.value !== null).map((p) => ({ soc: p.soc, theirs: p.value as number, how: p.how }));
const msUnmatched = SOCS.filter((s) => msFor(s).value === null).map((soc) => ({ soc, title: ours.get(soc)!.title }));
const msAgree = agreement(msPairs);
const humanVsGpt4 = r3(spearman(matched.map((m) => m.values.human_rating_beta), matched.map((m) => m.values.dv_rating_beta)));
const msSocs = new Set(msPairs.map((p) => p.soc));
const both = matched.filter((m) => msSocs.has(m.soc));
const msBySoc = new Map(msPairs.map((p) => [p.soc, p.theirs]));
const gptVsMs = r3(spearman(both.map((m) => m.values[MAIN]), both.map((m) => msBySoc.get(m.soc)!)));

// ── (d) Families ────────────────────────────────────────────────────────────
const FAMILIES: { name: string; groups: string[] }[] = [
    { name: 'Business & Finance (13)', groups: ['13'] },
    { name: 'Sales (41)', groups: ['41'] },
    { name: 'Office & Admin (43)', groups: ['43'] },
    { name: 'Management (11)', groups: ['11'] },
    { name: 'Computer & Math (15)', groups: ['15'] },
    { name: 'Healthcare (29 + 31)', groups: ['29', '31'] },
    { name: 'Food (35)', groups: ['35'] },
    { name: 'Personal care (39)', groups: ['39'] },
    { name: 'Construction (47)', groups: ['47'] },
    { name: 'Repair (49)', groups: ['49'] },
    { name: 'Production (51)', groups: ['51'] },
    { name: 'Transport (53)', groups: ['53'] },
];
const ALL_GROUPS = [...new Set(SOCS.map((s) => s.slice(0, 2)))].sort();
function familyRow(name: string, groups: string[]) {
    const socs = matched.filter((m) => groups.includes(m.soc.slice(0, 2))).map((m) => m.soc);
    const msS = msPairs.filter((p) => groups.includes(p.soc.slice(0, 2))).map((p) => p.soc);
    const red = (m: Map<string, RiskBand>, list: string[]) => list.filter((s) => m.get(s) === 'high').length;
    const green = (m: Map<string, RiskBand>, list: string[]) => list.filter((s) => m.get(s) === 'safe').length;
    return {
        name,
        jobs: socs.length,
        redOurs: red(ourBand, socs), redOursPct: pct1(red(ourBand, socs), socs.length),
        redHumanBeta: red(byMeasure.human_rating_beta.bandTheirs, socs), redHumanBetaPct: pct1(red(byMeasure.human_rating_beta.bandTheirs, socs), socs.length),
        redGpt4Beta: red(byMeasure.dv_rating_beta.bandTheirs, socs), redGpt4BetaPct: pct1(red(byMeasure.dv_rating_beta.bandTheirs, socs), socs.length),
        msJobs: msS.length, redMs: red(msAgree.bandTheirs, msS), redMsPct: pct1(red(msAgree.bandTheirs, msS), msS.length),
        greenOursPct: pct1(green(ourBand, socs), socs.length),
        greenHumanBetaPct: pct1(green(byMeasure.human_rating_beta.bandTheirs, socs), socs.length),
    };
}
const families = FAMILIES.map((f) => familyRow(f.name, f.groups));
const allGroups = ALL_GROUPS.map((g) => familyRow(g, [g]));

// ── O*NET 30.1 importance and task type ─────────────────────────────────────
const stmts = parseDelimited(rd('data/db_30_1_text/Task Statements.txt').toString(), '\t');
const ratings = parseDelimited(rd('data/db_30_1_text/Task Ratings.txt').toString(), '\t');
const importance = new Map<string, number>(); // `${code}|${taskId}`
for (const r of ratings) if (r['Scale ID'] === 'IM') importance.set(`${r['O*NET-SOC Code']}|${r['Task ID']}`, Number(r['Data Value']));
const tasksByCode = new Map<string, { id: number; text: string; type: string; order: number }[]>();
stmts.forEach((r, order) => {
    const code = r['O*NET-SOC Code'];
    if (!tasksByCode.has(code)) tasksByCode.set(code, []);
    tasksByCode.get(code)!.push({ id: Number(r['Task ID']), text: r.Task, type: r['Task Type'], order });
});

// ── Their task-level labels, for scoring the very same tasks their way ──────
const labelRows = parseDelimited(rd('data/outside_study/raw/full_labelset.tsv').toString(), '\t');
const labelByCodeTask = new Map<string, Record<string, string>>();
const labelByTask = new Map<number, Record<string, string>[]>();
for (const r of labelRows) {
    const id = Number(r['Task ID']);
    labelByCodeTask.set(`${r['O*NET-SOC Code']}|${id}`, r);
    if (!labelByTask.has(id)) labelByTask.set(id, []);
    labelByTask.get(id)!.push(r);
}
const ev = (e: string) => (e === 'E1' ? 1 : e === 'E2' ? 0.5 : 0);
function labelFor(code: string, id: number): Record<string, string> | null {
    const exact = labelByCodeTask.get(`${code}|${id}`);
    if (exact) return exact;
    const any = labelByTask.get(id);
    return any && any.length === 1 ? any[0] : null;
}
/** Their beta rule (reproduces occ_level.csv exactly: Core tasks count twice), on a chosen set of tasks. */
function theirBetaOn(tasks: { code: string; id: number }[], col: 'human_exposure_agg' | 'gpt4_exposure'): { value: number | null; found: number } {
    let num = 0, den = 0, found = 0;
    for (const t of tasks) {
        const l = labelFor(t.code, t.id);
        if (!l) continue;
        const w = l['Task Type'] === 'Core' ? 2 : 1;
        num += w * ev(l[col]); den += w; found++;
    }
    return { value: den ? num / den : null, found };
}

// ── (f) Our 5 tasks vs each job's most important tasks ──────────────────────
interface TaskPick {
    soc: string; rule: string; poolSize: number; rated: number;
    /** 'all': every task of the job has an O*NET importance rating; 'some' / 'none' are left out of the summaries. */
    ratings: 'all' | 'some' | 'none';
    inTop5: number; inTop5Ties: number; core: number; typed: number;
    meanImpOurs: number | null; meanImpTop5: number | null;
    top5: { code: string; id: number; text: string; imp: number; type: string }[];
}
const picks = new Map<string, TaskPick>();
for (const soc of SOCS) {
    const role = ours.get(soc)!;
    const codes = rawOurs.scores[soc].onetCodes;
    const pool = codes.flatMap((code) => (tasksByCode.get(code) ?? []).map((t) => ({ ...t, code, imp: importance.get(`${code}|${t.id}`) })));
    const rated = pool.filter((t) => t.imp !== undefined) as (typeof pool[number] & { imp: number })[];
    const sorted = [...rated].sort((a, b) => b.imp - a.imp || a.order - b.order);
    const top5 = sorted.slice(0, 5);
    const cut = top5.length ? top5[top5.length - 1].imp : Infinity;
    const top5Keys = new Set(top5.map((t) => `${t.code}|${t.id}`));
    let inTop5 = 0, inTop5Ties = 0, core = 0, typed = 0;
    const impOurs: number[] = [];
    for (const t of role.tasks) {
        const key = `${t.onetCode}|${t.taskId}`;
        if (top5Keys.has(key)) inTop5++;
        const imp = importance.get(key);
        if (imp !== undefined) { impOurs.push(imp); if (imp >= cut) inTop5Ties++; }
        const st = pool.find((p) => p.code === t.onetCode && p.id === t.taskId);
        if (st?.type) { typed++; if (st.type === 'Core') core++; }
    }
    picks.set(soc, {
        soc, rule: rawOurs.scores[soc].rule, poolSize: pool.length, rated: rated.length,
        ratings: rated.length === 0 ? 'none' : rated.length < pool.length ? 'some' : 'all',
        inTop5, inTop5Ties, core, typed,
        meanImpOurs: impOurs.length ? mean(impOurs) : null,
        meanImpTop5: top5.length ? mean(top5.map((t) => t.imp)) : null,
        top5: top5.map((t) => ({ code: t.code, id: t.id, text: t.text, imp: t.imp, type: t.type })),
    });
}
function pickSummary(everyJob: TaskPick[]) {
    const list = everyJob.filter((p) => p.ratings === 'all');
    const withImp = list.filter((p) => p.meanImpOurs !== null && p.meanImpTop5 !== null);
    const dist = [0, 1, 2, 3, 4, 5].map((k) => list.filter((p) => p.inTop5 === k).length);
    return {
        jobs: list.length,
        leftOut: {
            noImportanceRatings: everyJob.filter((p) => p.ratings === 'none').map((p) => p.soc),
            someTasksUnrated: everyJob.filter((p) => p.ratings === 'some').map((p) => p.soc),
        },
        meanInTop5: r3(mean(list.map((p) => p.inTop5))),
        meanInTop5WithTies: r3(mean(list.map((p) => p.inTop5Ties))),
        inTop5Distribution: dist,
        zeroInTop5: dist[0],
        meanCore: r3(mean(list.map((p) => p.core))),
        allFiveTyped: list.filter((p) => p.typed === role5(p.soc)).length,
        allFiveCore: list.filter((p) => p.core === 5).length,
        meanImportanceOurs: r3(mean(withImp.map((p) => p.meanImpOurs!))),
        meanImportanceTop5: r3(mean(withImp.map((p) => p.meanImpTop5!))),
        // What a random 5 would give: 5 x 5 / pool size.
        expectedInTop5IfRandom: r3(mean(list.filter((p) => p.poolSize).map((p) => (5 * Math.min(5, p.poolSize)) / p.poolSize))),
    };
}
function role5(soc: string) { return ours.get(soc)!.tasks.length; }
const allPicks = SOCS.map((s) => picks.get(s)!);
const pickAll = pickSummary(allPicks);
const pickFirst5 = pickSummary(allPicks.filter((p) => p.rule === 'first-5-onet-order'));

// ── Same tasks, their raters: is the gap the tasks or the rating? ───────────
interface TaskLevel { soc: string; ours5: number | null; first5Found: number; top5: number | null; top5Found: number }
const taskLevel: TaskLevel[] = matched.map((m) => {
    const role = ours.get(m.soc)!;
    const ours5 = theirBetaOn(role.tasks.map((t) => ({ code: t.onetCode, id: t.taskId })), 'human_exposure_agg');
    const top5 = theirBetaOn(picks.get(m.soc)!.top5.map((t) => ({ code: t.code, id: t.id })), 'human_exposure_agg');
    return { soc: m.soc, ours5: ours5.value, first5Found: ours5.found, top5: top5.value, top5Found: top5.found };
});
const fullyLabelled = taskLevel.filter((t) => t.first5Found === ours.get(t.soc)!.tasks.length && t.top5Found === 5);
const fullBeta = new Map(matched.map((m) => [m.soc, m.values[MAIN]]));
const sameTasks = {
    jobs: fullyLabelled.length,
    note: 'Jobs where every one of our tasks AND every one of the 5 most important tasks has a GPTs-are-GPTs human label (matched by O*NET code + Task ID).',
    // Same 5 tasks, two raters: Claude (ours) vs their human annotators.
    oursVsTheirBetaOnOurTasks: r3(spearman(fullyLabelled.map((t) => ours.get(t.soc)!.automationCostIndex), fullyLabelled.map((t) => t.ours5!))),
    // Their raters, their whole job vs only our 5 tasks / only the top-5 important tasks.
    theirFullVsTheirOnOurTasks: r3(spearman(fullyLabelled.map((t) => fullBeta.get(t.soc)!), fullyLabelled.map((t) => t.ours5!))),
    theirFullVsTheirOnTop5: r3(spearman(fullyLabelled.map((t) => fullBeta.get(t.soc)!), fullyLabelled.map((t) => t.top5!))),
    oursVsTheirFull: r3(spearman(fullyLabelled.map((t) => ours.get(t.soc)!.automationCostIndex), fullyLabelled.map((t) => fullBeta.get(t.soc)!))),
    meanAbsGapOurTasks: r3(mean(fullyLabelled.map((t) => Math.abs(fullBeta.get(t.soc)! - t.ours5!)))),
    meanAbsGapTop5: r3(mean(fullyLabelled.map((t) => Math.abs(fullBeta.get(t.soc)! - t.top5!)))),
};
const ours5BySoc = new Map(taskLevel.map((t) => [t.soc, t]));

// ── (e) Biggest disagreements (rank gap, main measure) ──────────────────────
const n = matched.length;
const oursR = ranks(matched.map((m) => ours.get(m.soc)!.automationCostIndex));
const theirsR = ranks(matched.map((m) => m.values[MAIN]));
// Rank 1 = most exposed, n = least, on both sides.
const gaps = matched.map((m, i) => ({
    soc: m.soc,
    title: ours.get(m.soc)!.title,
    ourRisk: ours.get(m.soc)!.automationCostIndex,
    ourBand: ourBand.get(m.soc)!,
    ourRank: n + 1 - oursR[i],
    theirBeta: r3(m.values[MAIN]),
    theirGpt4Beta: r3(m.values.dv_rating_beta),
    theirBand: byMeasure[MAIN].bandTheirs.get(m.soc)!,
    theirRank: n + 1 - theirsR[i],
    gap: oursR[i] - theirsR[i], // > 0: we rank it MORE exposed than they do
    theirBetaOnOurTasks: ours5BySoc.get(m.soc)?.ours5 === null ? null : r3(ours5BySoc.get(m.soc)!.ours5!),
    matchedHow: m.how,
    inTop5: picks.get(m.soc)!.ratings === 'all' ? picks.get(m.soc)!.inTop5 : null,
    importanceRatings: picks.get(m.soc)!.ratings,
    core: picks.get(m.soc)!.core,
    tasks: ours.get(m.soc)!.tasks.map((t) => {
        const l = labelFor(t.onetCode, t.taskId);
        return { name: t.name, ai: t.aiCapabilityScore, theirHuman: l?.human_exposure_agg ?? null, theirGpt4: l?.gpt4_exposure ?? null };
    }),
}));
const top20 = [...gaps].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.soc.localeCompare(b.soc)).slice(0, 20);
const top20Set = new Set(top20.map((g) => g.soc));
// Only jobs whose tasks all have importance ratings can say how many of our tasks are in the top 5.
const rated = gaps.filter((g) => g.inTop5 !== null) as (typeof gaps[number] & { inTop5: number })[];
const top20Rated = rated.filter((g) => top20Set.has(g.soc));
const rest = rated.filter((g) => !top20Set.has(g.soc));
const absGap = rated.map((g) => Math.abs(g.gap));
const disagreeVsPick = {
    jobsWithRatings: rated.length,
    top20WithRatings: top20Rated.length,
    top20MeanInTop5: r3(mean(top20Rated.map((g) => g.inTop5))),
    othersMeanInTop5: r3(mean(rest.map((g) => g.inTop5))),
    top20MeanCore: r3(mean(top20Rated.map((g) => g.core))),
    othersMeanCore: r3(mean(rest.map((g) => g.core))),
    spearmanAbsGapVsInTop5: r3(spearman(absGap, rated.map((g) => g.inTop5))),
    meanAbsRankGapByInTop5: [0, 1, 2, 3, 4, 5].map((k) => {
        const g = rated.filter((x) => x.inTop5 === k);
        return { inTop5: k, jobs: g.length, meanAbsRankGap: g.length ? Math.round(mean(g.map((x) => Math.abs(x.gap)))) : null };
    }),
    top20Direction: { weRankHigher: top20.filter((g) => g.gap > 0).length, theyRankHigher: top20.filter((g) => g.gap < 0).length },
};

// ── Write ───────────────────────────────────────────────────────────────────
const strip = <T extends { bandTheirs: unknown }>(a: T) => { const { bandTheirs: _drop, ...rest } = a; void _drop; return rest; };
const results = {
    note: 'Generated by scripts/outside_study_check.ts. A check only: no score or colour is changed.',
    ourScale: { jobs: SOCS.length, lower: appScale.lower, upper: appScale.upper },
    mainMeasure: MAIN,
    a_matching: {
        ourJobs: SOCS.length,
        gptsAreGpts: { matched: matched.length, unmatched, byHow: tally(matched.map((m) => (m.how.startsWith('mean of') && m.how.includes('split') ? 'split codes' : m.how.startsWith('mean') ? 'several codes under our SOC' : m.how))) },
        microsoft: { matched: msPairs.length, unmatched: msUnmatched, byHow: tally(msPairs.map((p) => (p.how === 'same code' ? p.how : 'mean of split SOCs'))) },
    },
    b_c_agreement: Object.fromEntries([...MEASURES.map((m) => [m, strip(byMeasure[m])]), ['microsoft_ai_applicability', strip(msAgree)]]),
    theirOwnConsistency: { humanBetaVsGpt4Beta: humanVsGpt4, humanBetaVsMicrosoft: gptVsMs, jobsInBoth: both.length },
    d_families: families,
    d_allMajorGroups: allGroups,
    e_top20: top20,
    f_taskPicking: { allJobs: pickAll, first5Jobs: pickFirst5, disagreementVsPicking: disagreeVsPick, sameTasksTheirRaters: sameTasks },
    matches: matched.map((m) => ({ soc: m.soc, how: m.how, codes: m.codes })),
    microsoftMatches: msPairs.map((p) => ({ soc: p.soc, how: p.how })),
};
function tally(xs: string[]) { return xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {}); }
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(results, null, 2) + '\n');
console.log(`wrote ${OUT}`);
type Agree = ReturnType<typeof strip<ReturnType<typeof agreement>>>;
const summary = Object.entries(results.b_c_agreement as Record<string, Agree>).map(
    ([k, v]) => `${k}: n ${v.n}, spearman ${v.spearman}, same third ${v.sameThirdPct}%, red>green ${v.redOursGreenTheirs}, green>red ${v.greenOursRedTheirs}`,
);
console.log([`matched: GPTs are GPTs ${matched.length}/${SOCS.length}, Microsoft ${msPairs.length}/${SOCS.length}`, ...summary].join('\n'));
