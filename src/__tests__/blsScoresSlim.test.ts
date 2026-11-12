/**
 * The build serves src/data/ai_scores_bls.json in parts (scripts/lib/
 * blsScoresPlugin.ts): one Automation Risk per non-Kelley SOC in the main
 * bundle, the Kelley SOCs' entries whole (slimmed) in the main bundle, and
 * each field's other scores, slimmed, in its own chunk; plus the part of
 * ai_scores.json still needed (Kelley titles whose SOC has no entry yet).
 * These tests read what the plugin really serves and check it against the full
 * files on every field the app reads, so no displayed number can change. They
 * hold before and after `--batch kelley` (kelleyBatch.test.ts builds both).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { meta, risks, humans, kelley, fieldLoaders } from 'virtual:bls-scores';
import legacy from 'virtual:kelley-legacy-scores';
import { KELLEY_JOB_SOCS, KELLEY_SOC_SET } from '../utils/kelleySocs';
import {
    READ_ENTRY_KEYS,
    READ_FILE_KEYS,
    READ_TASK_KEYS,
    buildBlsBundle,
    legacyKelleySubset,
    parseBlsScores,
    slimBlsFile,
    type RawBlsFile,
} from '../utils/blsScoresData';
import { BLS_SCORE_HUMAN, BLS_SCORE_RISK, BLS_SCORES_META, KELLEY_SOC_SCORES, blsScoreFor, loadAllBlsScores } from '../utils/blsScores';

const FILE_PATH = path.resolve(__dirname, '../data/ai_scores_bls.json');
const FULL = JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8')) as RawBlsFile & { scores: Record<string, Record<string, unknown> & { tasks: Record<string, unknown>[] }> };
const PARSED = parseBlsScores(FULL);
const ALL_SOCS = Object.keys(FULL.scores).sort();
/** Scored SOCs outside the Kelley SOCs: risks, humans and the field chunks. */
const SOCS = ALL_SOCS.filter((soc) => !KELLEY_SOC_SET.has(soc));
/** Kelley SOCs already scored by --batch kelley (none before it runs). */
const KELLEY_ON_FILE = ALL_SOCS.filter((soc) => KELLEY_SOC_SET.has(soc));
const LEGACY_FILE = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/ai_scores.json'), 'utf-8'));

const served: Record<string, RawBlsFile> = {};
beforeAll(async () => {
    for (const [code, load] of Object.entries(fieldLoaders)) served[code] = (await load()).default;
    await loadAllBlsScores();
});

