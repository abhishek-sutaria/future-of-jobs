import { BLS_API } from '../config/constants';


import { z } from 'zod';

export const BLSDataPointSchema = z.object({
    year: z.string(),
    period: z.string().regex(/^M\d{2}$/, "Period must match Mxx format"),
    periodName: z.string().optional(),
    // BLS uses placeholders like "-" for months without data — tolerated here,
    // skipped at extraction time (rejecting them used to fail the whole batch).
    value: z.string()
});

export const BLSSeriesSchema = z.object({
    seriesID: z.string(),
    data: z.array(BLSDataPointSchema).nonempty("Data array cannot be empty")
});

export const BLSResponseSchema = z.object({
    status: z.string(),
    responseTime: z.number().optional(),
    message: z.array(z.string()).optional(),
    Results: z.object({
        series: z.array(BLSSeriesSchema)
    })
}).passthrough();

export type BLSResponse = z.infer<typeof BLSResponseSchema>;

const BLS_CACHE_KEY = 'foj_bls_cache_v1';
const BLS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // BLS daily quota resets at midnight ET

interface BlsCacheShape {
    fetchedAt: number;
    values: Record<string, number>;
}

export interface LaborStatsResult {
    values: Map<string, number>;
    source: 'live' | 'cache';
    /** Epoch ms of the fetch that produced these values */
    fetchedAt: number;
}

function readBlsCache(): BlsCacheShape | null {
    try {
        const raw = localStorage.getItem(BLS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.fetchedAt !== 'number' || typeof parsed?.values !== 'object' || !parsed.values) {
            return null;
        }
        return parsed as BlsCacheShape;
    } catch {
        return null;
    }
}

function writeBlsCache(values: Map<string, number>): number {
    const fetchedAt = Date.now();
    try {
        const record: BlsCacheShape = { fetchedAt, values: Object.fromEntries(values) };
        localStorage.setItem(BLS_CACHE_KEY, JSON.stringify(record));
    } catch {
        // Storage full/unavailable — caching is best-effort
    }
    return fetchedAt;
}

function cacheToResult(cache: BlsCacheShape): LaborStatsResult {
    return {
        values: new Map(Object.entries(cache.values)),
        source: 'cache',
        fetchedAt: cache.fetchedAt,
    };
}

export async function fetchLaborStats(seriesIds: string[]): Promise<LaborStatsResult> {
    const apiKey = import.meta.env.VITE_BLS_API_KEY;

    // This only reflects the CLIENT bundle's own env var, which the client
    // never actually needs: the /api/bls proxy applies its own server-side
    // VITE_BLS_API_KEY independently (see api/bls.ts), so a missing key here
    // says nothing about production. It previously warned unconditionally,
    // which fired misleadingly on every production page load even when the
    // server key was correctly configured. Gate it to local dev, where it's
    // still a useful hint if .env has no key and requests hit BLS unregistered.
    if (!apiKey && import.meta.env.DEV) {
        console.warn('VITE_BLS_API_KEY not set locally — dev server will call BLS unregistered (25 req/day cap). Add it to .env if you hit rate limits.');
    }

    // Fresh cache covering every requested series → no network call at all
    const cache = readBlsCache();
    if (
        cache &&
        Date.now() - cache.fetchedAt < BLS_CACHE_TTL_MS &&
        seriesIds.every((id) => id in cache.values)
    ) {
        return cacheToResult(cache);
    }

    try {
        const response = await fetch(BLS_API.PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                seriesid: seriesIds,
                startyear: BLS_API.START_YEAR,
                endyear: BLS_API.END_YEAR,
                registrationkey: apiKey,
            }),
        });

        if (!response.ok) {
            throw new Error(`BLS API Error: ${response.statusText}`);
        }

        const rawJson = await response.json();
        const json: BLSResponse = BLSResponseSchema.parse(rawJson);

        if (json.status !== 'REQUEST_SUCCEEDED') {
            console.error('BLS API Messages:', json.message);
            throw new Error('BLS API Request Failed');
        }

        const results = new Map<string, number>();
        json.Results.series.forEach(series => {
            // data is newest-first; take the most recent month with a real value
            const firstNumeric = series.data.find(d => !isNaN(parseFloat(d.value)));
            if (firstNumeric) {
                results.set(series.seriesID, parseFloat(firstNumeric.value));
            }
        });

        const fetchedAt = writeBlsCache(results);
        return { values: results, source: 'live', fetchedAt };
    } catch (error) {
        // Live fetch failed (rate limit, network, malformed payload) — fall back
        // to the cache at any age rather than losing real data entirely.
        if (cache) {
            console.warn('BLS live fetch failed; using cached data from', new Date(cache.fetchedAt).toISOString());
            return cacheToResult(cache);
        }
        console.error('Failed to fetch BLS data:', error);
        throw error;
    }
}

// Map of Job Titles to BLS CPS Series IDs
// These are broad occupation-category series from CPS (Current Population Survey).
// For exact per-occupation data, OES series IDs vary by SOC code and area.
const MAP_TITLE_TO_SERIES: Record<string, string> = {
    // Management Occupations (LNU02032202)
    "Marketing Manager": "LNU02032202",
    "Financial Manager": "LNU02032202",
    "Sales Manager": "LNU02032202",
    "Supply Chain Manager": "LNU02032202",

    // Business & Financial Ops (LNU02032203)
    "Market Research Analyst": "LNU02032203",
    "Financial Analyst": "LNU02032203",
    "Management Consultant": "LNU02032203",
    "Logistics Analyst": "LNU02032203",
    "Accountant & Auditor": "LNU02032203",

    // Computer & Mathematical (LNU02032209)
    "Software Developer": "LNU02032209",
    "Business Intelligence Analyst": "LNU02032209",
    "Operations Research Analyst": "LNU02032209",

    // Sales & Office (LNU02032212)
    "Securities & Sales Agent": "LNU02032212"
};

export function getSeriesIdForJob(title: string, _datatype: '01' | '03' = '01'): string | null {
    return MAP_TITLE_TO_SERIES[title] || null;
}

export function getSeriesLabel(seriesId: string | null): string | null {
    if (!seriesId) return null;
    const base = seriesId.substring(0, 11);
    switch (base) {
        case 'LNU02032202': return 'Management occupations — broad category trend (CPS)';
        case 'LNU02032203': return 'Business & Financial Ops — broad category trend (CPS)';
        case 'LNU02032209': return 'Computer & Mathematical — broad category trend (CPS)';
        case 'LNU02032212': return 'Sales & Office — broad category trend (CPS)';
        default: return null;
    }
}
