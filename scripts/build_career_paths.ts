/**
 * Builds the career paths data from two committed O*NET 30.1 files
 * (data/db_30_1_text/Related Occupations.txt and Job Zones.txt, every input
 * sha256-pinned in data/career_paths/sources.json). The method is in
 * scripts/lib/careerPaths.ts; the report is docs/career-paths.md.
 *
 *   npx tsx scripts/build_career_paths.ts           build and write every output
 *   npx tsx scripts/build_career_paths.ts --check   build and fail if any committed output differs
 *   --root <dir>                                    read inputs and outputs under <dir> (tests)
 *
 * No network and no Claude calls. The same inputs always give the same bytes.
 * Independent check: python3 scripts/verify_career_paths.py
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCareerPaths, loadCareerPathsInputs, outputFiles, staleOutputs } from './lib/careerPaths';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function main(): void {
    const args = process.argv.slice(2);
    const check = args.includes('--check');
    const r = args.indexOf('--root');
    const root = r >= 0 ? path.resolve(args[r + 1] ?? '') : REPO;
    const built = buildCareerPaths(loadCareerPathsInputs(root));
    const stale = staleOutputs(root, built);
    if (check) {
        if (stale.length > 0) {
            console.error(`build_career_paths: out of date: ${stale.join(', ')}. Run npx tsx scripts/build_career_paths.ts`);
            process.exit(1);
        }
    } else {
        for (const [rel, body] of outputFiles(built)) {
            if (!stale.includes(rel)) continue;
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), body);
        }
    }
    const c = built.counts;
    console.log(
        `${check ? 'Up to date' : `Wrote ${stale.length} file(s)`}: ${c.jobs} jobs, ${c.withLinks} with at least 1 link, ${c.withFivePlus} with 5 or more, ` +
            `${c.noData} no data; ${c.links} links from ${c.rowsUsed} rows (${c.rowsSelf} self, ${c.rowsUnmapped} unmapped, ${c.rowsNotOwnCode} sub-code rows whose part has its own .00 not used); ` +
            `Job Zone ${c.withJobZone}, mixed ${c.mixedZones}; unmapped codes ${built.unmapped.map((u) => u.code).join(', ') || 'none'}.`,
    );
}

main();
