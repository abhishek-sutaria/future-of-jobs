/**
 * Vite plugin: serves src/data/ai_scores_bls.json to the app in two parts, so
 * the main bundle no longer carries the whole file (about 1.5 MB, most of it
 * yearly forecasts and prompt inputs the app never reads).
 *
 *   virtual:bls-scores             meta (count, date range), one Automation
 *                                  Risk and one mean Human Criticality per
 *                                  scored SOC, and a lazy loader per field
 *   virtual:bls-scores/scores-<NN>  that field's scores, slimmed to the fields
 *                                  the app reads (its own chunk)
 *
 * Both come from buildBlsBundle (src/utils/blsScoresData.ts), the same code
 * the app parses with. With no file, the meta is null and nothing is scored,
 * as before.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildBlsBundle, type BlsBundle, type RawBlsFile } from '../../src/utils/blsScoresData';

export const BLS_SCORES_MODULE = 'virtual:bls-scores';
const FIELD_PREFIX = `${BLS_SCORES_MODULE}/scores-`;
const RESOLVED = '\0';

export function blsScoresPlugin(relativeFile = 'src/data/ai_scores_bls.json'): Plugin {
    let file = '';
    let cache: { mtimeMs: number; bundle: BlsBundle } | null = null;

    const bundle = (): BlsBundle => {
        if (!fs.existsSync(file)) return buildBlsBundle(null);
        const { mtimeMs } = fs.statSync(file);
        if (cache?.mtimeMs !== mtimeMs) {
            cache = { mtimeMs, bundle: buildBlsBundle(JSON.parse(fs.readFileSync(file, 'utf-8')) as RawBlsFile) };
        }
        return cache.bundle;
    };

    return {
        name: 'foj-bls-scores',
        configResolved(config) {
            file = path.resolve(config.root, relativeFile);
        },
        resolveId(id) {
            if (id === BLS_SCORES_MODULE || id.startsWith(FIELD_PREFIX)) return RESOLVED + id;
            return null;
        },
        load(id) {
            if (!id.startsWith(RESOLVED + BLS_SCORES_MODULE)) return null;
            this.addWatchFile(file);
            const b = bundle();
            const name = id.slice(RESOLVED.length);
            if (name === BLS_SCORES_MODULE) {
                const loaders = Object.keys(b.fields)
                    .sort()
                    .map((code) => `${JSON.stringify(code)}: () => import(${JSON.stringify(FIELD_PREFIX + code)})`);
                return [
                    `export const meta = ${JSON.stringify(b.meta)};`,
                    `export const risks = ${JSON.stringify(b.risks)};`,
                    `export const humans = ${JSON.stringify(b.humans)};`,
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
