# Mobile master plan

**Date:** 2026-09-20
**Status:** proposed, not started
**Trigger:** mobile was promised to Ray as "actively in progress" (job tags not visible, alignment issues). This plan replaces that informal list with an audited one.

---

## 1. How this was audited

Production (`futureofjobs.vercel.app`, commit `d46a6d7`) driven with headless Chromium under device emulation, four viewports plus landscape:

| Target | Viewport | DPR |
|---|---|---|
| iPhone SE | 375 x 667 | 2 |
| iPhone 14 Pro | 393 x 852 | 3 |
| Pixel 7 | 412 x 915 | 2.625 |
| Small tablet | 768 x 1024 | 2 |
| Phone landscape | 667 x 375 | 2 |

Per viewport: screenshot, horizontal-overflow scan of every visible element, tap-target measurement, label census, role panel opened via search, overflow sheet, map view, `/dashboard`.

**What this method cannot prove:** iOS Safari's dynamic toolbar, real safe-area insets, actual touch/pull-to-refresh behaviour, and Android Chrome quirks. Emulation is Chromium with a spoofed UA. Items marked **[device]** below must be confirmed on real hardware.

---

## 2. Findings

### P0 — features that do not exist on a phone

**F1. Analyze and Scenario cannot be run on mobile.**
`JobDetailPanel.tsx:216` and `:222` are `hidden md:flex`, and `grep md:hidden JobDetailPanel.tsx` returns nothing, so there is no mobile counterpart. The audit confirms both are "in DOM, hidden by CSS" at 375px. The bookmark/save button (`:205`) is hidden the same way.
Impact: the two headline AI features are desktop-only. A student on a phone can read a role but cannot ask Claude about it.

**F2. 45 of 50 job titles are invisible on a phone.**
`JobMarkers.tsx:99-120` thins labels to `ANIMATIONS.MOBILE_LABEL_COUNT = 5`, chosen by employment among peaks with `|x| <= MOBILE_LABEL_CENTER_X (10)`. Every phone tested rendered exactly 5: Market Research Analyst, Management Consultant, General Manager, Project Management Specialist, HR Specialist.
This is Ray's "a few job tags still aren't visible". It is deliberate, but the result is that the terrain reads as five named hills and 45 anonymous dots.

### P1 — alignment (Ray's second report)

**F3. The Sources button sits underneath the year-slider card.**
`UI.tsx:230` places it `absolute bottom-4 left-4` at `Z.base`; `YearSlider.tsx:28` places the card `absolute inset-x-0 bottom-6` at `Z.timeBar`. On phones the card spans the full width, so "SOURCES: Methodology & Data" ghosts through the translucent card. Visible in every phone screenshot.

**F4. 3D labels collide with header chrome.** In portrait, "Market Research Analyst" covers the search input and its dropdown. In landscape it covers the MAP button.

**F5. Chosen labels are clipped at the screen edge.** At 393px and 412px, "HR Specialist" renders at `left: -13` / `-16`. The `MOBILE_LABEL_CENTER_X` filter uses the peak's terrain x and ignores the rendered label's width.

**F6. Landscape is unusable.** At 667 x 375 the slider card occupies roughly 45% of the viewport, the terrain is squeezed into a thin band, and the card is clipped at the bottom.

**F7. 768-1023px is the worst tier in the app.** At exactly 768 the desktop path engages and all 50 labels render, overlapping into an unreadable mass with 6 clipped at the edges. The breakpoint is binary at 767/768 with nothing in between.

### P2 — viewport and touch correctness

**F8. No safe-area handling anywhere.** No `env(safe-area-inset-*)` in `src/index.css` or any component, and no `viewport-fit=cover`. Bottom controls can fall under the home indicator. **[device]**

**F9. No `overscroll-behavior` and no `touch-action`.** Nothing prevents pull-to-refresh while dragging the terrain. This is the known mobile refresh problem. **[device]**

**F10. `html, body { height: 100% }` with no `dvh`.** `src/index.css:6-11`. iOS Safari's collapsing toolbar will cover the bottom band, so F3 and F6 are worse on real hardware than in these screenshots. **[device]**

**F11. Tap targets under 44 x 44.** Header icon buttons are 40 x 44 (Map, Health, Saved). At the tablet tier, Growth/Workers are 69 x 23 and the Sources pill is 35px tall.

**F12. Hover-only affordances on a touch device.** The panel instructs "Hover any badge for a simple explanation." The gauge, sparkline and resilience explanations are all `group-hover` or `title` based, so none are reachable by touch.

**F13. Search results are not touch or keyboard accessible by contract.** Rows are `div`s with `onMouseDown` only (`Header.tsx:321`), no `role="option"`, no keyboard handling.

### P3 — polish

**F14.** The internal id `job-4` is displayed next to the cluster badge in the panel header.
**F15.** "Future-Proof" wraps to two lines in the narrow metric tile at 375px.
**F16.** Dashboard empty state uses an em dash ("No saved roles yet — open a role and choose Save.").

---

## 3. Workstreams

### W1. Restore feature access on mobile (P0, fixes F1)
Add an `md:hidden` action row inside `JobDetailPanel`, sticky to the panel's bottom edge, carrying Analyze, Scenario and Save at 44px minimum with safe-area bottom padding. Keep the existing desktop row untouched.
**Accept:** at 375px both actions are visible without scrolling, run to completion, and results render inside the panel. Bookmark toggles and persists.
**Risk:** low. Additive, scoped to `max-md`.

