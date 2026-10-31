# Phase 3a — AI score calibration (do not merge)

In-session ratings (no API) of the 50 Kelley roles, compared with the published `src/data/ai_scores.json`.

- Prompts: `scripts/calibration_prompts.ts` (exact `buildJobAnalysisPrompt()` output, same inputs as `generate_ai_scores.ts`).
- Ratings: `reports/calibration/ratings_phase3a.json`, built by `scripts/build_calibration_ratings.ts` and validated with `JobTaskScoringSchema` + `parseJobAnalysis()`. Committed **before** `ai_scores.json` was opened (see git history).
- Comparison: `scripts/compare_calibration.ts` → `comparison_phase3a.txt`.
- The yearly forecast in the ratings file is a mechanical ease-in path (not rated); only task scores are calibrated.
- Nothing under `src/` is changed.

Run: `npx vite-node scripts/compare_calibration.ts` (`tsx` fails on this branch: `occupationIndex.ts` uses `import.meta.glob`, so `npm run generate-scores` is currently broken here too).

## Phase 3a-3 — self-consistency (10 roles)

Blind in-session re-rating of 10 Kelley roles (`ratings_phase3a3.json`, committed before comparison in cea104f) vs run 1 (`ratings_phase3a.json`). Published scores are a reference column only. Results: `comparison_phase3a3.txt` (`npx vite-node scripts/compare_calibration_3a3.ts`). Nothing under `src/` is changed.
