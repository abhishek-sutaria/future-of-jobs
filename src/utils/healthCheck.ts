/**
 * healthCheck.ts
 * --------------
 * Four high-level checks, each covering one clear category:
 *   1. AI         — is the AI service responding?
 *   2. Live Data  — is the live government data feed reachable?
 *   3. App Data   — did the app's built-in data load?
 *   4. Browser    — does the browser support what the app needs?
 *
 * Copy is plain-English. No jargon, no acronyms, no millisecond counts.
 */

import { initialJobs } from '../data';
import { BLS_API } from '../config/constants';

export type CheckStatus = 'pending' | 'pass' | 'fail' | 'warn';

export interface CheckResult {
    id: string;
    name: string;
    description: string;
    status: CheckStatus;
    message: string;
    detail?: string;
}

type CheckOutcome = Omit<CheckResult, 'id' | 'name' | 'description'>;

interface CheckRunner {
    id: string;
    name: string;
    description: string;
    run: () => Promise<CheckOutcome>;
}

const CLAUDE_PROXY = '/api/claude/messages';
const AI_MODE_KEY = 'foj_ai_mode';
const AI_USER_KEY = 'foj_user_claude_key';

// ── 1. AI ───────────────────────────────────────────────────────────────────
//    Pings the proxy and reports what came back. There is no separate
//    "is it configured?" state any more — see the note in checkAI.

async function checkAI(): Promise<CheckOutcome> {
    const mode = localStorage.getItem(AI_MODE_KEY);
    const userKey = (localStorage.getItem(AI_USER_KEY) || '').trim();
    const hasUserKey = mode === 'user' && !!userKey;

    // With a saved key, ping Claude on that key (the visitor's own spend). With
    // the app's key, ask the server what it has set up instead: a ping on the
    // server key would spend it on every status check, and the server refuses
    // any request that is not one of the app's own features (api/_lib/gateway).
    if (!hasUserKey) {
        try {
            const response = await fetch(CLAUDE_PROXY, { method: 'GET' });
            if (!response.ok) {
                return { status: 'fail', message: 'AI did not respond properly.', detail: 'Refresh the page and try again.' };
            }
            const s = (await response.json()) as { serverKey?: boolean; sharedAnswers?: boolean; missing?: string[] };
            if (!s.serverKey) {
                return {
                    status: 'fail',
                    message: 'The app’s built-in AI key is missing or expired.',
                    detail: 'This is a server-side setting, not something you can fix here — please report it.',
                };
            }
            if (!s.sharedAnswers) {
                return {
                    status: 'warn',
                    message: 'AI features are working, but answers are not being saved for other visitors.',
                    detail: `The server is missing ${(s.missing ?? []).filter((m) => m !== 'ANTHROPIC_API_KEY').join(' and ') || 'its Supabase settings'}, so every visitor gets a fresh answer.`,
                };
            }
            return { status: 'pass', message: 'AI features are working, and answers are saved and shared with every visitor.' };
        } catch {
            return {
                status: 'fail',
                message: 'We could not reach the AI service.',
                detail: 'Your internet may be off, or the AI service may be temporarily down.',
            };
        }
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-api-key': userKey,
        'x-foj-key-source': 'user',
        'x-foj-feature': 'ping',
    };

    try {
        const response = await fetch(CLAUDE_PROXY, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: 'claude-sonnet-5',
                max_tokens: 5,
                messages: [{ role: 'user', content: 'ping' }],
            }),
        });

        if (response.ok) {
            return { status: 'pass', message: 'AI features are working.' };
        }
        if (response.status === 401) {
            // Only re-score asks for a key, so a bad key is only the user's
            // problem to fix if they actually saved one there. Otherwise the
            // server's own key is missing or expired, which no student can
            // fix from the page — say so rather than sending them hunting.
            return hasUserKey
                ? {
                    status: 'fail',
                    message: 'The Claude API key you saved is no longer valid.',
                    detail: 'Re-enter it from the "Re-score all roles" dialog, or clear it to fall back to the app’s built-in key.',
                }
                : {
                    status: 'fail',
                    message: 'The app’s built-in AI key is missing or expired.',
                    detail: 'This is a server-side setting, not something you can fix here — please report it.',
                };
        }
        if (response.status === 429) {
            return {
                status: 'warn',
                message: 'AI is busy right now — too many recent requests.',
                detail: 'Wait a minute and try again.',
            };
        }
        return {
            status: 'fail',
            message: 'AI did not respond properly.',
            detail: 'Refresh the page and try again.',
        };
    } catch {
        return {
            status: 'fail',
            message: 'We could not reach the AI service.',
            detail: 'Your internet may be off, or the AI service may be temporarily down.',
        };
    }
}

// ── 2. Live Data ────────────────────────────────────────────────────────────

