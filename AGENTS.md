# AGENTS.md

## Cursor Cloud specific instructions

This repo is a **single React 19 + Vite 7 SPA** (`future_of_jobs`) — an "AI & Future of Work 2025-2030" dashboard. There is **no database, no Docker, no separate backend**: the only local dev process is the Vite dev server, which also proxies `/api/claude` → Anthropic and `/api/bls` → BLS (see `vite.config.ts`).

### Running / building / testing

Standard commands live in `package.json` scripts and `.github/workflows/ci.yml`; use those as the source of truth. Key ones:

- Dev server: `npm run dev` (serves on `http://localhost:5173`). This is the only service to run for end-to-end testing.
- Unit tests: `npx vitest run` (Vitest; specs in `src/__tests__/`).
- Audit + typecheck + production build: `node scripts/audit.mjs` (this is what CI gates on — it runs `tsc` and `vite build`, 60 checks).
- Lint: `npm run lint`.

### Non-obvious caveats

- **`npm run lint` currently reports pre-existing errors** (e.g. `react-hooks/purity` in `Skeleton.tsx`, unused-vars in `data.ts`/`bls.ts`). These are existing code issues, not environment breakage. Do not "fix" them unless that is your task.
- **No `.env` is required to run and browse the app.** The dashboard boots from bundled data (`src/data.ts`, `src/data/*.json`) and pre-baked AI scores (`src/data/ai_scores.json`), so the 3D terrain, job detail panels, and 2D map all work offline.
- **Live AI features require an Anthropic key.** ANALYZE / SCENARIO / roadmap / upskilling call Claude through the dev proxy. Without `ANTHROPIC_API_KEY` in `.env` (default-key mode) or a user-supplied key in the in-app modal, these features show a "Claude could not authenticate" error — expected, not a bug. `VITE_BLS_API_KEY` is optional (higher BLS rate limits only).
- On first load an **API key modal** appears. To test the core visualization without AI, choose default-key mode / continue; you do not need a real key to exercise the 3D/2D views and job selection.
- Dev-only URL helpers (from `src/main.tsx`): `?resetClaude=1` resets the Claude key choice; add `&clearScores=1` to also clear cached AI scores.
- `npm` is the package manager (`.npmrc` sets `legacy-peer-deps=true`; keep using `npm install`/`npm ci`). CI pins Node 20; Node 22 also works locally.
