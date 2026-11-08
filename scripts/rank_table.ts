/**
 * Before / after table for the 50 Kelley roles under the one all-roles scale
 * (src/utils/roleScale.ts). Reads only the published files:
 *   src/data/ai_scores.json      the 50 Kelley roles' task scores
 *   src/data/ai_scores_bls.json  every other scored occupation
 * and writes src/__tests__/fixtures/kelley50_rank_change.json (checked by
 * rankScale.test.ts against the running app) plus a Markdown table on stdout.
 *
 *   npx tsx scripts/rank_table.ts
 *
 * "Before" is the old rule, ranked among the 50 alone; "after" is the same
 * rule among every scored role. No score value changes, only its rank.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialJobs } from '../src/data';
import { parseBlsScores, type RawBlsFile } from '../src/utils/blsScoresData';
import { buildRiskScale, riskBand } from '../src/config/theme';
import { PERCENTILES, RESILIENCE_LABELS } from '../src/config/constants';
import { bandFor, buildRoleScale, resilienceLabelFor, type ScorePoint } from '../src/utils/roleScale';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));

const kelleyFile = read('src/data/ai_scores.json') as { scores: Record<string, { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] }> };
const bls = parseBlsScores(read('src/data/ai_scores_bls.json') as RawBlsFile).scores;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const kelley = initialJobs.map((j) => {
    const tasks = kelleyFile.scores[j.id].tasks;
    return {
        id: j.id,
        title: j.title,
        risk: parseFloat(mean(tasks.map((t) => t.aiCapabilityScore)).toFixed(2)),
        human: mean(tasks.map((t) => t.humanCriticalityScore)),
    };
});

// Old rule, exactly as store.ts had it: percentiles of the 50 alone, raw means.
const pct = (arr: number[], p: number) => arr[Math.min(Math.floor(p * arr.length), arr.length - 1)];
const humans50 = kelley.map((k) => k.human).sort((a, b) => a - b);
const oldP75 = pct(humans50, PERCENTILES.HIGH);
const oldP25 = pct(humans50, PERCENTILES.LOW);
const oldLabel = (h: number) => (h >= oldP75 ? RESILIENCE_LABELS.TOP : h >= oldP25 ? RESILIENCE_LABELS.MID : RESILIENCE_LABELS.BOTTOM);
const oldRiskScale = buildRiskScale(kelley.map((k) => k.risk));

// New rule: every scored role once (roleScale.ts).
const points: ScorePoint[] = [
    ...kelley.map((k) => ({ key: k.id, risk: k.risk, human: k.human })),
    ...[...bls.values()].map((s) => ({ key: `soc:${s.soc}`, risk: s.automationCostIndex, human: s.humanCriticality })),
];
const scale = buildRoleScale(points);

const rows = kelley.map((k) => ({
    id: k.id,
    title: k.title,
    risk: k.risk,
    human: Math.round(k.human * 10_000) / 10_000,
    oldLabel: oldLabel(k.human),
    newLabel: resilienceLabelFor(k.human, scale),
    oldBand: riskBand(k.risk, oldRiskScale),
    newBand: bandFor(k.risk, scale),
}));

const out = {
    _meta: {
        note: 'Written by scripts/rank_table.ts from src/data/ai_scores.json and src/data/ai_scores_bls.json. Scores never change; only ranks.',
        roles: scale.count,
        kelley: kelley.length,
        before: { humanP25: oldP25, humanP75: oldP75, riskLower: oldRiskScale.lower, riskUpper: oldRiskScale.upper },
        after: { humanP25: scale.humanP25, humanP75: scale.humanP75, riskLower: scale.risk.lower, riskUpper: scale.risk.upper },
        labelsChanged: rows.filter((r) => r.oldLabel !== r.newLabel).length,
        bandsChanged: rows.filter((r) => r.oldBand !== r.newBand).length,
    },
    rows,
};
fs.writeFileSync(path.join(ROOT, 'src/__tests__/fixtures/kelley50_rank_change.json'), `${JSON.stringify(out, null, 2)}\n`);

const pctText = (v: number) => `${Math.round(v * 100)}%`;
console.log(`Ranked among ${scale.count} scored roles (before: the ${kelley.length} Kelley roles).`);
console.log(`Human Resilience cut-offs: before ${oldP25.toFixed(3)} / ${oldP75.toFixed(3)}, after ${scale.humanP25.toFixed(3)} / ${scale.humanP75.toFixed(3)}.`);
console.log(`Colour band cut-offs (risk): before ${oldRiskScale.lower} / ${oldRiskScale.upper}, after ${scale.risk.lower} / ${scale.risk.upper}.`);
console.log(`Labels changed: ${out._meta.labelsChanged} of ${rows.length}. Bands changed: ${out._meta.bandsChanged} of ${rows.length}.\n`);
console.log('| Role | Risk | Human | Old label | New label | Old band | New band |');
console.log('|---|---:|---:|---|---|---|---|');
for (const r of [...rows].sort((a, b) => a.title.localeCompare(b.title))) {
    const mark = (a: string, b: string) => (a === b ? b : `**${b}**`);
    console.log(`| ${r.title} | ${pctText(r.risk)} | ${pctText(r.human)} | ${r.oldLabel} | ${mark(r.oldLabel, r.newLabel)} | ${r.oldBand} | ${mark(r.oldBand, r.newBand)} |`);
}
