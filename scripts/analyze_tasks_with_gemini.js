import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// CONFIG
const DATA_DIR = path.join(__dirname, '../data');
const OUT_FILE = path.join(DATA_DIR, 'ai_impact_scores.json');
const KELLEY_MAP = path.join(DATA_DIR, 'Kelley_Job_Map.csv');
const TASK_STATEMENTS = path.join(DATA_DIR, 'db_30_1_text/Task Statements.txt');

// API KEY CHECK
const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

if (!API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY or VITE_GEMINI_API_KEY is missing in .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// --- MAIN EXECUTION ---
async function run() {
    console.log("🚀 Starting AI Task Analysis...");

    // 1. Get Target Jobs and SOC Codes
    const targetJobs = await loadTargetJobs();
    const targetSocCodes = new Set(targetJobs.map(j => j.socCode));
    console.log(`🎯 Found ${targetJobs.length} target jobs to analyze.`);

    // 2. Load Task Statements for these SOC Codes
    const jobTasks = await loadTaskStatements(targetSocCodes);
    console.log(`📝 Loaded detailed tasks for ${Object.keys(jobTasks).length} jobs with valid tasks.`);

    // 3. Analyze with Gemini
    let results = {};
    if (fs.existsSync(OUT_FILE)) {
        try {
            results = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
            console.log(`📂 Loaded existing results for ${Object.keys(results).length} jobs.`);
        } catch (e) {
            console.log('⚠️ Could not parse existing results, starting fresh.');
        }
    }

    // Process sequentially
    for (const [socCode, tasks] of Object.entries(jobTasks)) {
        const jobTitle = targetJobs.find(j => j.socCode === socCode)?.title || socCode;

        // Skip if we already have valid data
        if (results[socCode] && results[socCode].length > 0) {
            // console.log(`⏩ Skipping ${jobTitle} (already analyzed)`);
            continue;
        }

        console.log(`\n🤖 Analyzing tasks for: ${jobTitle} (${socCode})...`);

        if (tasks.length === 0) {
            console.log('SKIPPING: No tasks found.');
            results[socCode] = [];
            continue;
        }

        const analyzedTasks = await analyzeBatch(jobTitle, tasks);

        if (analyzedTasks.length > 0) {
            results[socCode] = analyzedTasks;
            // Save intermediate progress ONLY if success
            fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
        } else {
            console.log(`⚠️ Failed to analyze ${jobTitle}, skipping save for this item.`);
        }

        // Rate limit pause (5s)
        await new Promise(r => setTimeout(r, 60000));
    }

    console.log(`\n✅ Analysis Complete. Saved to ${OUT_FILE}`);
}

// --- HELPERS ---

async function loadTargetJobs() {
    const fileContent = fs.readFileSync(KELLEY_MAP, 'utf-8').trim();
    const uniqueJobs = new Map();

    // Split lines and handle potential BOM
    const lines = fileContent.replace(/^\uFEFF/, '').split('\n');

    // Skip header
    const startIdx = lines[0].includes('soc_code') ? 1 : 0;

    for (let i = startIdx; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('"') && line.endsWith('"')) {
            line = line.substring(1, line.length - 1);
        }

        const parts = line.split(',');
        if (parts.length >= 3) {
            const socCode = parts[0].trim();
            const onetCode = parts[1].trim();
            const title = parts[2].trim();

            if (title && !uniqueJobs.has(title)) {
                uniqueJobs.set(title, { title, socCode, onetCode });
            }
        }
    }
    return Array.from(uniqueJobs.values());
}

function loadTaskStatements(targetSocCodes) {
    return new Promise((resolve) => {
        const fileContent = fs.readFileSync(TASK_STATEMENTS, 'utf-8');
        const lines = fileContent.split('\n');

        const jobTasks = {};
        let matchCount = 0;

        // console.log('DEBUG: First 5 lines of Task Statements:', lines.slice(0, 5));

        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length < 3) return;

            const socCode = parts[0];
            const taskId = parts[1];
            const taskDesc = parts[2];

            const baseSoc = socCode.length > 7 ? socCode.substring(0, 7) : socCode;

            if (targetSocCodes.has(baseSoc) || targetSocCodes.has(socCode)) {
                const key = targetSocCodes.has(socCode) ? socCode : baseSoc;
                const targetKey = targetSocCodes.has(baseSoc) ? baseSoc : socCode; // Prefer what matched

                // We want to store under the KEY that matches what loadTargetJobs returns (e.g. 11-2021)
                // loadTargetJobs returns socCode as 11-2021.
                // So we want results keyed by 11-2021.
                // If socCode in file is 11-2021.00, baseSoc is 11-2021.
                // targetSocCodes has 11-2021.
                // So baseSoc matches.
                // We should use baseSoc as key.

                const finalKey = targetSocCodes.has(baseSoc) ? baseSoc : socCode;

                if (!jobTasks[finalKey]) jobTasks[finalKey] = [];
                jobTasks[finalKey].push({ id: taskId, text: taskDesc });
                matchCount++;
            }
        });
        console.log(`DEBUG: Matched ${matchCount} tasks across ${Object.keys(jobTasks).length} jobs.`);
        resolve(jobTasks);
    });
}

async function analyzeBatch(jobTitle, tasks) {
    const taskListString = tasks.map(t => `- ID ${t.id}: ${t.text}`).join('\n');

    const prompt = `
    You are an expert labor economist analyzing the impact of Generative AI and Automation on specific job tasks.
    
    JOB TITLE: ${jobTitle}
    
    For each task listed below, provide a JSON object with two scores (0.0 to 1.0):
    1. "ai_exposure": How feasible is it for current GenAI/LLMs to automate or significantly augment this task? (1.0 = Highly Automatable, 0.0 = Not Automatable).
    2. "human_criticality": How critical is human judgment, physical presence, client trust/empathy for this task? (1.0 = Strictly Human, 0.0 = AI can handle it).
    
    TASKS:
    ${taskListString}
    
    Output ONLY a valid JSON array of objects. Format:
    [
      { "id": "task_id_here", "ai_exposure": 0.8, "human_criticality": 0.2 },
      ...
    ]
    Do not include markdown formatting.
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);

    } catch (e) {
        console.error(`Error analyzing batch for ${jobTitle} (Status: ${e.response?.status || 'Unknown'}):`, e.message);
        return [];
    }
}

run();
