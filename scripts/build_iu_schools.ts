/**
 * Builds the IU Bloomington schools data from the committed sources in
 * data/iu_schools/ (scripts/lib/iuSchools.ts has the method):
 *
 *   src/data/iu_schools.json      school -> majors (name, degree, CIP) -> jobs, plus every CIP used
 *   src/data/iu_school_jobs.json  the slim list the app loads when the school filter opens
 *   docs/iu-schools.md            coverage report: counts, gaps, roll-up, sources
 *
 *   npx tsx scripts/build_iu_schools.ts            build and write the three files
 *   npx tsx scripts/build_iu_schools.ts --check    build and fail if any committed file differs
 *   npx tsx scripts/build_iu_schools.ts --ipeds-zip <C2024_A.zip>
 *       re-cut every IPEDS extract in sources.json (IU Bloomington's rows, and
 *       IU Indianapolis's nursing rows) from the NCES zip after checking the
 *       zip's and the member's sha256
 *
 * No network and no Claude calls. The same inputs always give the same bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIuSchools, IU_SCHOOLS_PATHS, loadIuSchoolInputs, serialize, sha256, type SourcesManifest } from './lib/iuSchools';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fail(msg: string): never {
    console.error(`build_iu_schools: ${msg}`);
    process.exit(1);
}

function recutIpeds(zipPath: string): void {
    const sources = JSON.parse(fs.readFileSync(path.join(ROOT, IU_SCHOOLS_PATHS.sources), 'utf-8')) as SourcesManifest;
    const entries = sources.files.filter((f) => f.zipSha256 && f.ipedsUnitid);
    if (entries.length === 0) fail('sources.json has no IPEDS zip entry');
    const zip = fs.readFileSync(zipPath);
    for (const entry of entries) {
        if (sha256(zip) !== entry.zipSha256) fail(`${zipPath}: sha256 ${sha256(zip)} is not the recorded ${entry.zipSha256}`);
        const member = execFileSync('unzip', ['-p', zipPath, entry.member!], { maxBuffer: 256 * 1024 * 1024 });
        if (sha256(member) !== entry.memberSha256) fail(`${entry.member}: sha256 ${sha256(member)} is not the recorded ${entry.memberSha256}`);
        const lines = member.toString('utf-8').split('\n');
        const prefix = entry.cipPrefix ? `${entry.ipedsUnitid},"${entry.cipPrefix}` : `${entry.ipedsUnitid},`;
        const kept = [lines[0], ...lines.slice(1).filter((l) => l.startsWith(prefix))];
        const out = `${kept.join('\n')}\n`;
        const dest = path.join(ROOT, 'data/iu_schools', entry.path);
        fs.writeFileSync(dest, out);
        console.log(`Wrote ${path.relative(ROOT, dest)}: ${kept.length - 1} rows, sha256 ${sha256(out)} (sources.json has ${entry.sha256})`);
    }
}

function main(): void {
    const args = process.argv.slice(2);
    const zipAt = args.indexOf('--ipeds-zip');
    if (zipAt >= 0) {
        if (!args[zipAt + 1]) fail('--ipeds-zip needs the path of C2024_A.zip');
        recutIpeds(args[zipAt + 1]);
        return;
    }
    const check = args.includes('--check');
    const { full, slim, report } = buildIuSchools(loadIuSchoolInputs(ROOT));
    const outputs: [string, string][] = [
        [IU_SCHOOLS_PATHS.full, serialize(full)],
        [IU_SCHOOLS_PATHS.slim, serialize(slim)],
        [IU_SCHOOLS_PATHS.report, report],
    ];
    const stale: string[] = [];
    for (const [rel, body] of outputs) {
        const abs = path.join(ROOT, rel);
        const same = fs.existsSync(abs) && fs.readFileSync(abs, 'utf-8') === body;
        if (check) {
            if (!same) stale.push(rel);
        } else if (!same) {
            fs.writeFileSync(abs, body);
        }
    }
    if (check && stale.length > 0) fail(`out of date: ${stale.join(', ')}. Run npx tsx scripts/build_iu_schools.ts`);
    const c = full._meta.counts;
    console.log(`${check ? 'Up to date' : 'Wrote'}: ${c.schoolsInDropdown}/${c.schools} schools with jobs, ${c.matchedPrograms}/${c.programs} programs matched, ${c.cips} CIP codes, ${c.jobs} jobs.`);
    for (const s of full.schools) console.log(`  ${s.name}: ${s.majorCount} programs (${s.matchedMajorCount} matched), ${s.cips.length} CIPs, ${s.jobs.length} jobs${s.inDropdown ? '' : ' (not in dropdown)'}`);
}

main();
