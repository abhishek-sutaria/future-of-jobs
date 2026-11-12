/**
 * Vercel function for /api/claude/messages. All the rules live in
 * api/_lib/gateway.ts (the dev server mounts the same handler), so this file
 * only wires in the real fetch and process.env.
 *
 * Env: ANTHROPIC_API_KEY (server key), SUPABASE_SERVICE_ROLE_KEY and
 * SUPABASE_URL or VITE_SUPABASE_URL (saved shared answers + rate-limit
 * counts), optional FOJ_RATE_PER_HOUR / FOJ_RATE_PER_DAY / FOJ_RATE_GLOBAL_PER_DAY.
 */

import { createClaudeHandler } from './_lib/gateway.js';

export default createClaudeHandler({
    fetch: (input, init) => fetch(input, init),
    env: () => process.env,
});
