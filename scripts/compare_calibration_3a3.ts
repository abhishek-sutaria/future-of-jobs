/**
 * compare_calibration_3a3.ts — phase 3a-3 (self-consistency).
 * Compares run 2 (ratings_phase3a3.json, 10 roles) with run 1 (ratings_phase3a.json),
 * with the published ai_scores.json as a reference column only.
 *   npx vite-node scripts/compare_calibration_3a3.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initialJobs } from '../src/data';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8')).scores;
const r1 = load('reports/calibration/ratings_phase3a.json');
const r2 = load('reports/calibration/ratings_phase3a3.json');
const pub = load('src/data/ai_scores.json');

const mean = (r: any) => parseFloat((r.tasks.reduce((s: number, t: any) => s + t.aiCapabilityScore, 0) / r.tasks.length).toFixed(2));
const corr = (x: number[], y: number[]) => {
    const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
};
const f = (n: number, d = 3) => n.toFixed(d);
const ids = Object.keys(r2);
const A: number[][] = [[], []], H: number[][] = [[], []];
const rows: { title: string; p: number; a: number; b: number; d: number }[] = [];
for (const id of ids) {
    const title = initialJobs.find(j => j.id === id)!.title;
    r1[id].tasks.forEach((t: any, i: number) => {
        A[0].push(t.aiCapabilityScore); A[1].push(r2[id].tasks[i].aiCapabilityScore);
        H[0].push(t.humanCriticalityScore); H[1].push(r2[id].tasks[i].humanCriticalityScore);
    });
    rows.push({ title, p: mean(pub[id]), a: mean(r1[id]), b: mean(r2[id]), d: (mean(r2[id]) - mean(r1[id])) * 100 });
}
const st = (x: number[], y: number[]) => ({
    mad: x.reduce((s, v, i) => s + Math.abs(y[i] - v), 0) / x.length,
    bias: x.reduce((s, v, i) => s + (y[i] - v), 0) / x.length,
    r: corr(x, y),
    same: x.filter((v, i) => v === y[i]).length,
    within10: x.filter((v, i) => Math.abs(y[i] - v) <= 0.1001).length,
});
const sa = st(A[0], A[1]), sh = st(H[0], H[1]);
console.log(`PER-TASK (n=${A[0].length}; run2 − run1)`);
console.log(`metric          aiCapability  humanCriticality`);
console.log(`mean abs diff   ${f(sa.mad).padEnd(13)} ${f(sh.mad)}`);
console.log(`bias            ${f(sa.bias).padEnd(13)} ${f(sh.bias)}`);
console.log(`Pearson r       ${f(sa.r).padEnd(13)} ${f(sh.r)}`);
console.log(`identical       ${String(sa.same).padEnd(13)} ${sh.same}`);
console.log(`within 0.10     ${String(sa.within10).padEnd(13)} ${sh.within10}`);
console.log('\nROLE  (automation risk = mean AI capability, %)');
console.log('role'.padEnd(28) + 'run1  run2  diff(pp)  published');
for (const r of rows) console.log(r.title.padEnd(28) + `${f(r.a * 100, 0).padStart(4)}  ${f(r.b * 100, 0).padStart(4)}  ${((r.d >= 0 ? '+' : '') + f(r.d, 0)).padStart(7)}  ${f(r.p * 100, 0).padStart(8)}`);
const w5 = rows.filter(r => Math.abs(r.d) <= 5.0001).length;
console.log(`\nwithin ±5 pp of run 1: ${w5}/${rows.length}`);
console.log(`average shift (signed): ${f(rows.reduce((s, r) => s + r.d, 0) / rows.length, 2)} pp; mean abs shift: ${f(rows.reduce((s, r) => s + Math.abs(r.d), 0) / rows.length, 2)} pp`);
console.log(`role-level r (run1 vs run2): ${f(corr(rows.map(r => r.a), rows.map(r => r.b)))}`);
const pm = rows.reduce((s, r) => s + (r.p - r.a), 0) / rows.length * 100, pm2 = rows.reduce((s, r) => s + (r.p - r.b), 0) / rows.length * 100;
console.log(`reference: published − run1 = ${f(pm, 2)} pp avg; published − run2 = ${f(pm2, 2)} pp avg`);
