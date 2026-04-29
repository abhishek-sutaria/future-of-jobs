/**
 * One-shot extraction script for the 37 new Kelley Top 50 jobs.
 * Reads: BLS OES Excel + O*NET Task Statements
 * Outputs: JSON with employment + top 5 task descriptions per job
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DATA_DIR = path.join(__dirname, '../data');

const NEW_JOBS = [
  { soc: '11-2011', title: 'Brand Manager' },
  { soc: '11-2031', title: 'Public Relations Manager' },
  { soc: '41-3011', title: 'Advertising Sales Agent' },
  { soc: '13-1121', title: 'Event Coordinator' },
  { soc: '41-3091', title: 'Account Executive' },
  { soc: '41-4011', title: 'Sales Representative' },
  { soc: '41-3021', title: 'Insurance Sales Agent' },
  { soc: '13-2052', title: 'Personal Financial Advisor' },
  { soc: '13-2041', title: 'Credit Analyst' },
  { soc: '13-2030', title: 'Budget Analyst' },
  { soc: '13-2099', title: 'Risk Specialist' },
  { soc: '13-2053', title: 'Insurance Underwriter' },
  { soc: '15-2011', title: 'Actuary' },
  { soc: '13-2072', title: 'Loan Officer' },
  { soc: '15-2051', title: 'Data Scientist' },
  { soc: '15-2041', title: 'Statistician' },
  { soc: '15-1211', title: 'Computer Systems Analyst' },
  { soc: '13-1051', title: 'Cost Estimator' },
  { soc: '13-1141', title: 'Compensation Analyst' },
  { soc: '11-3061', title: 'Purchasing Manager' },
  { soc: '13-1022', title: 'Wholesale & Retail Buyer' },
  { soc: '13-1023', title: 'Purchasing Agent' },
  { soc: '11-3051', title: 'Industrial Production Manager' },
  { soc: '15-1255', title: 'UX Designer' },
  { soc: '11-3021', title: 'IT Manager' },
  { soc: '15-1212', title: 'Cybersecurity Analyst' },
  { soc: '15-1254', title: 'Web Developer' },
  { soc: '15-1242', title: 'Database Administrator' },
  { soc: '15-1299', title: 'IT Project Manager' },
  { soc: '11-1021', title: 'General Manager' },
  { soc: '11-3121', title: 'HR Manager' },
  { soc: '13-1082', title: 'Project Management Specialist' },
  { soc: '13-1151', title: 'Training & Development Specialist' },
  { soc: '13-1071', title: 'HR Specialist' },
  { soc: '11-3131', title: 'Training & Development Manager' },
  { soc: '11-3111', title: 'Compensation & Benefits Manager' },
  { soc: '13-2054', title: 'Financial Risk Analyst' },
];

async function run() {
  // --- Step 1: BLS Employment ---
  const blsFile = fs.existsSync(path.join(DATA_DIR, 'all_data_M_2024.xlsx'))
    ? path.join(DATA_DIR, 'all_data_M_2024.xlsx')
    : path.join(DATA_DIR, 'all_data_M_2023.xlsx');

  const blsMap = new Map();
  console.log('Reading BLS data...');
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(blsFile, {});
  let colIdx = { soc: 1, emp: 2 };
  for await (const ws of workbookReader) {
    for await (const row of ws) {
      if (row.number === 1) {
        row.values.forEach((val, idx) => {
          if (!val) return;
          const v = String(val).trim();
          if (v === 'OCC_CODE') colIdx.soc = idx;
          if (v === 'TOT_EMP') colIdx.emp = idx;
        });
        continue;
      }
      const soc = row.getCell(colIdx.soc).text;
      const emp = row.getCell(colIdx.emp).value;
      if (soc && /^\d{2}-\d{4}$/.test(soc)) {
        const empVal = typeof emp === 'number' ? emp : Number(String(emp).replace(/,/g, ''));
        if (!isNaN(empVal) && empVal > 0) blsMap.set(soc, empVal);
      }
    }
  }
  console.log(`BLS loaded: ${blsMap.size} occupations`);

  // --- Step 2: O*NET Tasks ---
  const taskContent = fs.readFileSync(path.join(DATA_DIR, 'db_30_1_text/Task Statements.txt'), 'utf-8');
  const taskLines = taskContent.split('\n').slice(1); // skip header
  const rawTasks = {};
  for (const line of taskLines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const key = parts[0].substring(0, 7); // e.g. "11-2011"
    const text = parts[2]?.trim();
    if (!key || !text) continue;
    if (!rawTasks[key]) rawTasks[key] = [];
    if (rawTasks[key].length < 8) rawTasks[key].push(text);
  }

  // --- Step 3: Build output ---
  const results = NEW_JOBS.map(job => ({
    title: job.title,
    soc: job.soc,
    employment: blsMap.get(job.soc) || null,
    tasks: (rawTasks[job.soc] || []).slice(0, 5),
  }));

  fs.writeFileSync(
    path.join(DATA_DIR, 'new_jobs_extract.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('Written: data/new_jobs_extract.json');
  results.forEach(r => {
    console.log(`  ${r.title} (${r.soc}): emp=${r.employment?.toLocaleString() ?? 'NOT FOUND'}, tasks=${r.tasks.length}`);
  });
}

run().catch(console.error);
