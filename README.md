# AI & Future of Work 2025-2030

A futuristic dashboard visualizing the impact of AI on the workforce. This application combines 3D visualization, live economic data, and generative AI to provide a comprehensive look at how jobs are evolving.

## Features

- **3D Terrain Visualization**: Interactive 3D landscape representing job markets, where peak height corresponds to growth and automation resilience.
- **Holographic World Map**: Global view of role distribution across regions.
- **Live Economic Data**: Real-time integration with the Bureau of Labor Statistics (BLS) for unemployment rates.
- **One app for every scored role**: every scored occupation (the 50 Kelley roles and every other BLS job with O*NET tasks) opens the same panel and is ranked on one scale across all of them, each BLS occupation once.
- **One scoring method**: every published AI score is in `src/data/ai_scores_bls.json`, made by one model, one prompt and one set of O*NET task rules from `data/bls_score_plan_all.json` (see `docs/scoring-decisions.md`). The Kelley roles' first scores (`src/data/ai_scores.json`, Aug 2026) are kept only as history, and the app stops reading them once `--batch kelley` has scored their BLS occupations.
- **Crystal Ball Simulation**: Claude-powered "Day in the Life" scenario generator for 2030.
- **Strategic Upskilling Roadmap**: Actionable 6-month plans to transition from at-risk tasks to safe harbors.
- **Shared saved answers**: Strategic Insight, Scenario, Roadmap and Defend / Build are written by Claude once per role, saved on the server, and shown to every later visitor with no new Claude call. See [Claude gateway and shared answers](#claude-gateway-and-shared-answers).
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
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_or_secret_key_here
```

- `SUPABASE_SERVICE_ROLE_KEY` is **server-only** (no `VITE_` prefix, so Vite never puts it in the browser bundle). Only `api/claude.ts` reads it, to save shared answers and count the rate limit. Without it the app still works, but every visitor gets a fresh Claude answer and the limit counts per function instance only; System status says which name is missing.
- `SUPABASE_URL` is optional; the server falls back to `VITE_SUPABASE_URL`.
- Optional limits on new Claude answers made with the server key: `FOJ_RATE_PER_HOUR` (per visitor, default 30), `FOJ_RATE_PER_DAY` (per visitor, default 100), `FOJ_RATE_GLOBAL_PER_DAY` (whole app, default 1000).

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
- `/api/claude/messages` -> Claude gateway (see below)
- `/api/bls` and `/api/bls/:seriesId` -> BLS proxy

These endpoints preserve the same runtime behavior expected by the frontend:
- Claude default-key + user-key mode
- BLS POST batch fetches and unemployment series fetches

## Claude gateway and shared answers

`api/claude.ts` (rules in `api/_lib/gateway.ts`) no longer forwards whatever the browser sends:

- **Only the app's own requests.** The browser sends `{ feature, input }`. The server checks the feature is one of the app's (`src/shared/aiFeatures.ts`), checks the input's shape and size, builds the prompt itself and sets the model (`claude-sonnet-5`) and `max_tokens`. A raw Anthropic request is accepted only with the visitor's own key, for the opt-in re-score and the status ping.
- **One shared saved answer.** For Strategic Insight (Analyze), Scenario, Roadmap and Defend / Build, the first answer that passes the app's checks is saved in Supabase (`ai_shared_answers`), keyed by role + feature + prompt version + a hash of the exact request. Every later visitor gets that answer with no Claude call. A changed input or prompt gets a new answer. Résumé-based features are never saved.
- **Rate limit.** Each visitor (a hash of their IP) may ask for a limited number of NEW answers per hour and per day, and the whole app has a daily ceiling. Saved answers never count. Counts live in Supabase (`ai_rate_limits`), so the limit holds across serverless instances.
- **Make one answer again.** Delete it, and the next visitor's click writes a new one:
  ```bash
  # .env.local (never committed) holds VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  node scripts/shared_answers.mjs list   --role soc:29-1141
  node scripts/shared_answers.mjs delete --role soc:29-1141 --feature roadmap        # dry run
  node scripts/shared_answers.mjs delete --role soc:29-1141 --feature roadmap --yes  # delete
  ```
  `--role` is `job-15` for a Kelley role or `soc:` plus the BLS code on the role panel; `--feature` is `analyze`, `scenario`, `roadmap` or `upskill`.
- **Local testing without a key:** `FOJ_MOCK_CLAUDE=1 npm run dev` runs the same gateway against an in-memory mock of Claude and Supabase.

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
| State-level | `src/data/geo_real.json` (Kelley codes) + `src/data/state_map/` (all 830 jobs) | 2D US map employment + Location Quotient | **May 2025** (BLS state file) |

### Refreshing

National per-role employment (`src/data.ts`) comes from the BLS public API:

```bash
# Optional BLS registration key (the national pass is 47 series):
#    https://data.bls.gov/registrationEngine/
export VITE_BLS_API_KEY=your_key_here
node scripts/refresh_oes_data.mjs --dry-run   # preview, no files written
node scripts/refresh_oes_data.mjs             # apply
```

It rewrites `src/data.ts` employment values, all 50 `dataSources` literals in
that file, `DATA_SOURCES.BLS_OES` in `src/config/constants.ts` and
`src/data/national_employment.json`. `src/__tests__/oesVintage.test.ts` and
`scripts/audit.mjs` (T65–T67) both guard that `DATA_SOURCES.BLS_OES` and the
literals in `data.ts` never drift apart.

State-level data (the state map, all 830 jobs) comes from the BLS OEWS state
file committed in `data/oews_state/` (sha256-pinned):

```bash
npx tsx scripts/build_state_map.ts           # rebuild geo_real.json, src/data/state_map/, docs/state-map.md
npx tsx scripts/build_state_map.ts --check   # fail if any of them is stale
```

`docs/state-map.md` has the method, coverage and source.

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
  the full AI re-score. Analyze is the same for everyone, so it is one shared
  answer on the server (see [Claude gateway and shared answers](#claude-gateway-and-shared-answers));
  the re-score stays in its localStorage cache. Scenario and Roadmap are also
  shared answers on the server, and a signed-in user keeps a copy in their own
  saved reports.
- **Résumé privacy**: raw résumé/CV text is never written to disk anywhere —
  not to localStorage, not to Supabase. It lives only in component state
  and is cleared when the relevant modal closes. Résumé-derived artifacts are
  keyed by a content hash (`resumeCacheKey` in `src/lib/userData.ts`) so a
  saved report can be found again without ever storing the source text.

### Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run **all three** migrations in `supabase/migrations/`, in
   order — read each file's own header comment for what it does before running
   it:
   - `0001_user_activity.sql` — creates the tables and RLS policies.
   - `0002_grant_authenticated_privileges.sql` — **required.** RLS decides
     *which rows* a role may touch, but Postgres needs a separate, more basic
     `GRANT` before a role may query a table at all. Skipping this leaves every
     request from a signed-in (including anonymous) user failing with a 403
     before RLS is ever evaluated — the app looks completely broken while the
     policies themselves are perfectly correct.
   - `0003_shared_ai_answers.sql` — the shared saved answers and rate-limit
     counts used by `api/claude.ts`. Server-only: no access for the anon or
     signed-in roles; only the service key used inside `api/` can reach them.
3. In **Authentication → Settings**, enable **Allow anonymous sign-ins** (off
   by default). If you want the email-upgrade flow to work, also confirm your
   email provider is configured.
4. In **Authentication → URL Configuration**, set the redirect targets for
   magic links. Both fields ship with defaults that silently break sign-in in
   production, and the failure is invisible from the app side — the link
   arrives fine and simply lands nowhere useful, leaving the user as a guest:
   - **Site URL** defaults to `http://localhost:3000`. Set it to your deployed
     origin (e.g. `https://your-app.vercel.app`), or every emailed link points
     at a dev server that isn't running.
   - **Redirect URLs** is **empty** by default, and an empty allow-list matches
     nothing — so Supabase discards the app's requested `emailRedirectTo` and
     falls back to the Site URL. Add your origins with a wildcard so any path
     (the app requests `/dashboard`) is permitted:
     ```
     https://your-app.vercel.app/**
     http://localhost:5173/**
     ```
5. Copy the **Project URL** and **anon/public key** (Project Settings → API)
   into `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — locally in `.env.local`
   and in Vercel Project Settings → Environment Variables for production.
   The anon key is meant to be public: it carries no privileges of its own,
   and every table denies all access until RLS explicitly grants it.
6. (Optional, not part of CI) After setup, prove isolation against your real
   project:
   ```bash
   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/verify_rls.mjs
   ```
   This creates two real anonymous users and asserts neither can read, write,
   update, or delete the other's rows — the thing a mocked-client unit test
   cannot prove, since RLS is enforced by Postgres itself.
