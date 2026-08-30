# AI & Future of Work 2025-2030

A futuristic dashboard visualizing the impact of AI on the workforce. This application combines 3D visualization, live economic data, and generative AI to provide a comprehensive look at how jobs are evolving.

## Features

- **3D Terrain Visualization**: Interactive 3D landscape representing job markets, where peak height corresponds to growth and automation resilience.
- **Holographic World Map**: Global view of role distribution across regions.
- **Live Economic Data**: Real-time integration with the Bureau of Labor Statistics (BLS) for unemployment rates.
- **Crystal Ball Simulation**: Claude-powered "Day in the Life" scenario generator for 2030.
- **Strategic Upskilling Roadmap**: Actionable 6-month plans to transition from at-risk tasks to safe harbors.
- **Individual User Activity** *(optional, requires Supabase)*: saved roles, view history, upskill progress, and saved AI reports, private per user. See [Individual User Activity](#individual-user-activity) below.

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **3D/Graphics**: React Three Fiber, Three.js, GLSL Shaders
- **Styling**: TailwindCSS
- **State Management**: Zustand (visualization state); a separate Zustand store for user identity/activity
- **AI**: Anthropic Claude API
- **Accounts & persistence**: Supabase (Auth + Postgres + Row Level Security) — optional; the app is fully functional without it

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   ANTHROPIC_API_KEY=your_server_default_claude_key_here
   VITE_BLS_API_KEY=your_bls_api_key_here
   VITE_SUPABASE_URL=your_supabase_project_url_here
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
   ```
   Notes:
   - `ANTHROPIC_API_KEY` is used server-side by the proxy as the default Claude key.
   - On app startup, users can either enter their own Claude key or choose the default key.
   - The default key is never embedded in frontend source code.
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are **optional**. Omit them and
     the app runs exactly as before — no account button, no persistence, nothing
     broken. See [Individual User Activity](#individual-user-activity) to set
     these up. The anon key is a publishable identifier, not a secret — see that
     section for why it's safe to ship in the client bundle.

3. **Run Locally**
   ```bash
   npm run dev
   ```

## Deploy on Vercel

This app is a Vite SPA and uses server-side proxy endpoints in production.
The local Vite proxy in `vite.config.ts` is dev-only and does not run on Vercel.

### 1) Required environment variables

Set these in Vercel Project Settings -> Environment Variables:

```env
ANTHROPIC_API_KEY=your_server_default_claude_key_here
VITE_BLS_API_KEY=your_bls_api_key_here
VITE_SUPABASE_URL=your_supabase_project_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

Notes:
- `ANTHROPIC_API_KEY` enables default Claude key mode.
- Users can still provide their own key in-app; user mode is preserved.
- `VITE_BLS_API_KEY` is optional but recommended for higher BLS rate limits.
- `VITE_SUPABASE_*` are optional — omit to deploy without accounts/persistence.

### 2) Create a new Vercel project

From the repo root:

```bash
npx vercel
```

Follow prompts to create/link the project, then add env vars above.

### 3) Deploy

After env vars are configured:

```bash
npx vercel --prod
```

### 4) Production behavior parity

Production uses Vercel serverless functions under:
- `/api/claude/messages` -> Anthropic proxy
- `/api/bls` and `/api/bls/:seriesId` -> BLS proxy

These endpoints preserve the same runtime behavior expected by the frontend:
- Claude default-key + user-key mode
- BLS POST batch fetches and unemployment series fetches

## Key Components

- `Landscape.tsx`: Main 3D scene controller.
- `Terrain.tsx`: Custom shader-based terrain generation using BLS data.
- `MapView.tsx`: Interactive SVG/Dom-based world map for geographic insights.
- `UI.tsx`: The main "Glassmorphism" overlay dashboard.

## Employment Data (BLS OES / OEWS)

Employment/headcount data comes from BLS's Occupational Employment and Wage
Statistics program, in **two separate extracts refreshed independently** —
check each one's own source note before assuming a number is current, since
they can drift apart between refreshes:

| Extract | File | Drives | Current vintage |
|---|---|---|---|
| National, per role | `src/data.ts` | 3D terrain height, the Workers stat, the "OES" badge | **May 2025** |
| State-level | `src/data/geo_real.json` | 2D US map employment + Location Quotient | **May 2025** |

### Refreshing

```bash
# 1. Get a free BLS registration key (unregistered tier is 25 req/day, not
#    enough to cover the ~5,000 series a full refresh needs):
#    https://data.bls.gov/registrationEngine/
export VITE_BLS_API_KEY=your_key_here

# 2. Preview the change with no files written:
node scripts/refresh_oes_data.mjs --dry-run

# 3. Apply it (both national and state-level; add --national-only for just
#    the smaller national pass, e.g. while iterating without spending quota
#    on the full state-level fetch):
node scripts/refresh_oes_data.mjs
```

This pulls directly from `api.bls.gov` — `www.bls.gov`/`download.bls.gov` block
automated downloads (Akamai bot protection), so the classic "download the OEWS
workbook" path (`scripts/extract_bls_data.py`) can no longer be refreshed
programmatically for a new vintage. `scripts/refresh_oes_data.mjs` rewrites, in
one pass: `src/data.ts` employment values, all 50 `dataSources` literals in
that file, `DATA_SOURCES.BLS_OES` in `src/config/constants.ts`,
`src/data/national_employment.json`, and (unless `--national-only`)
`src/data/geo_real.json`. `src/__tests__/oesVintage.test.ts` and
`scripts/audit.mjs` (T65–T67) both guard
that `DATA_SOURCES.BLS_OES` and the literals in `data.ts` never drift apart.

`src/utils/onet.ts`'s `MAP_TITLE_TO_SOC` is the single source of truth for
which SOC code each role uses, for both extracts. If BLS retires or
consolidates a SOC code (as happened to `13-1022`/`13-1023`, now the broad
code `13-1020`), update that map first — the refresh script and
`scripts/audit.mjs` T64/T57/T58 both key off it.

## Individual User Activity

Signed-in users (anonymous by default, upgradeable to email) get their saved
roles, view history, upskill progress, and saved AI reports persisted and kept
private to them. This is **entirely optional infrastructure** — without it
configured, the app behaves exactly as a stateless, anonymous SPA.

### Architecture

- **Identity & storage**: [Supabase](https://supabase.com) (Auth + Postgres).
  Chosen because Postgres Row Level Security (RLS) enforces per-user isolation
  in the database itself, not in application code, and because its client SDK
  talks to Supabase directly — no new server routes are needed, which matters
  here specifically because this repo's `api/*.ts` serverless functions do
  **not** run under `npm run dev` (see `AGENTS.md`).
- **Sign-in model**: anonymous-first. Every visitor gets a real (anonymous)
  Supabase user immediately, so saving works with zero friction and the
  3D/map exploration experience is never gated. A header button lets them
  attach an email later, which upgrades the SAME user record — nothing is
  lost.
- **Decoupled from the Claude API key**: the Claude key mechanism
  (`localStorage['foj_user_claude_key']`, sent as an `x-user-api-key` header)
  is untouched by any of this. Signing out does not clear it; it is never
  written to a user record; auth uses a completely different transport
  (Supabase's own session bearer token, to a different origin).
- **What's persisted**: saved/bookmarked roles, recently-viewed roles (IDs +
  timestamps only, never full job objects), upskill task completions,
  auto-saved Scenario/Roadmap results (deterministic cache keys, so reopening
  a modal restores instead of re-billing a Claude call), and — **opt-in
  only** — Startup Ideas dashboards and Skills/Résumé analyses, since both are
  derived from a résumé.
- **What's deliberately NOT persisted per-user**: per-job Analyze results and
  the full AI re-score. Both are pure functions of bundled job data (same
  job → same output for everyone), so they stay in their existing shared
  localStorage caches rather than being duplicated per account.
- **Résumé privacy**: raw résumé/CV text is never written to disk anywhere —
  not to localStorage, not to Supabase. It lives only in component state
  and is cleared when the relevant modal closes. Résumé-derived artifacts are
  keyed by a content hash (`resumeCacheKey` in `src/lib/userData.ts`) so a
  saved report can be found again without ever storing the source text.

### Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/migrations/0001_user_activity.sql`. This
   creates the tables and RLS policies — read the file's own header comment
   for what it does before running it.
3. In **Authentication → Settings**, enable **Allow anonymous sign-ins** (off
   by default). If you want the email-upgrade flow to work, also confirm your
   email provider is configured.
4. Copy the **Project URL** and **anon/public key** (Project Settings → API)
   into `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — locally in `.env.local`
   and in Vercel Project Settings → Environment Variables for production.
   The anon key is meant to be public: it carries no privileges of its own,
   and every table denies all access until RLS explicitly grants it.
5. (Optional, not part of CI) After setup, prove isolation against your real
   project:
   ```bash
   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/verify_rls.mjs
   ```
   This creates two real anonymous users and asserts neither can read, write,
   update, or delete the other's rows — the thing a mocked-client unit test
   cannot prove, since RLS is enforced by Postgres itself.
