
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const DATA_DIR = path.join(__dirname, '../data');
const SRC_DATA_DIR = path.join(__dirname, '../src/data');

const KELLEY_MAP_PATH = path.join(DATA_DIR, 'Kelley_Job_Map.csv');
const GEO_REAL_PATH = path.join(SRC_DATA_DIR, 'geo_real.json');
const AI_SCORES_PATH = path.join(DATA_DIR, 'ai_impact_scores.json');
const XLSX_PATH = fs.existsSync(path.join(DATA_DIR, 'all_data_M_2024.xlsx'))
    ? path.join(DATA_DIR, 'all_data_M_2024.xlsx')
    : path.join(DATA_DIR, 'all_data_M_2023.xlsx');

function loadKelleyMap() {
    const content = fs.readFileSync(KELLEY_MAP_PATH, 'utf-8');
    const lines = content.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim().length > 0);
    const jobs = [];
    // Skip header 1
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 3) continue;
        const soc = parts[0].replace(/"/g, '').trim();
        const title = parts[2].replace(/"/g, '').trim();
        jobs.push({ soc, title });
    }
    return jobs;
}

async function checkCoherence() {
    console.log("🔍 Starting Data Coherence Audit (Optimized Stream)...\n");

    const jobs = loadKelleyMap();
    console.log(`Loaded ${jobs.length} Reference Jobs from Kelley_Job_Map.csv`);

    // Load Geo Data
    let geoData = {};
    try {
        geoData = JSON.parse(fs.readFileSync(GEO_REAL_PATH, 'utf-8'));
    } catch (e) { console.error("Failed to load geo_real.json"); }

    // Load AI Scores
    let aiData = {};
    try {
        aiData = JSON.parse(fs.readFileSync(AI_SCORES_PATH, 'utf-8'));
    } catch (e) { console.error("Failed to load ai_impact_scores.json"); }

    // Stream XLSX
    const xlsxSocs = new Set();
    console.log(`Checking XLSX Path: ${XLSX_PATH}`);
    try {
        if (fs.existsSync(XLSX_PATH)) {
            console.log(`Streaming large file...`);
            const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(XLSX_PATH, {});
            for await (const worksheetReader of workbookReader) {
                for await (const row of worksheetReader) {
                    // Check purely for SOC codes in any cell
                    // SOC codes look like "11-2021"
                    if (row.values && Array.isArray(row.values)) {
                        row.values.forEach(val => {
                            if (typeof val === 'string' && /^\d{2}-\d{4}/.test(val)) {
                                xlsxSocs.add(val);
                            }
                        });
                    }
                }
            }
            console.log(`Loaded XLSX with ${xlsxSocs.size} SOC codes`);
        } else {
            console.error("XLSX File Not Found at expected path.");
        }
    } catch (e) { console.error("Failed to stream XLSX:", e.message); }

    console.log("\n--- COHERENCE MATRIX ---");
    console.log("| SOC Code | Job Title | Geo Data | AI Scores | XLSX Data |");
    console.log("|---|---|---|---|---|");

    const issues = [];
    jobs.forEach(job => {
        const hasGeo = geoData.hasOwnProperty(job.soc);
        const hasAI = aiData.hasOwnProperty(job.soc);
        const hasXLSX = xlsxSocs.has(job.soc);

        console.log(`| ${job.soc} | ${job.title} | ${hasGeo ? "✅" : "❌"} | ${hasAI ? "✅" : "❌"} | ${hasXLSX ? "✅" : "❌"} |`);

        if (!hasGeo) issues.push(`Missing Geo for ${job.title}`);
        if (!hasXLSX) issues.push(`Missing XLSX for ${job.title}`);
    });

    if (issues.length === 0) console.log("\n✅ ALL SYSTEMS GREEN");
    else console.warn(`\n⚠️ ${issues.length} ISSUES FOUND`);
}

checkCoherence();
