
const fs = require('fs');
const path = require('path');

// Read the generated data file
// Note: We need to do a bit of hacky reading because it's a TS file
const dataPath = path.join(__dirname, '../src/data.ts');
const rawContent = fs.readFileSync(dataPath, 'utf8');

// Extract the JSON-like array string
const match = rawContent.match(/export const initialJobs: Job\[\] = (\[[\s\S]*?\]);/);
if (!match) {
    console.error('❌ Could not parse initialJobs from src/data.ts');
    process.exit(1);
}

let jobs;
try {
    const jsonStr = match[1]
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/'/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
    jobs = JSON.parse(jsonStr);
} catch (e) {
    try {
        jobs = (new Function('return ' + match[1]))();
    } catch (e2) {
        console.error('❌ Parse failed:', e2.message);
        process.exit(1);
    }
}

console.log(`\n🔍 VALIDATING ${jobs.length} JOBS...\n`);

let errors = 0;
let warnings = 0;
let highConfidence = 0;
let lowConfidence = 0;

console.log('---------------------------------------------------');
console.log('| Job Title                 | Growth | Conf | Alias');
console.log('---------------------------------------------------');

jobs.forEach(job => {
    // 1. Nan Check
    if (isNaN(job.projectedGrowth)) {
        console.error(`❌ NaN Error: ${job.title} has invalid growth.`);
        errors++;
    }

    // 2. Outlier Check (Extreme Growth > 30% or < -20%)
    if (job.projectedGrowth > 40 || job.projectedGrowth < -20) {
        console.warn(`⚠️  Outlier: ${job.title} growth is ${job.projectedGrowth}%`);
        warnings++;
    }

    // 3. Confidence Stats
    if (job.confidenceScore >= 0.7) highConfidence++;
    else lowConfidence++;

    // Log Row
    const title = job.title.padEnd(25).slice(0, 25);
    const growth = job.projectedGrowth.toFixed(1).padStart(5);
    const conf = job.confidenceScore.toFixed(1).padStart(4);
    const alias = job.isAlias ? 'Proxy' : 'Direct';

    console.log(`| ${title} | ${growth}% | ${conf} | ${alias}`);
});

console.log('---------------------------------------------------');
console.log(`\n📊 SUMMARY`);
console.log(`High Confidence (>=0.7): ${highConfidence} (${((highConfidence / jobs.length) * 100).toFixed(1)}%)`);
console.log(`Low Confidence/Proxies:  ${lowConfidence}`);
console.log(`Errors: ${errors}`);
console.log(`Warnings: ${warnings}`);

if (errors > 0) {
    console.log('\n❌ VALIDATION FAILED');
    process.exit(1);
} else {
    console.log('\n✅ VALIDATION PASSED');
    process.exit(0);
}
