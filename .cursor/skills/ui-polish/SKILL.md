---
name: ui-polish
description: >-
  Polish or verify Future of Jobs UI (3D globe labels, role panel, mobile,
  modals, map/tasks views). Use for layout, spacing, hover, z-index, or
  screenshot-driven UI fixes — not for BLS data refresh or rescore logic.
paths:
  - "src/components/**/*.tsx"
  - "src/App.tsx"
  - "src/index.css"
---

# UI polish

## Run

```bash
npm run dev
```

Open the local Vite URL. Production reference: https://futureofjobs.vercel.app/

## Verify (minimal)

Prefer **one screenshot** of the changed viewport over a full demo video unless the user asked for video.

Check only what you touched:

| Surface | What to look at |
|---|---|
| 3D globe | Job labels, hover expand, orbit drag |
| Role / detail | `JobDetailPanel`, tasks, stats |
| Mobile | Narrow viewport; more sheet / filters |
| Modals | Click targets work; dialog sits above the year slider |

## Known traps (do not rediscover)

- **Modals:** Never mount full-screen dialogs under `Header`. Header is `pointer-events-none` at `Z.header` (20); year slider is `Z.timeBar` (110). Mount at `App` root or `document.body` with `pointer-events-auto`.
- **Hover labels:** Expand is suppressed while `isOrbiting` is true (`Landscape.tsx` OrbitControls `onStart`/`onEnd` → `JobMarkers.tsx`).
- **Big files:** Do not open all of `src/data.ts`, `geo_real.json`, or `ai_scores.json`. Grep the role/title you need.

## Scope

One visual goal per agent run. Do not mix unrelated polish, data work, or email/MCP tasks in the same pass.
