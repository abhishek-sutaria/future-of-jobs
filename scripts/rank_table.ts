/**
 * Before / after table for the 50 Kelley roles under the one all-occupations
 * scale (src/utils/roleScale.ts, src/utils/allRoleScale.ts). Reads only the
 * published files:
 *   src/data/ai_scores.json      the 50 Kelley titles' FIRST scores (history)
 *   src/data/ai_scores_bls.json  every scored occupation, including each Kelley
 *                                SOC once `--batch kelley` is in
 * and writes src/__tests__/fixtures/kelley50_rank_change.json (checked by
 * rankScale.test.ts against the running app) plus a Markdown table on stdout.
 *
 *   npx tsx scripts/rank_table.ts
 *
 * "Before" is the old rule: each title's first score, ranked among the 50
 * alone. "After" is what the app shows: each title on its SOC's entry in
 * ai_scores_bls.json when there is one (else its first score), ranked among
 * every scored occupation once (783).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialJobs } from '../src/data';
import { MAP_TITLE_TO_SOC } from '../src/utils/onet';
import { parseBlsScores, type RawBlsFile } from '../src/utils/blsScoresData';
import { buildRiskScale, riskBand } from '../src/config/theme';
import { PERCENTILES, RESILIENCE_LABELS } from '../src/config/constants';
import { bandFor, buildRoleScale, resilienceLabelFor, type ScorePoint } from '../src/utils/roleScale';
import { meanUnit } from '../src/utils/scoreRounding';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const RANK_TABLE_FIXTURE = 'src/__tests__/fixtures/kelley50_rank_change.json';

/** The before / after table, from the files under `root`. */
export function buildRankTable(root: string = ROOT) {
    const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));

    const kelleyFile = read('src/data/ai_scores.json') as { scores: Record<string, { tasks: { aiCapabilityScore: number; humanCriticalityScore: number }[] }> };
    const bls = parseBlsScores(read('src/data/ai_scores_bls.json') as RawBlsFile).scores;

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const kelley = initialJobs.map((j) => {
        const soc = MAP_TITLE_TO_SOC[j.title];
        const first = kelleyFile.scores[j.id].tasks;
        const firstRisk = meanUnit(first.map((t) => t.aiCapabilityScore));
        const firstHuman = mean(first.map((t) => t.humanCriticalityScore));
        const entry = bls.get(soc);
        return {
            id: j.id,
            title: j.title,
            soc,
            source: entry ? 'soc-entry' : 'first-score',
            firstRisk,
            firstHuman,
            risk: entry ? entry.automationCostIndex : firstRisk,
            human: entry ? entry.humanCriticality : firstHuman,
        };
    });

    // Old rule, exactly as store.ts had it: percentiles of the 50 alone, raw means, first scores.
    const pct = (arr: number[], p: number) => arr[Math.min(Math.floor(p * arr.length), arr.length - 1)];
    const humans50 = kelley.map((k) => k.firstHuman).sort((a, b) => a - b);
    const oldP75 = pct(humans50, PERCENTILES.HIGH);
    const oldP25 = pct(humans50, PERCENTILES.LOW);
    const oldLabel = (h: number) => (h >= oldP75 ? RESILIENCE_LABELS.TOP : h >= oldP25 ? RESILIENCE_LABELS.MID : RESILIENCE_LABELS.BOTTOM);
    const oldRiskScale = buildRiskScale(kelley.map((k) => k.firstRisk));

    // New rule: every scored occupation once (allRoleScale.ts). A Kelley SOC's
    // point is the mean of its titles (identical once both are on the SOC entry).
    const kelleySocs = new Set(kelley.map((k) => k.soc));
    const socPoints = [...kelleySocs].map((soc) => {
        const titles = kelley.filter((k) => k.soc === soc);
        return { key: `soc:${soc}`, risk: mean(titles.map((k) => k.risk)), human: mean(titles.map((k) => k.human)) };
    });
    const points: ScorePoint[] = [
        ...socPoints,
        ...[...bls.values()].filter((s) => !kelleySocs.has(s.soc)).map((s) => ({ key: `soc:${s.soc}`, risk: s.automationCostIndex, human: s.humanCriticality })),
    ];
    const scale = buildRoleScale(points);

    const rows = kelley.map((k) => ({
        id: k.id,
        title: k.title,
        source: k.source,
        risk: k.risk,
        human: Math.round(k.human * 10_000) / 10_000,
        oldLabel: oldLabel(k.firstHuman),
        newLabel: resilienceLabelFor(k.human, scale),
        oldBand: riskBand(k.firstRisk, oldRiskScale),
        newBand: bandFor(k.risk, scale),
    }));

    const out = {
        _meta: {
            note: 'Written by scripts/rank_table.ts from src/data/ai_scores.json (first scores, for "before") and src/data/ai_scores_bls.json. "After" is each title on its SOC entry when there is one, ranked among every scored occupation once.',
            occupations: scale.count,
            kelley: kelley.length,
            onSocEntry: kelley.filter((k) => k.source === 'soc-entry').length,
            before: { humanP25: oldP25, humanP75: oldP75, riskLower: oldRiskScale.lower, riskUpper: oldRiskScale.upper },
            after: { humanP25: scale.humanP25, humanP75: scale.humanP75, riskLower: scale.risk.lower, riskUpper: scale.risk.upper },
            labelsChanged: rows.filter((r) => r.oldLabel !== r.newLabel).length,
            bandsChanged: rows.filter((r) => r.oldBand !== r.newBand).length,
        },
        rows,
    };
    return { out, rows, scale, kelley, oldP25, oldP75, oldRiskScale };
}

/** Writes the fixture (rankScale.test.ts checks it). --batch kelley calls this after writing its scores. */
export function writeRankTable(root: string = ROOT) {
    const table = buildRankTable(root);
    fs.writeFileSync(path.join(root, RANK_TABLE_FIXTURE), `${JSON.stringify(table.out, null, 2)}\n`);
    return table;
}

const isEntry = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
    const { out, rows, scale, kelley, oldP25, oldP75, oldRiskScale } = writeRankTable();
    const pctText = (v: number) => `${Math.round(v * 100)}%`;
    console.log(`Ranked among ${scale.count} scored occupations, each once (before: the ${kelley.length} Kelley roles). ${out._meta.onSocEntry} of ${kelley.length} titles on their SOC's entry in ai_scores_bls.json.`);
    console.log(`Human Resilience cut-offs: before ${oldP25.toFixed(3)} / ${oldP75.toFixed(3)}, after ${scale.humanP25.toFixed(3)} / ${scale.humanP75.toFixed(3)}.`);
    console.log(`Colour band cut-offs (risk): before ${oldRiskScale.lower} / ${oldRiskScale.upper}, after ${scale.risk.lower} / ${scale.risk.upper}.`);
    console.log(`Labels changed: ${out._meta.labelsChanged} of ${rows.length}. Bands changed: ${out._meta.bandsChanged} of ${rows.length}.\n`);
    console.log('| Role | Risk | Human | Old label | New label | Old band | New band |');
    console.log('|---|---:|---:|---|---|---|---|');
    for (const r of [...rows].sort((a, b) => a.title.localeCompare(b.title))) {
        const mark = (a: string, b: string) => (a === b ? b : `**${b}**`);
        console.log(`| ${r.title} | ${pctText(r.risk)} | ${pctText(r.human)} | ${r.oldLabel} | ${mark(r.oldLabel, r.newLabel)} | ${r.oldBand} | ${mark(r.oldBand, r.newBand)} |`);
    }
}
