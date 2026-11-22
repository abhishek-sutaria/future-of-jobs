/**
 * Writes api/_lib/courseMatchesData.ts: the only course data the app uses
 * (Step 3), for the server alone. It holds just the catalog entries some job
 * was matched to (data/course_catalog/matches.json), the job → course ids map
 * with each match's reason, and the Kelley role ids → SOC map (the browser
 * sends a Kelley role as "job-N"). Nothing in src/ imports it, so it is never
 * in the browser bundle.
 *
 *   npx tsx scripts/build_course_matches_server.ts           write it
 *   npx tsx scripts/build_course_matches_server.ts --check   fail if it is not what the data builds
 *
 * Fails if a match points to an entry that is not in catalog.json (a removed
 * or retired course), so a stale match can never reach the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServerCourseData, renderServerCourseData, SERVER_DATA_PATH } from './lib/courseMatchesServer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function main(): void {
    const check = process.argv.includes('--check');
    const data = buildServerCourseData(ROOT);
    const body = renderServerCourseData(data);
    const file = path.join(ROOT, SERVER_DATA_PATH);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (check) {
        if (current !== body) {
            console.error(`${SERVER_DATA_PATH} is out of date. Run npx tsx scripts/build_course_matches_server.ts`);
            process.exit(1);
        }
    } else if (current !== body) {
        fs.writeFileSync(file, body);
    }
    console.log(`${check ? 'Up to date' : 'Wrote'} ${SERVER_DATA_PATH}: ${Object.keys(data.courses).length} courses, ${Object.keys(data.jobs).length} jobs with matches, ${Object.keys(data.kelley).length} Kelley ids, ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`);
}

main();
