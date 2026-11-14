/**
 * bakedScores.ts
 * --------------
 * The Kelley titles' FIRST published scores (src/data/ai_scores.json, Aug
 * 2026), for the titles whose SOC has no entry in ai_scores_bls.json yet.
 * The build serves only those entries (virtual:kelley-legacy-scores, see
 * scripts/lib/blsScoresPlugin.ts), so once `--batch kelley` has scored every
 * Kelley SOC this holds nothing and ai_scores.json is history only: every
 * Kelley title then reads its tasks and scores from ai_scores_bls.json by its
 * SOC (utils/kelleyScores). Applied at startup with zero API calls.
 *
 * The user's own opt-in re-score (localStorage) still layers on top, newest
 * first, as before.
 */

import bakedScoresJson from 'virtual:kelley-legacy-scores';
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

/** Date of ai_scores.json while some Kelley title still uses it; null once none does. */
export const LEGACY_SCORES_DATE: string | null =
    Object.keys((bakedScoresJson as BakedScoresFile)?.scores ?? {}).length > 0 ? (bakedScoresJson as BakedScoresFile).generatedAt ?? null : null;

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
        const cacheIsNewer = (cached.generatedAt ?? 0) >= (baked.generatedAt ?? 0);

        // Layer the fresher source *over* the other rather than replacing it.
        // A re-score skips any job whose response fails validation, so its cache
        // can cover fewer jobs than the precomputed file; picking one wholesale
        // would strip those jobs' scores and render them unscored after reload.
        const scores = cacheIsNewer
            ? { ...baked.scores, ...cached.scores }
            : { ...cached.scores, ...baked.scores };

        return {
            scores,
            source: cacheIsNewer ? 'cache' : 'baked',
            generatedAt: cacheIsNewer ? cached.generatedAt : baked.generatedAt,
        };
    }
    return cached ?? baked ?? EMPTY;
}
