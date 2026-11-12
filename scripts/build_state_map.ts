/**
 * Builds the state map's data from the committed BLS OEWS May 2025 state file
 * (data/oews_state/, every input sha256-pinned in sources.json). The method is
 * in scripts/lib/stateMap.ts; the coverage report is docs/state-map.md.
 *
 *   npx tsx scripts/build_state_map.ts           build and write every output
 *   npx tsx scripts/build_state_map.ts --check   build and fail if any committed output differs
 *
 * No network and no Claude calls. The same inputs always give the same bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStateMap, loadStateMapInputs, outputFiles, staleOutputs } from './lib/stateMap';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function main(): void {
    const check = process.argv.slice(2).includes('--check');
    const built = buildStateMap(loadStateMapInputs(ROOT));
    const stale = staleOutputs(ROOT, built);
    if (check) {
        if (stale.length > 0) {
            console.error(`build_state_map: out of date: ${stale.join(', ')}. Run npx tsx scripts/build_state_map.ts`);
            process.exit(1);
        }
    } else {
        for (const [rel, body] of outputFiles(built)) {
            if (!stale.includes(rel)) continue;
            fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
            fs.writeFileSync(path.join(ROOT, rel), body);
        }
    }
    const c = built.counts;
    console.log(`${check ? 'Up to date' : `Wrote ${stale.length} file(s)`}: ${c.jobs} jobs: ${c.full} full map, ${c.partial} some areas hidden, ${c.none} no state data. Kelley: ${c.kelleySocs} codes, ${c.kelleyRows} rows, ${built.kelleyChanges.length} changed vs the earlier data.`);
}

main();
