/**
 * healthCheck.ts
 * --------------
 * Four high-level checks, each covering one clear category:
 *   1. AI         — is AI set up AND responding?
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
//    Combines: is AI configured + is the AI service responding.

async function checkAI(): Promise<CheckOutcome> {
    const mode = localStorage.getItem(AI_MODE_KEY);
    const userKey = (localStorage.getItem(AI_USER_KEY) || '').trim();
    const isConfigured = (mode === 'user' && !!userKey) || mode === 'default';

    if (!isConfigured) {
        return {
            status: 'warn',
            message: 'AI features have not been turned on yet.',
            detail: 'Click the "Claude API" button at the top of the page to set up AI.',
        };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (mode === 'user' && userKey) {
        headers['x-user-api-key'] = userKey;
        headers['x-foj-key-source'] = 'user';
    }

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
            return { status: 'pass', message: 'AI features are set up and responding.' };
        }
        if (response.status === 401) {
            return {
                status: 'fail',
                message: 'The AI key is missing or no longer valid.',
                detail: 'Click the "Claude API" button at the top of the page to fix it.',
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
            message: 'AI is set up but did not respond properly.',
            detail: 'Refresh the page and try again.',
        };
    } catch {
        return {
            status: 'fail',
            message: 'AI is set up, but we could not reach it.',
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
        detail: 'Occupation employment on the 3D map comes from the bundled BLS OES May 2023 extract — separate from the live unemployment check above.',
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
        description: 'Whether the live US unemployment rate (BLS CPS) is loading — not occupation employment by job/SOC.',
        run: checkLiveData,
    },
    {
        id: 'app-data',
        name: 'App Data',
        description: "Whether the app's built-in job and map data are loaded.",
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
