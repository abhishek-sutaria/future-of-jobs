# Agent notes

## Cursor Cloud specific instructions

- **App:** Vite + React SPA (`npm run dev`). No database/Docker. Claude calls go through `/api/claude/messages` (Vite proxy in dev; `api/claude.ts` on Vercel).
- **Package manager:** npm (`legacy-peer-deps=true` in `.npmrc`). Install with `npm install`.
- **Tests:** `npx vitest run` (no `npm test` script). Lint: `npm run lint` (some pre-existing purity/unused-var failures exist outside recent feature work).
- **Claude model caveat:** `claude-sonnet-5` rejects `temperature` — do not send it (see `src/utils/claude.ts`).
- **OOH vintage:** Growth rates are BLS Employment Projections / OOH **2024–2034** (`DATA_SOURCES.BLS_OOH`, `scripts/extract_bls_data.py`).
- **OES vintage — national and state-level extracts are independent and CAN drift apart, so check each one's own source, not this note:**
  - National per-role employment (`src/data.ts`, drives terrain height + the Workers stat + the "OES" badge) is **BLS OEWS May 2025**.
  - State-level employment/LQ (`src/data/geo_real.json`, drives the 2D map) is also **BLS OEWS May 2025** as of the last refresh — but check `geo_real.json`'s own `_meta.bls_release`, don't assume it still matches `DATA_SOURCES.BLS_OES`; the two are refreshed by the same script but at different times.
  - Both are refreshed via `node scripts/refresh_oes_data.mjs`, which pulls `api.bls.gov` directly — `www.bls.gov`/`download.bls.gov` 403 all automated clients, so the classic workbook route can no longer be refreshed programmatically. Requires a free BLS key (`VITE_BLS_API_KEY`; unregistered tier is 25 req/day, nowhere near enough for the ~5,000-series state pass). Rewrites `DATA_SOURCES.BLS_OES` + all 50 `dataSources` literals in `data.ts` together — `src/__tests__/oesVintage.test.ts` guards them staying in sync.
  - `MAP_TITLE_TO_SOC` (`src/utils/onet.ts`) is the single source of truth for both extracts. BLS retired SOC 13-1022/13-1023 (Wholesale & Retail Buyer / Purchasing Agent) and now publishes only the combined broad code **13-1020** — both titles map there as aliases.
- **Analyze sync:** `updateJobFromLiveAnalysis` / `applyAnalysesToJobs` match Claude tasks by name, then by index, so paraphrased `task_text` still updates Automation Risk.
- **Re-score:** Full map re-score requires the **user’s** Claude API key (not the app default) and shows a token/USD estimate in `RescoreConfirmModal`. Roughly ~50 calls / ~65k tokens / ~$0.50–$0.70 at Sonnet list prices.
- **Modal mounting gotcha:** `Header` uses `pointer-events-none` (with selective `pointer-events-auto` on controls) at `Z.header` (20). Never mount full-screen dialogs inside it — clicks fall through to the WebGL globe/job labels and the year slider (`Z.timeBar` = 110) paints above the dialog. Mount rescore/API modals at `App` root (or portal to `document.body`) with `pointer-events-auto`.
- **3D hover popups:** Job label hover expand is suppressed while `isOrbiting` is true (`OrbitControls` `onStart`/`onEnd` in `Landscape.tsx`).
- **Production:** https://futureofjobs.vercel.app/ auto-deploys from `main`.
