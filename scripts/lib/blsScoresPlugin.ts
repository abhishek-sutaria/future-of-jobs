/**
 * Vite plugin: serves src/data/ai_scores_bls.json to the app in two parts, so
 * the main bundle no longer carries the whole file (about 1.5 MB, most of it
 * yearly forecasts and prompt inputs the app never reads).
 *
 *   virtual:bls-scores             meta (count, date range), one Automation
 *                                  Risk and one mean Human Criticality per
 *                                  scored non-Kelley SOC, the Kelley SOCs'
 *                                  entries whole (`kelley`), and a lazy loader
 *                                  per field
 *   virtual:bls-scores/scores-<NN>  that field's non-Kelley scores, slimmed to
 *                                  the fields the app reads (its own chunk)
 *   virtual:kelley-legacy-scores   the entries of src/data/ai_scores.json for
 *                                  Kelley titles whose SOC has no entry in
 *                                  ai_scores_bls.json yet (empty once
 *                                  --batch kelley is in, so the app then reads
 *                                  nothing from ai_scores.json)
 *
 * All come from buildBlsBundle / legacyKelleySubset (src/utils/blsScoresData.ts),
 * the same code the app parses with. With no file, the meta is null and only
 * the Kelley titles' old scores are used, as before.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildBlsBundle, legacyKelleySubset, type BlsBundle, type LegacyKelleyFile, type RawBlsFile } from '../../src/utils/blsScoresData';
import { KELLEY_JOB_SOCS, KELLEY_SOC_SET } from '../../src/utils/kelleySocs';

export const BLS_SCORES_MODULE = 'virtual:bls-scores';
export const KELLEY_LEGACY_MODULE = 'virtual:kelley-legacy-scores';
const FIELD_PREFIX = `${BLS_SCORES_MODULE}/scores-`;
const RESOLVED = '\0';

const readJson = <T>(file: string): T | null => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as T) : null);
const mtime = (file: string) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : -1);

export function blsScoresPlugin(relativeFile = 'src/data/ai_scores_bls.json', legacyRelativeFile = 'src/data/ai_scores.json'): Plugin {
    let file = '';
    let legacyFile = '';
    let cache: { key: string; bundle: BlsBundle; legacy: LegacyKelleyFile } | null = null;

    const build = () => {
        const key = `${mtime(file)}|${mtime(legacyFile)}`;
        if (cache?.key !== key) {
            const bundle = buildBlsBundle(readJson<RawBlsFile>(file), KELLEY_SOC_SET);
            const onFile = new Set(Object.keys(bundle.kelley.scores ?? {}));
            cache = { key, bundle, legacy: legacyKelleySubset(readJson<LegacyKelleyFile>(legacyFile), KELLEY_JOB_SOCS, onFile) };
        }
        return cache;
    };

    return {
        name: 'foj-bls-scores',
        configResolved(config) {
            file = path.resolve(config.root, relativeFile);
            legacyFile = path.resolve(config.root, legacyRelativeFile);
        },
        resolveId(id) {
            if (id === BLS_SCORES_MODULE || id === KELLEY_LEGACY_MODULE || id.startsWith(FIELD_PREFIX)) return RESOLVED + id;
            return null;
        },
        load(id) {
            if (id === RESOLVED + KELLEY_LEGACY_MODULE) {
                this.addWatchFile(file);
                this.addWatchFile(legacyFile);
                return `export default JSON.parse(${JSON.stringify(JSON.stringify(build().legacy))});`;
            }
            if (!id.startsWith(RESOLVED + BLS_SCORES_MODULE)) return null;
            this.addWatchFile(file);
            const b = build().bundle;
            const name = id.slice(RESOLVED.length);
            if (name === BLS_SCORES_MODULE) {
                const loaders = Object.keys(b.fields)
                    .sort()
                    .map((code) => `${JSON.stringify(code)}: () => import(${JSON.stringify(FIELD_PREFIX + code)})`);
                return [
                    `export const meta = ${JSON.stringify(b.meta)};`,
                    `export const risks = ${JSON.stringify(b.risks)};`,
                    `export const humans = ${JSON.stringify(b.humans)};`,
                    `export const kelley = ${JSON.stringify(b.kelley)};`,
                    `export const fieldLoaders = {${loaders.join(', ')}};`,
                ].join('\n');
            }
            const code = name.slice(FIELD_PREFIX.length);
            const field = b.fields[code];
            if (!field) this.error(`No AI scores for field ${code}`);
            return `export default JSON.parse(${JSON.stringify(JSON.stringify(field))});`;
        },
    };
}
