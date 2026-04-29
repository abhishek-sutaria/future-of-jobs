import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();
const apiKey = process.env.ANTHROPIC_API_KEY;

const jobs = [
  { title: "Marketing Manager", tasks: ["Formulate, direct and coordinate marketing activities", "Identify, develop, or evaluate marketing strategy", "Compile lists describing product or service offerings"] },
  { title: "Software Developer", tasks: ["Modify existing software to correct errors", "Develop and direct software system testing", "Analyze user needs and software requirements"] },
  { title: "Registered Nurse", tasks: ["Maintain accurate, detailed reports and records", "Administer medications to patients", "Monitor, record and report symptoms"] },
  { title: "Financial Analyst", tasks: ["Assemble spreadsheets and draw charts and graphs", "Analyze financial data and extract patterns", "Evaluate financial risks"] },
  { title: "Data Entry Keyer", tasks: ["Enter data into computer systems", "Verify accuracy of data", "Resolve garbled or indecipherable messages"] },
  { title: "Truck Driver", tasks: ["Drive truck to transport materials", "Inspect vehicles for mechanical items", "Maintain log of working hours"] },
  { title: "Graphic Designer", tasks: ["Create designs, concepts, and sample layouts", "Determine size and arrangement of illustrative material", "Review final layouts"] },
  { title: "Human Resources Specialist", tasks: ["Prepare or maintain employment records", "Inform job applicants of details", "Hire employees and process hiring-related paperwork"] },
  { title: "Cashier", tasks: ["Receive payment by cash, check, credit cards", "Issue receipts, refunds, credits", "Count money in cash drawers"] },
  { title: "Lawyer", tasks: ["Advise clients concerning business transactions", "Interpret laws, rulings and regulations", "Analyze the probable outcomes of cases"] }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callClaude(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${await response.text()}`);
  }
  
  const data = await response.json();
  const text = data.content[0].text;
  
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const objectStart = cleaned.indexOf('{');
  return JSON.parse(cleaned.slice(objectStart));
}

async function run() {
  const scores = [];
  
  for (const job of jobs) {
    console.log(`Analyzing ${job.title}...`);
    const prompt = `You are an expert labor economist...

Job Title: "${job.title}"

Tasks:
${job.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Analyze the automation potential of this role. Consider:
1. Routine vs. Non-Routine tasks.
2. Cognitive vs. Manual tasks.
3. Need for human empathy, ethics, or physical presence.

    Return a JSON object with:
    {
      "strategic_insight": "A short strategic summary of the job's future.",
      "tasks": [
        { "task_name": "string", "ai_exposure_score": number (0.0 to 1.0), "human_criticality_score": number (0.0 to 1.0), "reasoning": "string" }
      ],
      "yearlyForecast": [
        { "year": 2026, "growthImpact": number, "reasoning": "string" }
      ],
      "likely_replacements": ["string", "string"],
      "human_centric_traits": ["string", "string"],
      "human_resilience_label": "Low" | "Medium" | "High" | "Critical",
      "salary_volatility_label": "Low" | "Medium" | "High",
      "salary_forecast": [number, number, number, number, number, number]
    }

    CRITICAL: 
    - Provide precise, granular two-decimal scores (e.g., 0.73, 0.41, 0.88). DO NOT round to the nearest tenth or quarter.
    - If the role's tasks have high automation exposure, the salary forecast should show VOLATILITY (ups and downs) or DECLINE.
    - If the role's tasks have high human criticality, the salary should remain STABLE or GROW.

Return ONLY valid JSON.`;

    try {
      const result = await callClaude(prompt);
      if (result.tasks) {
        result.tasks.forEach(t => {
          scores.push(Number(t.ai_exposure_score));
          scores.push(Number(t.human_criticality_score));
        });
      }
      await sleep(1000);
    } catch (e) {
      console.error(e);
    }
  }

  const validScores = scores.filter(s => !isNaN(s));
  const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const sorted = [...validScores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = validScores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / validScores.length;
  const stddev = Math.sqrt(variance);

  const anchors = [0.75, 0.35, 0.50, 0.70, 0.30, 0.60];
  let anchorMatches = 0;
  validScores.forEach(s => {
    if (anchors.some(a => Math.abs(s - a) <= 0.02)) {
      anchorMatches++;
    }
  });

  const anchorPercent = (anchorMatches / validScores.length) * 100;

  console.log('\\n--- RESULTS ---');
  console.log(`Total Scores: ${validScores.length}`);
  console.log(`Mean: ${mean.toFixed(3)}`);
  console.log(`Median: ${median.toFixed(3)}`);
  console.log(`StdDev: ${stddev.toFixed(3)}`);
  console.log(`% within ±0.02 of anchors (0.75, 0.35, 0.50, 0.70, 0.30, 0.60): ${anchorPercent.toFixed(1)}%`);

  const buckets = new Array(10).fill(0);
  validScores.forEach(s => {
    const b = Math.min(9, Math.floor(s * 10));
    buckets[b]++;
  });

  console.log('\\nHistogram (0-1):');
  buckets.forEach((count, i) => {
    const range = `${(i/10).toFixed(1)}-${((i+1)/10).toFixed(1)}`;
    console.log(`${range}: ${'*'.repeat(count)} (${count})`);
  });
  
  console.log('\\nRaw Scores:');
  console.log(validScores.join(', '));
}

run();
