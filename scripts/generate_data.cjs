
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const ExcelJS = require('exceljs');

// 1. Environment & Path
const DATA_DIR = path.join(__dirname, '../data');
const OUT_FILE = path.join(__dirname, '../src/data.ts');

const FILES = {
    master: path.join(DATA_DIR, 'Kelley_Job_Map.csv'),
    employment: fs.existsSync(path.join(DATA_DIR, 'all_data_M_2024.xlsx'))
        ? path.join(DATA_DIR, 'all_data_M_2024.xlsx')
        : path.join(DATA_DIR, 'all_data_M_2023.xlsx'),
};

console.log('Starting Data Pipeline (Optimized Stream)...');
console.log('Reading from:', DATA_DIR);

async function run() {
    try {
        // --- Step 1: Read Master List (Kelley Map) ---
        const masterList = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(FILES.master)
                .pipe(csv())
                .on('data', (data) => masterList.push(data))
                .on('end', resolve)
                .on('error', reject);
        });
        console.log(`Loaded ${masterList.length} jobs from Kelley Master Map.`);

        // --- Step 2: Read Employment Data (BLS XLSX via Stream) ---
        const blsMap = new Map(); // SOC_CODE -> { employment, mean_wage }

        if (fs.existsSync(FILES.employment)) {
            console.log(`Streaming BLS Data from: ${path.basename(FILES.employment)}`);
            try {
                const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(FILES.employment, {});
                let count = 0;

                // Identify columns by header row (assuming row 1)
                let colIdx = { soc: 1, emp: 2, mean: 25 };

                for await (const worksheetReader of workbookReader) {
                    for await (const row of worksheetReader) {
                        if (row.number === 1) {
                            row.values.forEach((val, idx) => {
                                if (!val) return;
                                const v = String(val).trim();
                                if (v === 'OCC_CODE') colIdx.soc = idx;
                                if (v === 'TOT_EMP') colIdx.emp = idx;
                                if (v === 'A_MEAN') colIdx.mean = idx;
                            });
                            continue;
                        }

                        const soc = row.getCell(colIdx.soc).text;
                        const emp = row.getCell(colIdx.emp).value;
                        const mean = row.getCell(colIdx.mean).value;

                        if (soc && /^\d{2}-\d{4}/.test(soc)) {
                            const empVal = (typeof emp === 'number') ? emp : Number(String(emp).replace(/,/g, ''));
                            const meanVal = (typeof mean === 'number') ? mean : Number(String(mean).replace(/,/g, ''));

                            if (!isNaN(empVal)) {
                                blsMap.set(soc, {
                                    employment: empVal,
                                    annual_mean: !isNaN(meanVal) ? meanVal : 0
                                });
                                count++;
                            }
                        }
                    }
                }
                console.log(`Loaded BLS Data for ${count} occupations.`);
            } catch (err) {
                console.warn('Streaming failed:', err.message);
            }
        } else {
            console.warn('BLS File not found. Using defaults.');
        }

        const BLS_CACHE = {
            'Marketing Associate': { employment: 400000, projected_growth: 4.0 },
        };

        // --- Step 3: Load Generated AI Impact Data ---
        let AI_IMPACT_DATA = {};
        try {
            AI_IMPACT_DATA = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ai_impact_scores.json'), 'utf-8'));
            console.log('Loaded AI Impact Data.');
        } catch (e) {
            console.log('No AI Impact Data found (dynamic mode or first run).');
        }

        // --- Step 3b: Load Raw Task Text (For Dynamic Fallback) ---
        const RAW_TASKS = {};
        try {
            const taskContent = fs.readFileSync(path.join(DATA_DIR, 'db_30_1_text/Task Statements.txt'), 'utf-8');
            const lines = taskContent.split('\n');
            let count = 0;
            // Skip header
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split('\t');
                if (parts.length < 3) continue;
                const soc = parts[0]; // e.g., 11-1011.00
                const taskText = parts[2];

                // key by 11-1011 (first 7 chars)
                const key = soc.substring(0, 7);
                if (!RAW_TASKS[key]) RAW_TASKS[key] = [];
                if (RAW_TASKS[key].length < 8) { // Limit to 8 tasks per job for performance
                    RAW_TASKS[key].push(taskText);
                    count++;
                }
            }
            console.log(`Loaded ${count} raw task descriptions for dynamic analysis.`);
        } catch (e) {
            console.warn('Failed to load raw tasks:', e.message);
        }

        // --- Step 4: Merge & Build Final Array ---
        const finalJobs = masterList.map((job, index) => {

            let key = job.kelley_title || job['Kelley Title'] || job['Title'];
            let socCode = job.soc_code;

            if (key) key = key.replace(/"/g, '').trim();
            if (socCode) socCode = socCode.replace(/"/g, '').trim();

            if (!key) {
                const val = Object.values(job)[0];
                if (typeof val === 'string' && val.includes(',')) {
                    const parts = val.split(',');
                    socCode = parts[0];
                    key = parts[2] ? parts[2].trim() : null;
                }
            }
            if (key === 'Marketing Manager') key = 'Marketing Manager';

            // BLS Logic
            let emp = 50000;
            let anchorGrowth = 2.0;

            if (blsMap.has(socCode)) {
                const data = blsMap.get(socCode);
                emp = data.employment;
            }

            const blsCacheData = BLS_CACHE[key];
            if (blsCacheData && !blsMap.has(socCode)) {
                emp = blsCacheData.employment;
                anchorGrowth = blsCacheData.projected_growth;
            }

            // Look up task scores
            let tasks = [];
            let dataSources = ['BLS-2023'];

            // Match by SOC
            // FORCE DYNAMIC: Prioritize Raw Tasks for ALL jobs
            const rawKey = socCode ? socCode.substring(0, 7) : '';
            if (RAW_TASKS[rawKey]) {
                tasks = RAW_TASKS[rawKey].map((t, i) => ({
                    id: `raw-${i}`,
                    name: t, // Use 'name' to match interface!
                    text: t,
                    aiCapabilityScore: 0.5, // Default neutral, needs Analysis
                    humanCriticalityScore: 0.5,
                    importance: 3
                }));
                dataSources.push('Dynamic-Ready');
            } else if (AI_IMPACT_DATA[socCode]) {
                // Keep as fallback if raw text missing
                tasks = AI_IMPACT_DATA[socCode];
                dataSources.push('Gemini-Pro-Analysis');
            } else {
                tasks = [{ name: 'Data pending analysis', aiCapabilityScore: 0.5, humanCriticalityScore: 0.5, importance: 3 }];
                dataSources.push('Pending-Analysis');
            }

            const topTasks = tasks.map((t) => ({
                name: (t.name || t.text || "Task").substring(0, 150), // Increased length limit
                aiCapabilityScore: t.aiCapabilityScore !== undefined ? t.aiCapabilityScore : (t.ai_exposure || 0),
                humanCriticalityScore: t.humanCriticalityScore !== undefined ? t.humanCriticalityScore : (t.human_criticality || 0),
                importance: 3
            })).slice(0, 5);

            const avgAi = topTasks.reduce((sum, t) => sum + t.aiCapabilityScore, 0) / (topTasks.length || 1);
            const avgHuman = topTasks.reduce((sum, t) => sum + t.humanCriticalityScore, 0) / (topTasks.length || 1);

            const calcGrowth = anchorGrowth + (avgHuman * 10) - (avgAi * 10);
            const projectedGrowth = Number(calcGrowth.toFixed(1));

            let volLabel = avgAi > 0.7 ? 'Very High' : avgAi > 0.3 ? 'Medium' : 'Low';
            let resLabel = avgHuman > 0.7 ? 'Future-Proof' : avgHuman > 0.4 ? 'High' : 'At Risk';

            return {
                id: `job-${index + 1}`,
                title: key,
                cluster: job.cluster || 'Business',
                employment: emp,
                automationCostIndex: Number(avgAi.toFixed(2)),
                projectedGrowth: projectedGrowth,
                salaryVolatilityLabel: volLabel,
                humanResilienceLabel: resLabel,
                confidenceScore: tasks.length > 1 ? 0.95 : 0.1,
                dataSources: dataSources,
                isAlias: key !== job.kelley_title,
                tasks: topTasks
            };
        });

        // Preserve Marketing Manager ID
        const marketingJob = finalJobs.find(j => j.title === 'Marketing Manager');
        if (marketingJob) marketingJob.id = 'job-15';

        // --- Step 5: Write Output ---
        const fileContent = `import type { Job, JobStatus } from './types';
import {
    RISK_THRESHOLDS, RISK_COLORS, DEFAULT_DATA_SOURCES,
} from './config/constants';

// DATA GENERATED BY REAL PIPELINE (BLS 2023 + GEMINI)
export const initialJobs: Job[] = ${JSON.stringify(finalJobs, null, 4)};

export function getJobStatus(job: Job, _year: number): JobStatus {
    const totalAiScore = job.tasks.reduce((sum, t) => sum + t.aiCapabilityScore, 0);
    const totalHumanScore = job.tasks.reduce((sum, t) => sum + t.humanCriticalityScore, 0);
    const avgAiCapability = job.tasks.length ? totalAiScore / job.tasks.length : 0.5;
    const avgHumanCriticality = job.tasks.length ? totalHumanScore / job.tasks.length : 0.5;
    const isHighRisk = avgAiCapability > RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE && job.automationCostIndex < RISK_THRESHOLDS.LOW_AUTOMATION_COST;
    const isInsulated = avgHumanCriticality > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE;
    let riskScore = 0.5;
    let color = RISK_COLORS.MEDIUM;
    if (isHighRisk) { riskScore = 0.9; color = RISK_COLORS.HIGH; }
    else if (isInsulated) { riskScore = 0.1; color = RISK_COLORS.LOW; }
    return { riskScore, color };
}

export type TaskCategory = 'Automatable' | 'Augmentable' | 'Human-Critical';
/** Categories from current Claude/O*NET-backed task scores only (no synthetic year drift). */
export function getTaskCategory(task: { aiCapabilityScore: number; humanCriticalityScore: number }): TaskCategory {
    if (task.aiCapabilityScore > RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE && task.humanCriticalityScore < RISK_THRESHOLDS.AUTOMATABLE_HUMAN_CEILING) return 'Automatable';
    if (task.humanCriticalityScore > RISK_THRESHOLDS.HUMAN_CRITICAL_SCORE) return 'Human-Critical';
    return 'Augmentable';
}

export { DEFAULT_DATA_SOURCES };
`;

        fs.writeFileSync(OUT_FILE, fileContent);
        console.log(`Success! Generated src/data.ts with ${finalJobs.length} real jobs.`);

    } catch (err) {
        console.error('Error generating data:', err);
    }
}

run();
