/**
 * bakedScores.ts
 * --------------
 * Precomputed Claude scores are committed to src/data/ai_scores.json by
 * `npm run generate-scores` and imported statically here, so a cold page load
 * has scores available before first paint with ZERO API calls.
 *
 * Previously the app scored all 50 roles live at startup behind a blocking
 * overlay (~4-5 min on a browser with no localStorage cache).
 */

import bakedScoresJson from '../data/ai_scores.json';
import { CACHE_VERSION, loadScoreCacheWithMeta, type JobAnalysisResult } from './taskScoring';

export type ScoresSource = 'baked' | 'cache' | 'none';

export interface ResolvedScores {
    scores: Record<string, JobAnalysisResult>;
    source: ScoresSource;
    /** epoch ms the scores were produced (build time for baked, refresh time for cache) */
    generatedAt: number | null;
}

interface BakedScoresFile {
    version?: number;
    model?: string;
    generatedAt?: string;
    scores?: Record<string, JobAnalysisResult>;
}

const EMPTY: ResolvedScores = { scores: {}, source: 'none', generatedAt: null };

/** Baked scores, or null when the file is missing/empty or its schema is stale. */
export function getBakedScores(): ResolvedScores | null {
    const file = bakedScoresJson as BakedScoresFile;

    if (file?.version !== CACHE_VERSION) {
        console.warn(
            `[Scores] Precomputed file is schema v${file?.version} but the app expects v${CACHE_VERSION} — ignoring it. Run \`npm run generate-scores\`.`,
        );
        return null;
    }

    const scores = file.scores ?? {};
    if (Object.keys(scores).length === 0) return null;

    const generatedAt = file.generatedAt ? Date.parse(file.generatedAt) : NaN;
    return {
        scores,
        source: 'baked',
        generatedAt: Number.isFinite(generatedAt) ? generatedAt : null,
    };
}

/**
 * Scores to seed the store with, choosing whichever source is newer:
 *   · localStorage cache — the user hit "re-score" at some point
 *   · baked JSON         — shipped with the current build
 *
 * Newest-wins means a fresh deploy supersedes an old cache, while a user who
 * just refreshed keeps their newer numbers.
 */
export function resolveInitialScores(): ResolvedScores {
    const baked = getBakedScores();

    let cached: ResolvedScores | null = null;
    try {
        const hit = loadScoreCacheWithMeta(); // handles version + TTL checks
        if (hit && Object.keys(hit.data).length > 0) {
            cached = { scores: hit.data, source: 'cache', generatedAt: hit.timestamp };
        }
    } catch {
        // localStorage unavailable (private mode) — baked scores still work.
    }

    if (baked && cached) {
        // Missing timestamps sort oldest so a dated source always wins.
        return (cached.generatedAt ?? 0) >= (baked.generatedAt ?? 0) ? cached : baked;
    }
    return cached ?? baked ?? EMPTY;
}
