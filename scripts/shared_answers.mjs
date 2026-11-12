#!/usr/bin/env node
/**
 * Owner tool for the saved shared AI answers (Supabase table
 * ai_shared_answers, see supabase/migrations/0003_shared_ai_answers.sql).
 * Deleting an answer makes the next visitor's click generate a fresh one,
 * which is then saved for everyone again. There is no public delete
 * endpoint: this runs on your own machine with the service key.
 *
 *   node scripts/shared_answers.mjs list   --role soc:29-1141 [--feature roadmap]
 *   node scripts/shared_answers.mjs delete --role soc:29-1141 --feature roadmap          (dry run: shows what would go)
 *   node scripts/shared_answers.mjs delete --role soc:29-1141 --feature roadmap --yes    (deletes)
 *
 * --role is the role key: a Kelley role's id ("job-15", shown in the address
 * of a saved role) or "soc:" plus the BLS code shown on the role panel.
 * --feature is analyze (Strategic Insight), scenario, roadmap or upskill
 * (Defend / Build). Without --feature, delete removes every answer for the role.
 *
 * Reads SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * from the environment or from .env.local / .env in the repo. Never prints
 * the key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEATURES = ['analyze', 'scenario', 'roadmap', 'upskill'];

function loadDotEnv() {
    for (const name of ['.env.local', '.env']) {
        const file = path.join(ROOT, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
    }
}

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
}

loadDotEnv();
const command = process.argv[2];
const role = arg('role');
const feature = arg('feature');
const yes = process.argv.includes('--yes');

if (!['list', 'delete'].includes(command)) fail('Usage: node scripts/shared_answers.mjs list|delete --role <key> [--feature <name>] [--yes]');
if (!role || !/^(job-\d{1,3}|soc:\d\d-\d{4})$/.test(role)) fail('--role must be a role key like job-15 or soc:29-1141');
if (feature && !FEATURES.includes(feature)) fail(`--feature must be one of: ${FEATURES.join(', ')}`);

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const missing = [!url && 'SUPABASE_URL (or VITE_SUPABASE_URL)', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
if (missing.length) fail(`Missing ${missing.join(' and ')}. Add it to .env.local (never commit it) or export it in this shell.`);

const headers = { apikey: key, 'content-type': 'application/json' };
if (!key.startsWith('sb_')) headers.authorization = `Bearer ${key}`;

const filter = `role_key=eq.${encodeURIComponent(role)}${feature ? `&feature=eq.${feature}` : ''}`;
const base = `${url}/rest/v1/ai_shared_answers`;

const listRes = await fetch(`${base}?select=role_key,feature,prompt_version,input_hash,model,created_at&${filter}&order=feature,created_at`, { headers });
if (!listRes.ok) fail(`Could not read saved answers (HTTP ${listRes.status}). Is migration 0003 applied?`);
const rows = await listRes.json();

if (rows.length === 0) {
    console.log(`No saved answers for ${role}${feature ? ` / ${feature}` : ''}.`);
    process.exit(0);
}
for (const r of rows) {
    console.log(`${r.role_key}  ${r.feature.padEnd(8)}  ${r.prompt_version.padEnd(12)}  ${r.input_hash.slice(0, 12)}…  ${r.model}  saved ${r.created_at}`);
}

if (command === 'list') process.exit(0);

if (!yes) {
    console.log(`\nDry run: ${rows.length} answer(s) above would be deleted. Add --yes to delete them.`);
    process.exit(0);
}

const delRes = await fetch(`${base}?${filter}`, { method: 'DELETE', headers: { ...headers, prefer: 'return=representation' } });
if (!delRes.ok) fail(`Delete failed (HTTP ${delRes.status}).`);
const deleted = await delRes.json();
console.log(`\nDeleted ${deleted.length} saved answer(s). The next visitor who opens it gets a fresh answer, which is saved again.`);