### W2. Make the terrain labels work on a phone (P0/P1, fixes F2, F5, partially F7)
1. Extract label selection into a pure function in `src/utils/` taking `{peaks, viewport, zoomLevel}` and returning ids plus a clamped screen offset. Unit-test it, matching the repo's pure-logic test convention.
2. Clamp each label so its rendered box stays fully inside the viewport rather than filtering on terrain x.
3. Make density zoom-aware, reusing the existing `lodLevelRef` tiers: few labels when zoomed out, progressively more as the camera closes in.
4. Add a labels on/off control so a student can reveal everything deliberately.
**Accept:** at 375/393/412 no label has `left < 0` or `right > innerWidth`; zooming in reveals nearby titles; every role stays reachable via search.
**Risk:** medium. `JobMarkers.tsx` carries hard-won behaviour (drag-vs-click, drei z-index, hover suppression). Do not touch those paths.

### W3. Fix the bottom cluster and header collisions (P1, fixes F3, F4)
- Move Sources into the `MobileMoreSheet` on `max-md`, where the Student Guide already lives, and drop the floating pill there. It is an informational link, not a primary control.
- Suppress label text whose projected position falls inside the header/search band on mobile, so nothing can cover the search field.
**Accept:** no label intersects the header or search box at any tested width; Sources reachable and never behind the slider.

### W4. Landscape and the 768-1023 tier (P1, fixes F6, F7)
- Under `max-height: 480px`, collapse the slider to a single compact row (hide the mode hint, reduce padding) so the terrain keeps at least 60% of the viewport.
- Replace the binary 767/768 label switch with three tiers: phone (thinned), narrow desktop under 1024 (moderate cap with edge clamping), full desktop (all labels).
**Accept:** landscape terrain >= 60% of viewport; at 768-1023 no clipped labels.

### W5. Viewport, safe areas, gestures (P2, fixes F8, F9, F10)
- `viewport-fit=cover` in `index.html`, then `env(safe-area-inset-*)` padding on the header, slider, panel footer and the new mobile action row.
- `overscroll-behavior: none` on `html, body`; `touch-action: none` on the WebGL canvas; confirm the panel's internal scrolling still works.
- Move `height: 100%` to `100dvh` with a `100vh` fallback.
**Accept:** no pull-to-refresh while dragging the terrain; bottom controls clear the home indicator. **[device: iPhone Safari + Android Chrome]**

### W6. Touch affordances (P2, fixes F11, F12, F13)
- Convert hover explanations to tap-to-open popovers on touch; change "Hover any badge" to gesture-neutral copy.
- Make search results a real listbox (`role="listbox"`/`option`, click and keyboard handlers).
- Enforce 44 x 44 on header icon buttons and the Growth/Workers toggle.

### W7. Polish (P3, fixes F14, F15, F16)
Hide the internal job id (or drop it entirely), fit the resilience label at 375px, replace the em dash in the dashboard empty state.

---

## 4. Sequencing

| PR | Contents | Why this order |
|---|---|---|
| 1 | W1 + W3 | The functional gap and the alignment Ray named. Highest visible payoff, lowest risk. |
| 2 | W5 + W4 | Viewport correctness before label maths, since safe-area and dvh change the box the labels must fit inside. |
| 3 | W2 | Label work lands last, on a stable viewport, with its pure function unit-tested. |
| 4 | W6 + W7 | Affordances and polish. |

---

## 5. Test plan

**Automated (repo):** unit tests for the extracted label-selection/clamping function and the breakpoint tier function, in `src/__tests__/`, matching the existing pure-logic convention. No browser tests in CI: the project has no e2e infrastructure and CI has no browser.

**Pre-release sweep (manual, scripted):** keep the audit script under `scripts/` and run it before each mobile PR merges. It reports overflow, tap targets, label census and clipping across the five viewports.

**Device matrix [device]:** real iPhone Safari and Android Chrome for F8, F9, F10, plus one pass through Analyze, Scenario, Roadmap, Defend/Build, save, map and dashboard.

**Regression gate, unchanged:** `npx tsc -b` clean, `npx vitest run` (179), `node scripts/audit.mjs` (63/63), `npm run lint` at its 26 baseline.

**Ship protocol, unchanged:** branch, full gate, PR, wait for CI to actually report green, merge, confirm the production deployment reaches success, then verify the live bundle.

---

## 6. Risks

- `JobMarkers.tsx` and `Terrain.tsx` encode fragile behaviour (drag-vs-click forwarding, drei z-index ranges, shader/label sync). Label changes must not touch those paths.
- Safe-area and `dvh` changes can shift desktop layout if not scoped to `max-md`.
- The guided tour targets header elements by `data-tour`; hiding or moving chrome on mobile can silently break tour steps (`GuidedTour.tsx:76` already documents this class of failure).
- Emulation cannot prove F8, F9 or F10. Do not report those as fixed without a real device.

## 7. Out of scope

Rebuilding the 3D view for phones, a separate mobile route, and the task-level visualization concepts sent to Ray on 2026-09-19. Those are product direction, not mobile repair.
