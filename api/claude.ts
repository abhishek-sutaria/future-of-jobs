/**
 * Vercel function for /api/claude/messages. All the rules live in
 * api/_lib/gateway.ts (the dev server mounts the same handler), so this file
 * only wires in the real fetch and process.env.
 *
 * Env: ANTHROPIC_API_KEY (server key), SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (the server-only Supabase project: saved shared
 * answers + rate-limit counts, docs/shared-answers-setup.md), optional
 * FOJ_RATE_PER_HOUR / FOJ_RATE_PER_DAY / FOJ_RATE_GLOBAL_PER_DAY and
 * FOJ_SHARED_MAX_AGE_DAYS.
 */

import { createClaudeHandler } from './_lib/gateway.js';

export default createClaudeHandler({
    fetch: (input, init) => fetch(input, init),
    env: () => process.env,
});
