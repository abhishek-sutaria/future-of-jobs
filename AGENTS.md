# Agent notes

## Cursor Cloud specific instructions

- **App:** Vite + React SPA (`npm run dev`). No database/Docker. Claude calls go through `/api/claude/messages` (Vite proxy in dev; `api/claude.ts` on Vercel).
- **Package manager:** npm (`legacy-peer-deps=true` in `.npmrc`). Install with `npm install`.
- **Tests:** `npx vitest run` (no `npm test` script). Lint: `npm run lint` (some pre-existing purity/unused-var failures exist outside recent feature work).
- **Claude model caveat:** `claude-sonnet-5` rejects `temperature` — do not send it (see `src/utils/claude.ts`).
- **Re-score:** Full map re-score requires the **user’s** Claude API key (not the app default) and shows a token/USD estimate in `RescoreConfirmModal`. Roughly ~50 calls / ~65k tokens / ~$0.50–$0.70 at Sonnet list prices.
- **Modal mounting gotcha:** `Header` uses `pointer-events-none` (with selective `pointer-events-auto` on controls) at `Z.header` (20). Never mount full-screen dialogs inside it — clicks fall through to the WebGL globe/job labels and the year slider (`Z.timeBar` = 110) paints above the dialog. Mount rescore/API modals at `App` root (or portal to `document.body`) with `pointer-events-auto`.
- **3D hover popups:** Job label hover expand is suppressed while `isOrbiting` is true (`OrbitControls` `onStart`/`onEnd` in `Landscape.tsx`).
- **Production:** https://futureofjobs.vercel.app/ auto-deploys from `main`.
