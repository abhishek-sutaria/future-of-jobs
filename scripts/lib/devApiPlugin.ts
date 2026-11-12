/**
 * `npm run dev` only: serves /api/claude/messages with the SAME handler the
 * Vercel function uses (api/_lib/gateway.ts), so local runs follow the same
 * rules (feature table, saved answers, rate limit) as production. The handler
 * calls api.anthropic.com with ANTHROPIC_API_KEY from .env, exactly as on Vercel.
 *
 * FOJ_MOCK_CLAUDE=1 swaps Claude and Supabase for the in-memory mock
 * (scripts/lib/mockAiBackend.ts): no real Claude call, no key needed. Mock
 * mode also serves GET /__mock/claude-calls (what Claude was asked) and
 * POST /__mock/reset, for checking in a browser that a saved answer made no
 * second call.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createClaudeHandler, type ApiRequest, type ApiResponse } from '../../api/_lib/gateway';
import type { ServerEnv } from '../../api/_lib/supabaseRest';
import { createMockBackend, MOCK_SUPABASE_URL } from './mockAiBackend';

export const MOCK_ENV: ServerEnv = {
    ANTHROPIC_API_KEY: 'mock-server-key',
    SUPABASE_URL: MOCK_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
};

async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { return raw; }
}

function adapt(res: ServerResponse): ApiResponse {
    const api: ApiResponse = {
        status(code) { res.statusCode = code; return api; },
        setHeader(name, value) { res.setHeader(name, value); },
        json(body) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); },
        send(body) { res.end(body); },
        write(chunk) { res.write(chunk); },
        end() { res.end(); },
    };
    return api;
}

export function devApiPlugin(env: Record<string, string>): Plugin {
    const mock = env.FOJ_MOCK_CLAUDE === '1' ? createMockBackend() : null;
    const handler = createClaudeHandler({
        fetch: mock ? mock.fetch : (input, init) => fetch(input, init),
        env: () => (mock ? { ...env, ...MOCK_ENV } : env),
    });

    return {
        name: 'foj-dev-api',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = req.url ?? '';
                if (mock && url.startsWith('/__mock/')) {
                    if (url.startsWith('/__mock/reset') && req.method === 'POST') mock.reset();
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ calls: mock.calls, savedAnswers: mock.answers.size }));
                    return;
                }
                if (!url.startsWith('/api/claude/messages')) return next();
                try {
                    const apiReq: ApiRequest = { method: req.method, headers: req.headers, body: await readBody(req), socket: req.socket };
                    await handler(apiReq, adapt(res));
                } catch (err) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: { type: 'foj_upstream', message: err instanceof Error ? err.message : 'dev api error' } }));
                }
            });
        },
    };
}
