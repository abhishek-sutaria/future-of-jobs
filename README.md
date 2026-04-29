# AI & Future of Work 2025-2030

A futuristic dashboard visualizing the impact of AI on the workforce. This application combines 3D visualization, live economic data, and generative AI to provide a comprehensive look at how jobs are evolving.

## Features

- **3D Terrain Visualization**: Interactive 3D landscape representing job markets, where peak height corresponds to growth and automation resilience.
- **Holographic World Map**: Global view of role distribution across regions.
- **Live Economic Data**: Real-time integration with the Bureau of Labor Statistics (BLS) for unemployment rates.
- **Crystal Ball Simulation**: Claude-powered "Day in the Life" scenario generator for 2030.
- **Strategic Upskilling Roadmap**: Actionable 6-month plans to transition from at-risk tasks to safe harbors.

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **3D/Graphics**: React Three Fiber, Three.js, GLSL Shaders
- **Styling**: TailwindCSS
- **State Management**: Zustand
- **AI**: Anthropic Claude API

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
   ```
   Notes:
   - `ANTHROPIC_API_KEY` is used server-side by the proxy as the default Claude key.
   - On app startup, users can either enter their own Claude key or choose the default key.
   - The default key is never embedded in frontend source code.

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
```

Notes:
- `ANTHROPIC_API_KEY` enables default Claude key mode.
- Users can still provide their own key in-app; user mode is preserved.
- `VITE_BLS_API_KEY` is optional but recommended for higher BLS rate limits.

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
