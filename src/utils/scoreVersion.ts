/**
 * Schema version of every published or cached AI score set. Kept in its own
 * file, with no imports, so the Vite config (utils/blsScoresData through
 * scripts/lib/blsScoresPlugin) can read it without loading taskScoring.
 *
 * v4 = cumulative % from 2025 baseline (not YoY deltas).
 * v5 = prompts grounded in inlined BLS numbers; post-parse forecast cap validation.
 */
export const CACHE_VERSION = 5;
