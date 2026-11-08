/**
 * The build serves src/data/ai_scores_bls.json in parts (scripts/lib/
 * blsScoresPlugin.ts): one Automation Risk per SOC in the main bundle, and
 * each field's scores, slimmed, in its own chunk. These tests read what the
 * plugin really serves (virtual:bls-scores) and check it against the full file
 * on every field the app reads, so no displayed number can change.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { meta, risks, fieldLoaders } from 'virtual:bls-scores';
import {
    READ_ENTRY_KEYS,
    READ_FILE_KEYS,
    READ_TASK_KEYS,
    buildBlsBundle,
    parseBlsScores,
    slimBlsFile,
    type RawBlsFile,
} from '../utils/blsScoresData';
import { BLS_SCORE_RISK, BLS_SCORES_META, blsScoreFor, loadAllBlsScores } from '../utils/blsScores';

const FILE_PATH = path.resolve(__dirname, '../data/ai_scores_bls.json');
const FULL = JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8')) as RawBlsFile & { scores: Record<string, Record<string, unknown> & { tasks: Record<string, unknown>[] }> };
const PARSED = parseBlsScores(FULL);
const SOCS = Object.keys(FULL.scores).sort();

const served: Record<string, RawBlsFile> = {};
beforeAll(async () => {
    for (const [code, load] of Object.entries(fieldLoaders)) served[code] = (await load()).default;
    await loadAllBlsScores();
});

describe('what the main bundle holds', () => {
    it('one Automation Risk per scored SOC, equal to the full file parsed', () => {
        expect(Object.keys(risks).sort()).toEqual(SOCS);
        expect(PARSED.scores.size).toBe(SOCS.length);
        for (const soc of SOCS) expect(risks[soc], soc).toBe(PARSED.scores.get(soc)!.automationCostIndex);
        expect([...BLS_SCORE_RISK.keys()].sort()).toEqual(SOCS);
    });

    it('meta: model, file date, count, first and last scoredAt and rule counts from the full file', () => {
        const dates = Object.values(FULL.scores).map((e) => e.scoredAt as string).sort((a, b) => Date.parse(a) - Date.parse(b));
        const rules: Record<string, number> = {};
        for (const e of Object.values(FULL.scores)) rules[e.rule as string] = (rules[e.rule as string] ?? 0) + 1;
        expect(meta).toEqual({
            model: FULL.model,
            generatedAt: FULL.generatedAt,
            count: SOCS.length,
            firstScoredAt: dates[0],
            lastScoredAt: dates[dates.length - 1],
            rules,
        });
        expect(BLS_SCORES_META).toEqual(meta);
    });

    it('stays small: no task text or forecasts in the main bundle', () => {
        const size = JSON.stringify({ meta, risks }).length;
        expect(size).toBeLessThan(40_000);
        expect(JSON.stringify(risks)).not.toMatch(/taskName|yearlyForecast|reasoning/);
    });
});

describe('what each field chunk holds', () => {
    it('every scored SOC is in exactly one chunk, its own field', () => {
        const seen: string[] = [];
        for (const [code, file] of Object.entries(served)) {
            for (const soc of Object.keys(file.scores ?? {})) {
                expect(soc.slice(0, 2), soc).toBe(code);
                seen.push(soc);
            }
        }
        expect(seen.sort()).toEqual(SOCS);
    });

    it('only the fields the app reads, each value equal to the full file', () => {
        for (const file of Object.values(served)) {
            expect(Object.keys(file).sort()).toEqual([...READ_FILE_KEYS, 'scores'].sort());
            for (const k of READ_FILE_KEYS) expect(file[k], k).toEqual(FULL[k]);
            for (const [soc, entry] of Object.entries(file.scores!)) {
                const full = FULL.scores[soc];
                expect(Object.keys(entry).sort(), soc).toEqual([...READ_ENTRY_KEYS, 'tasks'].filter((k) => k in full).sort());
                for (const k of READ_ENTRY_KEYS) expect((entry as Record<string, unknown>)[k], `${soc} ${k}`).toEqual(full[k]);
                expect(entry.tasks!.length, soc).toBe(full.tasks.length);
                entry.tasks!.forEach((t, i) => {
                    expect(Object.keys(t).sort(), `${soc} task ${i}`).toEqual([...READ_TASK_KEYS].sort());
                    for (const k of READ_TASK_KEYS) expect((t as Record<string, unknown>)[k], `${soc} task ${i} ${k}`).toBe(full.tasks[i][k]);
                });
            }
        }
    });

    it('parses to exactly the score the full file gives, field for field', () => {
        for (const soc of SOCS) {
            expect(blsScoreFor(soc), soc).toEqual(PARSED.scores.get(soc));
        }
        // The parser reads nothing the slimming drops.
        expect(parseBlsScores(slimBlsFile(FULL))).toEqual(PARSED);
    });

    it('drops what the app never reads (yearly forecasts, prompt inputs, hashes)', () => {
        const text = JSON.stringify(served);
        for (const k of ['yearlyForecast', 'promptSha256', 'employment', 'projectedGrowth', 'rule']) expect(text.includes(`"${k}":`), k).toBe(false);
        expect(text.length).toBeLessThan(fs.statSync(FILE_PATH).size * 0.7);
    });
});

describe('buildBlsBundle', () => {
    it('serves nothing for a missing or other-version file', () => {
        expect(buildBlsBundle(null)).toEqual({ meta: null, risks: {}, fields: {} });
        expect(buildBlsBundle({ ...FULL, version: 4 })).toEqual({ meta: null, risks: {}, fields: {} });
    });

    it('leaves out an incomplete entry everywhere, as the parser does', () => {
        const task = { taskName: 'FIXTURE task', aiCapabilityScore: 0.5, humanCriticalityScore: 0.5, onetCode: '99-0001.00', taskId: 1 };
        const b = buildBlsBundle({
            version: FULL.version,
            model: 'claude-sonnet-5',
            scores: {
                '99-0001': { title: 'FIXTURE', scoredAt: '2026-01-01T00:00:00Z', tasks: [task] },
                '99-0002': { title: 'FIXTURE', scoredAt: '2026-01-01T00:00:00Z', tasks: [{ ...task, aiCapabilityScore: 2 }] },
            },
        });
        expect(Object.keys(b.risks)).toEqual(['99-0001']);
        expect(Object.keys(b.fields['99'].scores!)).toEqual(['99-0001']);
        expect(b.meta!.count).toBe(1);
    });
});
