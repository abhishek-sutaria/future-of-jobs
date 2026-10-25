/**
 * compare_calibration.ts — phase 3a.
 * Compares in-session ratings (reports/calibration/ratings_phase3a.json) with the
 * published src/data/ai_scores.json. Run ONLY after the ratings are saved.
 *   npx vite-node scripts/compare_calibration.ts [--json out.json]
 * Read-only: writes nothing unless --json is given.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initialJobs } from '../src/data';
import { buildRiskScale, riskBand } from '../src/config/theme';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8'));
const pub = load('src/data/ai_scores.json').scores;
const mine = load('reports/calibration/ratings_phase3a.json').scores;

type Pt = { job: string; task: string; a: number; b: number };
const ai: Pt[] = [], hu: Pt[] = [];
const roles: { id: string; title: string; pub: number; mine: number; diff: number; tasks: { task: string; d: number }[] }[] = [];

for (const j of initialJobs) {
    const p = pub[j.id], m = mine[j.id];
    if (!p || !m) throw new Error(`missing ${j.id}`);
    const tasks: { task: string; d: number }[] = [];
    p.tasks.forEach((pt: any, i: number) => {
        const mt = m.tasks[i];
        ai.push({ job: j.title, task: pt.taskName, a: pt.aiCapabilityScore, b: mt.aiCapabilityScore });
        hu.push({ job: j.title, task: pt.taskName, a: pt.humanCriticalityScore, b: mt.humanCriticalityScore });
        tasks.push({ task: pt.taskName, d: mt.aiCapabilityScore - pt.aiCapabilityScore });
    });
    // app definition: automationCostIndex = mean AI capability, 2 dp (store.ts)
    const mean = (r: any) => parseFloat((r.tasks.reduce((s: number, t: any) => s + t.aiCapabilityScore, 0) / r.tasks.length).toFixed(2));
    roles.push({ id: j.id, title: j.title, pub: mean(p), mine: mean(m), diff: (mean(m) - mean(p)) * 100, tasks });
}

const q = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const corr = (x: number[], y: number[]) => {
    const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
};
const stats = (pts: Pt[]) => {
    const d = pts.map(p => Math.abs(p.b - p.a));
    return {
        n: pts.length,
        mad: d.reduce((s, v) => s + v, 0) / d.length,
        median: q(d, 0.5), p90: q(d, 0.9), max: Math.max(...d),
        corr: corr(pts.map(p => p.a), pts.map(p => p.b)),
        bias: pts.reduce((s, p) => s + (p.b - p.a), 0) / pts.length, // mine minus published
        within10: d.filter(v => v <= 0.10).length / d.length,
    };
};
const sAi = stats(ai), sHu = stats(hu);

const pubScale = buildRiskScale(roles.map(r => r.pub));
const myScale = buildRiskScale(roles.map(r => r.mine));
const sameOwn = roles.filter(r => riskBand(r.pub, pubScale) === riskBand(r.mine, myScale));
const sameAbs = roles.filter(r => riskBand(r.pub, pubScale) === riskBand(r.mine, pubScale));
const abs = roles.map(r => Math.abs(r.diff));
const within5 = roles.filter(r => Math.abs(r.diff) <= 5.0001);

const f = (n: number, d = 3) => n.toFixed(d);
const out: string[] = [];
out.push('PER-TASK (250 tasks; "bias" = mine − published)');
out.push('metric                 aiCapability   humanCriticality');
out.push(`mean abs diff          ${f(sAi.mad).padEnd(14)} ${f(sHu.mad)}`);
out.push(`median abs diff        ${f(sAi.median).padEnd(14)} ${f(sHu.median)}`);
out.push(`90th pct abs diff      ${f(sAi.p90).padEnd(14)} ${f(sHu.p90)}`);
out.push(`max abs diff           ${f(sAi.max).padEnd(14)} ${f(sHu.max)}`);
out.push(`Pearson r              ${f(sAi.corr).padEnd(14)} ${f(sHu.corr)}`);
out.push(`bias (mine − pub)      ${f(sAi.bias).padEnd(14)} ${f(sHu.bias)}`);
out.push(`share within 0.10      ${f(sAi.within10 * 100, 1)}%`.padEnd(37) + `${f(sHu.within10 * 100, 1)}%`);
out.push('');
out.push('PER-ROLE AUTOMATION RISK (mean AI capability, percentage points)');
out.push(`mean abs diff ${f(abs.reduce((s, v) => s + v, 0) / 50, 2)} pp · median ${f(q(abs, 0.5), 2)} · p90 ${f(q(abs, 0.9), 2)} · max ${f(Math.max(...abs), 2)}`);
out.push(`signed mean (mine − pub) ${f(roles.reduce((s, r) => s + r.diff, 0) / 50, 2)} pp · risk correlation r=${f(corr(roles.map(r => r.pub), roles.map(r => r.mine)))}`);
out.push(`roles within ±5 pp: ${within5.length}/50`);
out.push(`risk band (tercile of each set's own 50 scores, as the app does): same ${sameOwn.length}/50`);
out.push(`risk band (published cut-offs ${f(pubScale.lower, 3)}/${f(pubScale.upper, 3)} applied to mine): same ${sameAbs.length}/50`);
out.push(`  my own cut-offs would be ${f(myScale.lower, 3)}/${f(myScale.upper, 3)}`);
out.push('');
out.push('ROLE TABLE (pub%, mine%, diff pp, band pub→mine[own scale])');
for (const r of [...roles].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))) {
    out.push(`${r.title.padEnd(36)} ${f(r.pub * 100, 0).padStart(4)} ${f(r.mine * 100, 0).padStart(4)} ${(r.diff >= 0 ? '+' : '') + f(r.diff, 0).padStart(3)}  ${riskBand(r.pub, pubScale)}→${riskBand(r.mine, myScale)}`);
}
out.push('');
out.push('TOP 5 ROLES BY |DIFF| — task drivers (mine − published AI capability)');
for (const r of [...roles].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5)) {
    out.push(`${r.title}: pub ${f(r.pub * 100, 0)}% vs mine ${f(r.mine * 100, 0)}% (${r.diff >= 0 ? '+' : ''}${f(r.diff, 0)} pp)`);
    for (const t of [...r.tasks].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)) out.push(`   ${t.d >= 0 ? '+' : ''}${f(t.d, 2)}  ${t.task.slice(0, 90)}`);
}
console.log(out.join('\n'));

const ji = process.argv.indexOf('--json');
if (ji !== -1) fs.writeFileSync(process.argv[ji + 1], JSON.stringify({ sAi, sHu, roles }, null, 2));
