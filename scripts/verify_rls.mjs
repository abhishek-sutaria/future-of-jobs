#!/usr/bin/env node
/**
 * Two-user proof that Row Level Security actually isolates user activity in a
 * REAL Supabase project. Not run in CI — CI has no database. Run this once
 * against a live project after applying supabase/migrations/0001_user_activity.sql,
 * and again after any policy change.
 *
 * What the unit tests (src/__tests__/userData.test.ts) CANNOT prove: RLS is
 * enforced by Postgres, not by src/lib/userData.ts, so a mocked-client test
 * only proves the data layer *asks* the right questions — it cannot prove the
 * database actually refuses a cross-user request. This script is the missing
 * proof: it creates two real anonymous users against your project and asserts
 * neither can read or write the other's rows, using each user's own client
 * (never a service-role key).
 *
 * Usage:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/verify_rls.mjs
 *
 * Requires "Allow anonymous sign-ins" enabled in Supabase Auth settings.
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !ANON_KEY) {
    console.error(
        '\nMissing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.\n' +
        'Usage: VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/verify_rls.mjs\n'
    );
    process.exit(1);
}

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
    if (ok) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); passed++; }
    else { console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function newAnonUser() {
    const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInAnonymously();
    if (error) {
        throw new Error(
            `Anonymous sign-in failed: ${error.message}\n` +
            'Enable "Allow anonymous sign-ins" in Supabase → Authentication → Settings.'
        );
    }
    return { client, userId: data.user.id };
}

async function main() {
    console.log('\nRLS two-user verification against', URL, '\n');

    console.log('Creating two independent anonymous users...');
    const a = await newAnonUser();
    const b = await newAnonUser();
    check('two distinct user ids were created', a.userId !== b.userId, `${a.userId} vs ${b.userId}`);

    // ── User A writes one row into every table ──
    console.log('\nUser A writing one row into each table...');
    const jobId = `verify-rls-${Date.now()}`;
    const writes = await Promise.all([
        a.client.from('saved_roles').insert({ user_id: a.userId, job_id: jobId, job_title: 'RLS Test Role' }),
        a.client.from('job_views').insert({ user_id: a.userId, job_id: jobId, job_title: 'RLS Test Role' }),
        a.client.from('upskill_completions').insert({ user_id: a.userId, job_id: jobId, task_name: 'RLS test task' }),
        a.client.from('generated_artifacts').insert({
            user_id: a.userId, kind: 'scenario', cache_key: jobId, job_id: jobId, payload: { secret: 'user-A-only' },
        }),
    ]);
    for (const [i, table] of ['saved_roles', 'job_views', 'upskill_completions', 'generated_artifacts'].entries()) {
        check(`user A can insert into ${table}`, !writes[i].error, writes[i].error?.message);
    }

    // ── User A can read it back ──
    console.log('\nUser A reading their own rows...');
    const { data: ownRows, error: ownErr } = await a.client
        .from('saved_roles').select('*').eq('user_id', a.userId).eq('job_id', jobId);
    check('user A can read their own saved_roles row', !ownErr && ownRows?.length === 1, ownErr?.message);

    // ── User B cannot see user A's rows, even filtering explicitly by A's id ──
    console.log('\nUser B attempting to read user A\'s rows (should see nothing)...');
    for (const table of ['saved_roles', 'job_views', 'upskill_completions', 'generated_artifacts']) {
        const { data, error } = await b.client.from(table).select('*').eq('user_id', a.userId);
        // RLS makes this return an EMPTY result, not an error — the row is
        // invisible, not access-denied. Both `error` absent and `data` empty
        // together are the correct, secure outcome.
        check(`user B sees zero rows in ${table} when querying user A's user_id`, !error && (data?.length ?? 0) === 0, error?.message);
    }

    // ── User B cannot write a row claiming to be user A ──
    console.log('\nUser B attempting to insert a row AS user A (should be rejected)...');
    const { error: spoofErr } = await b.client
        .from('saved_roles')
        .insert({ user_id: a.userId, job_id: `${jobId}-spoof`, job_title: 'Spoofed row' });
    check('user B cannot insert a row with user_id = user A', !!spoofErr, spoofErr ? '' : 'insert unexpectedly succeeded');

    // ── User B cannot update or delete user A's row ──
    console.log('\nUser B attempting to modify user A\'s row (should affect zero rows)...');
    const { data: updateResult } = await b.client
        .from('saved_roles').update({ job_title: 'Hijacked' }).eq('user_id', a.userId).eq('job_id', jobId).select();
    check('user B\'s update touches zero of user A\'s rows', (updateResult?.length ?? 0) === 0);

    const { data: deleteResult } = await b.client
        .from('saved_roles').delete().eq('user_id', a.userId).eq('job_id', jobId).select();
    check('user B\'s delete touches zero of user A\'s rows', (deleteResult?.length ?? 0) === 0);

    // Confirm the row really is still there and unmodified, from A's own view.
    const { data: stillThere } = await a.client
        .from('saved_roles').select('job_title').eq('user_id', a.userId).eq('job_id', jobId).maybeSingle();
    check('user A\'s row survived user B\'s attempts, unmodified', stillThere?.job_title === 'RLS Test Role');

    // ── delete_my_data only ever deletes the caller's own rows ──
    console.log('\nUser B calling delete_my_data() should not touch user A\'s data...');
    await b.client.rpc('delete_my_data');
    const { data: afterBDelete } = await a.client
        .from('saved_roles').select('job_title').eq('user_id', a.userId).eq('job_id', jobId).maybeSingle();
    check('user A\'s row survives user B\'s delete_my_data()', afterBDelete?.job_title === 'RLS Test Role');

    // ── Cleanup: user A deletes their own test rows ──
    console.log('\nCleaning up (user A deletes their own test rows)...');
    await a.client.rpc('delete_my_data');
    const { data: afterOwnDelete } = await a.client
        .from('saved_roles').select('*').eq('user_id', a.userId).eq('job_id', jobId);
    check('user A\'s delete_my_data() removed their own test row', (afterOwnDelete?.length ?? 0) === 0);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`RLS VERIFICATION: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('\x1b[31mFAILED — isolation is not fully enforced. Do not ship until this is 0 failures.\x1b[0m\n');
        process.exit(1);
    }
    console.log('\x1b[32mAll isolation checks passed.\x1b[0m\n');
}

main().catch((err) => {
    console.error('\nverify_rls failed to run:', err.message, '\n');
    process.exit(1);
});