describe('what the main bundle holds', () => {
    it('one Automation Risk per scored non-Kelley SOC, equal to the full file parsed', () => {
        expect(Object.keys(risks).sort()).toEqual(SOCS);
        expect(PARSED.scores.size).toBe(ALL_SOCS.length);
        for (const soc of SOCS) expect(risks[soc], soc).toBe(PARSED.scores.get(soc)!.automationCostIndex);
        expect([...BLS_SCORE_RISK.keys()].sort()).toEqual(SOCS);
    });

    it('one mean Human Criticality per scored SOC, exact at 4 decimals, so ranks need no field load', () => {
        expect(Object.keys(humans).sort()).toEqual(SOCS);
        for (const soc of SOCS) {
            const full = PARSED.scores.get(soc)!.humanCriticality;
            expect(humans[soc], soc).toBe(Math.round(full * 10_000) / 10_000);
            // Five (or four) two-decimal scores: the mean is exact at 4 decimals.
            const hundredths = PARSED.scores.get(soc)!.tasks.reduce((sum, t) => sum + Math.round(t.humanCriticalityScore * 100), 0);
            expect(Math.round(humans[soc] * 10_000), soc).toBe((hundredths * 100) / PARSED.scores.get(soc)!.tasks.length);
        }
        expect([...BLS_SCORE_HUMAN.keys()].sort()).toEqual(SOCS);
    });

    it('meta: model, file date, count, first and last scoredAt and rule counts from the full file', () => {
        const dates = Object.values(FULL.scores).map((e) => e.scoredAt as string).sort((a, b) => Date.parse(a) - Date.parse(b));
        const rules: Record<string, number> = {};
        for (const e of Object.values(FULL.scores)) rules[e.rule as string] = (rules[e.rule as string] ?? 0) + 1;
        expect(meta).toEqual({
            model: FULL.model,
            generatedAt: FULL.generatedAt,
            count: ALL_SOCS.length,
            firstScoredAt: dates[0],
            lastScoredAt: dates[dates.length - 1],
            rules,
        });
        expect(BLS_SCORES_META).toEqual(meta);
    });

    it('stays small: no task text or forecasts in the main bundle, except the Kelley SOCs', () => {
        const size = JSON.stringify({ meta, risks, humans }).length;
        expect(size).toBeLessThan(40_000);
        expect(JSON.stringify({ risks, humans })).not.toMatch(/taskName|yearlyForecast|reasoning/);
        // 47 Kelley SOCs at five tasks each, slimmed: well under 80 kB, and never forecasts.
        expect(JSON.stringify(kelley).length).toBeLessThan(80_000);
        expect(JSON.stringify(kelley)).not.toMatch(/yearlyForecast|reasoning|promptSha256/);
    });

    it('the Kelley SOCs that are on file, whole and slimmed, and no other SOC', () => {
        expect(Object.keys(kelley.scores ?? {}).sort()).toEqual(KELLEY_ON_FILE);
        for (const soc of KELLEY_ON_FILE) {
            expect(kelley.scores![soc], soc).toEqual(slimBlsFile(FULL).scores![soc]);
            expect(KELLEY_SOC_SCORES.get(soc), soc).toEqual(PARSED.scores.get(soc));
        }
        expect(KELLEY_SOC_SCORES.size).toBe(KELLEY_ON_FILE.length);
    });

    it('the old ai_scores.json entries only for Kelley titles whose SOC is not on file yet', () => {
        const waiting = KELLEY_JOB_SOCS.filter((k) => !KELLEY_ON_FILE.includes(k.soc)).map((k) => k.id).sort();
        expect(Object.keys(legacy.scores ?? {}).sort()).toEqual(waiting);
        for (const id of waiting) expect(legacy.scores![id], id).toEqual(LEGACY_FILE.scores[id]);
        expect(legacy.generatedAt).toBe(LEGACY_FILE.generatedAt);
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
        const none = { meta: null, risks: {}, humans: {}, kelley: { scores: {} }, fields: {} };
        expect(buildBlsBundle(null)).toEqual(none);
        expect(buildBlsBundle({ ...FULL, version: 4 })).toEqual(none);
    });

    it('puts a Kelley SOC in `kelley` only: never in risks, humans or a field chunk; meta counts every entry', () => {
        const task = { taskName: 'FIXTURE task', aiCapabilityScore: 0.5, humanCriticalityScore: 0.6, onetCode: '99-0001.00', taskId: 1 };
        const entry = { title: 'FIXTURE', rule: 'first-5-onet-order', scoredAt: '2026-11-09T00:00:00Z', tasks: [task], yearlyForecast: [] };
        const b = buildBlsBundle({ version: FULL.version, model: 'claude-sonnet-5', scores: { '99-0001': entry, '99-0002': entry } }, ['99-0002']);
        expect(Object.keys(b.risks)).toEqual(['99-0001']);
        expect(Object.keys(b.humans)).toEqual(['99-0001']);
        expect(Object.keys(b.fields['99'].scores!)).toEqual(['99-0001']);
        expect(Object.keys(b.kelley.scores!)).toEqual(['99-0002']);
        expect(b.kelley.scores!['99-0002']).not.toHaveProperty('yearlyForecast');
        expect(b.kelley.version).toBe(FULL.version);
        expect(b.meta!.count).toBe(2);
        expect(b.meta!.rules).toEqual({ 'first-5-onet-order': 2 });
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

describe('legacyKelleySubset', () => {
    const jobs = [{ id: 'job-a', soc: '99-0001' }, { id: 'job-b', soc: '99-0001' }, { id: 'job-c', soc: '99-0002' }];
    const file = { version: 5, model: 'm', generatedAt: '2026-08-20T00:00:00Z', scores: { 'job-a': 1, 'job-b': 2, 'job-c': 3, 'job-x': 4 } };
    it('keeps only titles whose SOC has no entry on file (both titles of a shared SOC go together)', () => {
        expect(legacyKelleySubset(file, jobs, new Set()).scores).toEqual({ 'job-a': 1, 'job-b': 2, 'job-c': 3 });
        expect(legacyKelleySubset(file, jobs, new Set(['99-0001'])).scores).toEqual({ 'job-c': 3 });
        expect(legacyKelleySubset(file, jobs, new Set(['99-0001', '99-0002'])).scores).toEqual({});
        expect(legacyKelleySubset(file, jobs, new Set(['99-0001'])).generatedAt).toBe(file.generatedAt);
    });
    it('is empty with no file', () => {
        expect(legacyKelleySubset(null, jobs, new Set()).scores).toEqual({});
    });
});