async function checkLiveData(): Promise<CheckOutcome> {
    try {
        const response = await fetch(`${BLS_API.PROXY_URL}/${BLS_API.UNEMPLOYMENT_SERIES_ID}`);
        if (!response.ok) {
            return {
                status: 'fail',
                message: 'Live national unemployment data is not loading right now.',
                detail: 'Try again in a few minutes. This check is only the US unemployment rate — not occupation employment by SOC code.',
            };
        }
        const json = await response.json();
        if (json.status === 'REQUEST_SUCCEEDED') {
            const series = json.Results?.series?.[0] || json.result?.series?.[0];
            const latest = series?.data?.[0];
            const detail = latest
                ? `US unemployment rate: ${latest.value}% (${latest.periodName} ${latest.year}). This is the national CPS rate only — not individual BLS job counts by occupation.`
                : 'Connected to BLS CPS unemployment feed.';
            return {
                status: 'pass',
                message: 'Live US unemployment rate from BLS loaded.',
                detail,
            };
        }
        return {
            status: 'warn',
            message: 'Live unemployment feed answered, but the response looked unusual.',
            detail: 'The unemployment chip in the header may be slightly out of date.',
        };
    } catch {
        return {
            status: 'fail',
            message: 'Could not reach the live unemployment feed.',
            detail: 'Your internet may be off, or the BLS data site may be temporarily down.',
        };
    }
}

// ── 3. App Data ─────────────────────────────────────────────────────────────
//    Combines: the job list + the US map data.

async function checkAppData(): Promise<CheckOutcome> {
    if (!Array.isArray(initialJobs) || initialJobs.length === 0) {
        return {
            status: 'fail',
            message: 'The list of jobs failed to load.',
            detail: 'Refresh the page. If it keeps happening, contact support.',
        };
    }

    try {
        const mod = await import('../data/geo_real.json');
        const data: Record<string, unknown> = (mod.default || mod) as Record<string, unknown>;
        if (Object.keys(data).length === 0) {
            return {
                status: 'fail',
                message: 'The US map data failed to load.',
                detail: 'The 3D view will still work, but the map view will be blank.',
            };
        }
    } catch {
        return {
            status: 'fail',
            message: 'The US map data failed to load.',
            detail: 'Refresh the page to try again.',
        };
    }

    return {
        status: 'pass',
        message: `All ${initialJobs.length} jobs and the US map data are ready.`,
        detail:
            'Both the 3D terrain (per-job employment) and the 2D US map (state-level employment) ' +
            'come from the bundled BLS OEWS May 2025 extract — separate from the live unemployment check above.',
    };
}

// ── 4. Browser ──────────────────────────────────────────────────────────────
//    Combines: 3D support + saved-settings support.

function checkBrowser(): CheckOutcome {
    let webglOK = false;
    try {
        const canvas = document.createElement('canvas');
        webglOK = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        webglOK = false;
    }

    let storageOK = false;
    try {
        const k = '__foj_health_probe__';
        localStorage.setItem(k, '1');
        storageOK = localStorage.getItem(k) === '1';
        localStorage.removeItem(k);
    } catch {
        storageOK = false;
    }

    if (!webglOK && !storageOK) {
        return {
            status: 'fail',
            message: 'Your browser is missing some features the app needs.',
            detail: 'It cannot show 3D, and it is blocking saved settings (you may be in Private mode). The app will still work but with limited features.',
        };
    }
    if (!webglOK) {
        return {
            status: 'warn',
            message: 'Your browser cannot show the 3D view.',
            detail: 'The app will fall back to a flat 2D map. For the full 3D experience, try Chrome, Firefox, Edge, or Safari.',
        };
    }
    if (!storageOK) {
        return {
            status: 'warn',
            message: 'Your browser is blocking saved settings.',
            detail: 'You may be in Private or Incognito mode. The app still works, but it will forget your preferences when you close the tab.',
        };
    }
    return {
        status: 'pass',
        message: 'Your browser supports everything the app needs.',
    };
}

// ── Registry & runner ───────────────────────────────────────────────────────

export const HEALTH_CHECKS: CheckRunner[] = [
    {
        id: 'ai',
        name: 'AI',
        description: 'Whether the AI features are turned on and responding.',
        run: checkAI,
    },
    {
        id: 'live-data',
        name: 'Live Unemployment',
        description: 'National US unemployment rate only (BLS CPS series LNS14000000). Not per-job or per-SOC employment.',
        run: checkLiveData,
    },
    {
        id: 'app-data',
        name: 'App Data',
        description: 'Bundled occupation employment and US map data (BLS OEWS May 2025) — separate from live unemployment.',
        run: checkAppData,
    },
    {
        id: 'browser',
        name: 'Browser',
        description: 'Whether your browser supports the 3D view and saved settings.',
        run: async () => checkBrowser(),
    },
];

export function makePendingResults(): CheckResult[] {
    return HEALTH_CHECKS.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        status: 'pending',
        message: 'Checking…',
    }));
}

export async function runAllChecks(
    onUpdate?: (results: CheckResult[]) => void
): Promise<CheckResult[]> {
    const results = makePendingResults();
    onUpdate?.(results);

    await Promise.all(
        HEALTH_CHECKS.map(async (c, idx) => {
            try {
                const outcome = await c.run();
                results[idx] = { ...results[idx], ...outcome };
            } catch {
                results[idx] = {
                    ...results[idx],
                    status: 'fail',
                    message: 'Something unexpected went wrong checking this.',
                    detail: 'Try running the check again. If it keeps failing, refresh the page.',
                };
            }
            onUpdate?.([...results]);
        })
    );

    return results;
}
