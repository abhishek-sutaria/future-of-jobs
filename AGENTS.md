# Agent notes

## Cursor Cloud specific instructions

- **App:** Vite + React SPA (`npm run dev`). No database/Docker. Claude calls go through `/api/claude/messages` (Vite proxy in dev; `api/claude.ts` on Vercel).
- **Package manager:** npm (`legacy-peer-deps=true` in `.npmrc`). Install with `npm install`.
- **Tests:** `npx vitest run` (no `npm test` script). Lint: `npm run lint` (some pre-existing purity/unused-var failures exist outside recent feature work).
- **Claude model caveat:** `claude-sonnet-5` rejects `temperature` — do not send it (see `src/utils/claude.ts`).
- **Re-score:** Full map re-score requires the **user’s** Claude API key (not the app default) and shows a token/USD estimate in `RescoreConfirmModal`. Roughly ~50 calls / ~65k tokens / ~$0.50–$0.70 at Sonnet list prices.
- **3D hover popups:** Job label hover expand is suppressed while `isOrbiting` is true (`OrbitControls` `onStart`/`onEnd` in `Landscape.tsx`).
- **Production:** https://futureofjobs.vercel.app/ auto-deploys from `main`.
