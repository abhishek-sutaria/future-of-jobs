# Master Plan: Ray's Round-3 Feedback (Brand Manager panel + Dashboard value)

**Date:** 2026-09-07
**Baselines to preserve:** `npx tsc -b` clean · `npx vitest run` 124/124 · `node scripts/audit.mjs` 63/63 · `npm run lint` ≤ 26 problems (22 errors / 4 warnings, all pre-existing)
**Scope:** 4 concerns raised by Ray, delivered as 5 sequenced PRs.

> **STATUS — all shipped and live as of 2026-09-07.**
> PR-1 → [#41](https://github.com/abhishek-sutaria/future-of-jobs/pull/41) badges · PR-2 → [#42](https://github.com/abhishek-sutaria/future-of-jobs/pull/42) Defend/Build · PR-5 → [#43](https://github.com/abhishek-sutaria/future-of-jobs/pull/43) personal-vs-occupation risk · PR-3+PR-4 → [#44](https://github.com/abhishek-sutaria/future-of-jobs/pull/44) dashboard viewers + export (shipped together).
> Final suite: 150 tests, 63/63 audit, lint at the 26-problem baseline.
> §2.1 resolved better than planned: instead of only reframing the high-risk button, **both** columns got an action ("Defend this task" / "Build on this"), which is what Ray suggested *and* keeps the high-risk affordance. The original broken prompt became correct on the Human Skills side.

---

## 0. Executive summary

Ray raised four points. Three are UI/copy issues on the surface. Investigation shows **two of them sit on top of real defects that Ray could not have seen from the screenshot**, and one is a genuine product-logic contradiction that the codebase actively reinforces:

| # | Ray's concern | Surface read | What investigation actually found |
|---|---|---|---|
| 1 | Why "TRAIN FOR THIS" on high-risk tasks? | Confusing label | **Live defect.** The Claude prompt behind that button asserts the task *"has high human value and helps them stay resilient against automation"* — but the button only ever fires on high-risk tasks. Every call ships an inverted premise. The UI also literally contradicts itself on one screen. |
| 2 | Why no O\*NET badge? Why STATE OES here? | Missing/extra badge | **Three defects from one string mismatch.** The O\*NET chip can never render (constant is `'ONET'`, data says `'O*NET-30.1'`); 13/50 roles carry no O\*NET marker at all; and the O\*NET confidence bonus has never applied to any role, because `'O*NET-30.1'.includes('ONET')` is `false`. STATE OES is injected at runtime for map data and leaks onto the panel. |
| 3 | "year-by-year guess" wording | Copy fix | Copy fix, confirmed single-site. |
| 4 | Can I view/print/download the analyses? | Missing feature | **Confirmed absent.** No export or print anywhere. Worse: 2 of 4 report types cannot even be *viewed* from the dashboard (they navigate away), and the Startup Ideas viewer discards ~18 fields per idea. |

**The through-line:** Ray is asking the same question four times — *"does the interface tell the truth about what it knows?"* This plan treats it that way rather than as four cosmetic tickets.

**Two decisions require your sign-off before implementation** (§2.1 and §2.4). Everything else is mechanical.

---

## 1. Findings, with evidence

### 1.1 "TRAIN FOR THIS" — three compounding problems

**Problem A — the app contradicts itself on one screen.**
- `src/components/JobDetailPanel.tsx:403` renders **"Train for this"** on each entry of `highRiskTasks`.
- `src/components/JobDetailPanel.tsx:486` renders **"Reduce focus on {highRiskTasks[0].name}"**.

Both statements target *the same task*, roughly 300px apart. Ray read this correctly; it is not a misunderstanding on his side.

**Problem B — the AI is fed a false premise on every call.**
`src/utils/analysis.ts:224-242`:

```
A professional working as a "${jobTitle}" wants to upskill in this specific task:
"${taskName}"

This task has high human value and helps them stay resilient against automation.   <-- line 228
...
"whyTheseCourses": "One sentence explaining why these specific courses build resilience..."
```

`generateUpskillCourses` has exactly one caller (`UpskillModal.tsx:32-33`), and `UpskillModal` has exactly one entry point (`JobDetailPanel.tsx:403`, the high-risk list). **The premise on line 228 is false 100% of the time.** The prompt was evidently written for the Human Skills column and wired to the Automation Risk column. Claude is being asked to justify resilience for a task the app just labelled 74% automatable, so it complies — producing confident, well-formatted, wrong advice.

**Problem C — the reward mechanic teaches the wrong lesson.**
- `UpskillModal.tsx:handleComplete` toasts: *"Leveled up! '{task}' is now a human-strength skill — Automation Risk just dropped."*
- `src/store.ts:257-268` (`upskillTask`) mutates the **shared job model**: `humanCriticalityScore +0.2`, `aiCapabilityScore -0.1` (`config/GameMechanics.ts`).
- That feeds `automationCostIndex` (`store.ts:361-364`) → terrain height, panel risk %, map colour.

So: taking a course in the most automatable task *lowers the displayed automation risk of the occupation itself*. This is both the wrong career lesson and a data-model error — one user's personal training is being written into what the app presents as an objective, BLS/O\*NET-grounded measure of the occupation.

### 1.2 Badges

`src/utils/provenance.ts:33-48` builds chips by exact string match against `job.dataSources`.

| Finding | Evidence |
|---|---|
| **O\*NET chip is unreachable code** | `constants.ts:26` defines `ONET: 'ONET'`. Actual data value is `"O*NET-30.1"`. `src.has('ONET')` is `false` for all 50 roles. Verified: `dataSources` value counts across `initialJobs` = `{ 'BLS-OES-2025': 50, 'BLS-OOH-2024-34': 50, 'O*NET-30.1': 37 }`. **Zero** occurrences of `'ONET'`. |
| **13 roles lack the marker entirely** | 37/50 carry `"O*NET-30.1"`. The 13 without it are *exactly* the 13 `isAlias: true` roles (`job-2..job-13`, `job-15`). Correlation is 1:1, verified programmatically. |
| **All 50 roles do have O\*NET tasks** | `initialJobs.every(j => j.tasks.length > 0)` === `true`. `data.ts:17` header: `tasks[].name, tasks[].importance → O*NET 30.1`. |
| **`isAlias` means proxy occupation** | `types.ts:21`: `isAlias: boolean; // True if we used a Proxy Job`. So those 13 have real O\*NET tasks sourced from a *related* SOC, not an exact match. |
| **STATE OES is injected at runtime, for the map** | `store.ts:366-370` pushes `DATA_SOURCES.BLS_STATE` when `locationData[socCode]` exists. Its own tooltip (`provenance.ts:20`) says *"Used to color the U.S. map view."* |
| **Nothing guards any of this** | No test references the provenance chips. `scripts/audit.mjs:828-830` explicitly warns this exact failure mode for OES — *"silently drops the OES provenance badge for every job with no test failure elsewhere"* — but only OES got a guard (`oesVintage.test.ts`). O\*NET had none, which is why this shipped. |

**A third instance of the same bug, found while verifying the above.** `store.ts:375` awards `CONFIDENCE.ONET_BONUS` via `item.dataSources.some(s => s.includes('ONET'))`. That substring test **never matches**, because the asterisk breaks it:

```
'O*NET-30.1'.includes('ONET')  // => false
```

Verified against all 50 roles: `initialJobs.some(j => j.dataSources.some(s => s.includes('ONET')))` === `false`. So `CONFIDENCE.ONET_BONUS` (0.25) has never been applied to any role — every role computes `BASELINE 0.5 + BLS_BONUS 0.25 = 0.75` and can never reach 1.0.

Blast radius is contained: `confidenceScore` is written at `store.ts:377` and **read by no component** (`dataCoverageTooltip()` and the `COVERAGE_FORMULA` provenance entry are likewise unreferenced outside `provenance.ts`). Nothing user-visible is wrong today — but the same string mismatch has now produced three separate defects, which is the strongest argument for the typed-constant guard in PR-1's tests.

### 1.3 "CLAUDE FORECAST" wording

`src/utils/provenance.ts:23` — single site, no other occurrence of "guess" in `src/`.

### 1.4 Dashboard: view / print / download

| Capability | Status |
|---|---|
| Download (any format) | **Absent.** No export code anywhere in `src/components/dashboard/`. |
| Print | **Absent** for reports — though working print infrastructure already exists (see below). |
| View: `skills_analysis` | Present, partial — renders `feedback`, `strengths`, `gaps`, `plan`. |
| View: `startup_ideas` | Present, heavily lossy — `SavedReports.tsx:56-57` comment concedes *"full per-idea execution detail lives in StartupIdeasModal itself and isn't duplicated here."* Renders only `name` + `summary`; discards `mvpPlan`, `firstCustomerPath`, `pricingModel`, `pathTo10kMrr`, `pathToScale`, `risks`, `validation48h`, `mvp7day`, `launch30day`, `revenue90day`, `techStack`, `firstCustomers`, `outreachScript`, `killCriteria`, `applicableSkills`, `skillsNeeded` (`claude.ts:95-149`). |
| View: `roadmap`, `scenario` | **Cannot be viewed in the dashboard at all.** `SavedReports.tsx:100-104` calls `onOpenJob()`, navigating the user out of `/dashboard` to the 3D map. Ray explicitly asked about "career roadmap" — currently the one report you cannot read where he expected it. |

**Asset already in the codebase:** a complete, working print system — `Modal.tsx` `printable` prop (lines 13, 24, 82, 88, 92, 124; portals to `document.body`) plus `@media print` rules in `index.css:141-196` (hides non-modal body children, unwraps scroll containers, `@page { margin: 16mm 12mm; size: A4 portrait }`, `[data-print-card] { break-inside: avoid }`). Currently used only by `StudentGuideModal`. **Reuse it. Do not invent a second print path.**

All four payloads *are* persisted in full (`saveScenario`/`saveRoadmap`/`saveStartupIdeas`/`saveSkillsAnalysis` → `StoredArtifact.payload`, `userData.ts:55-63`). Nothing is missing from the database; the dashboard simply does not render or emit it.

---

## 2. Decisions

### 2.1 DECISION REQUIRED — What replaces "TRAIN FOR THIS"?

Ray's real question: *what is the added value of a per-task action, given the Roadmap already exists?*

**Recommended: Option A — "Defend this task" (reframe, keep the feature).**

A high-risk task is precisely where a professional needs guidance; deleting the affordance answers Ray by removing the question rather than the confusion. But the guidance must be about **moving up the value chain on that task** — from *performing* it to *directing, verifying, and owning the judgment inside it* — not about learning to do the automatable part faster.

This makes the per-task action genuinely complementary to the Roadmap, which is the distinction Ray is missing today:

| | Career Roadmap | Per-task action |
|---|---|---|
| Scope | Whole role, one risk→safe pivot, 6 months | One specific task |
| Question | "Where should my career go?" | "This exact task is exposed. What do I do about *it*?" |
| Output | Phases, resources, success metrics | Targeted training that converts exposure into oversight |

Concretely:
- Relabel the button **"Defend this task"** (`JobDetailPanel.tsx:403`).
- Rewrite the prompt (§3.1) to state the task's real risk score and ask for training that *shifts the human into the supervisory/judgment layer*.
- Rewrite the modal framing from "Recommended Training" to make the strategy explicit, so a student understands *why* they're being pointed at an automatable task.
- Harmonise the Career Transition Strategy line so the two no longer contradict: `"Reduce focus on X"` → `"Shift out of routine {X} — or defend it by moving to oversight"`.

**Rejected — Option B: delete the button.** Loses a feature already wired to persistence (`upskillCompletions`), the dashboard Training Log, and score mechanics; leaves the Human Skills column with no action at all; and answers a "why is this confusing?" question by amputation.

**Rejected — Option C: move the button to the Human Skills column.** Matches the existing prompt's premise with a one-line change, but it is the weaker product: it offers help exactly where the user needs it least, and abandons the high-risk column — the entire reason a student opened the panel.

### 2.2 DECISION (recommended, lower stakes) — Stop personal training from mutating occupation-level risk

Problem C in §1.1. `upskillTask` writes a personal action into the shared occupation model.

**Recommended:** keep the personal record (`upskillCompletions`, the "Trained" badge, the Training Log — all already persisted and correct), and **stop mutating `state.jobs`**. Instead surface the effect as an explicitly *personal* readout on the task card ("Your exposure: reduced — you've trained for oversight on this"), leaving the occupation's objective risk % and terrain height grounded in BLS/O\*NET/Claude only.

*Why this matters for Ray specifically:* he is evaluating whether the numbers are trustworthy. A risk figure that silently drifts because the viewer clicked a button is not defensible in a classroom.

**Scope note:** this touches `store.ts:257-268`, `App.tsx`'s `reapplyUpskillCompletions`, and `GameMechanics.ts`. If you want the smallest possible change set for this round, **defer to a follow-up PR** (it is isolated in §3.5 for exactly that reason) — but do not ship the relabel while the toast still claims "Automation Risk just dropped," or the contradiction simply moves.

### 2.3 Badges — decided, no sign-off needed

1. **Fix the O\*NET constant** so the existing chip renders: `ONET: 'O*NET-30.1'`.
2. **Backfill the 13 alias roles** so all 50 declare their O\*NET provenance (they all have O\*NET tasks).
3. **Disclose the proxy nuance** rather than flattening it: alias roles get the same chip, but their tooltip states the tasks come from a closely-related O\*NET occupation. This is more honest than either hiding the badge or implying an exact match — and it is exactly the "make the logic and data sources clear" Ray asked for.
4. **Scope STATE OES to the map.** Filter it out of the panel's chips; keep it feeding the map. Implement as an explicit, named context parameter, not a magic string exclusion.
5. **Add the missing regression test** the audit file already warned about.

### 2.4 DECISION REQUIRED — Export formats for §3.4

**Recommended: Print/PDF + Markdown download.**

- **Print → Save as PDF** reuses the proven `printable` Modal + `index.css` print rules. Zero new dependencies, and "Save as PDF" in the browser print dialog satisfies both "print" and "download a PDF" from Ray's message.
- **Download `.md`** gives a portable, editable artifact (students paste into a doc, advisors annotate). Pure string building, no dependency.
- **Rejected: a client-side PDF library** (`jspdf`/`html2pdf`). Adds ~300KB+ to the bundle and a rendering engine that will disagree with the app's own styling, to duplicate what the browser already does well.

Say the word if you'd rather have `.docx` or `.json` instead of/alongside Markdown.

---

## 3. Work packages

Five PRs, ordered so each is independently reviewable, shippable, and revertible. **PR-1 through PR-3 are safe to ship immediately; PR-4 is the largest; PR-5 is the deferred model fix.**

### PR-1 — Badges tell the truth (Ray #2, #3)

**Intent:** every badge on the panel is accurate, present, and relevant to what's on screen.

**Changes**

1. `src/config/constants.ts:26` — `ONET: 'ONET'` → `ONET: 'O*NET-30.1'`.
   Extend the block comment above `DATA_SOURCES` (which already documents this exact hazard for OES) to note that O\*NET was silently broken by the same class of mismatch until 2026-09.

2. `src/data.ts` — add `"O*NET-30.1"` to the `dataSources` array of the 13 alias roles: `job-2, job-3, job-4, job-5, job-6, job-7, job-8, job-9, job-10, job-11, job-12, job-13, job-15`.
   All 13 already carry 5 real O\*NET tasks each; this corrects an omission, it does not invent provenance.

3. `src/store.ts:375` — replace the broken substring test with a real comparison:
   ```ts
   // was: if (item.dataSources.some(s => s.includes('ONET')))
   if (item.dataSources.includes(DATA_SOURCES.ONET)) confidence += CONFIDENCE.ONET_BONUS;
   ```
   Must ship in the same PR as the constant change (see Risk register).

4. `src/utils/provenance.ts` — make chip context explicit:
   ```ts
   export type ProvenanceContext = 'panel' | 'map';

   export function jobSourceProvenanceChips(
       job: Job,
       context: ProvenanceContext = 'panel',
   ): { key: string; label: string; provenance: DataProvenance }[] {
   ```
   Gate the State OES chip on `context === 'map'`. Comment why: state-level OES drives map colour and Location Quotient only; the panel shows national figures, and `constants.ts:14-20` already documents that the two extracts are separate vintages that may disagree — so showing them side by side on the panel implies a coherence that does not exist.

5. `src/utils/provenance.ts:23` — `CLAUDE_FORECAST` copy:
   > `'A year-by-year prediction of how employment for this job may change, generated by AI using the government's 10-year outlook (BLS OOH) as its anchor.'`

   ("prediction… anchored to BLS", per Ray. Keep it plain-language, consistent with the other tooltips.)

6. `src/utils/provenance.ts` — proxy disclosure. Add an alias-aware O\*NET tooltip:
   ```ts
   ONET: 'The day-to-day tasks listed for this job. Comes from O*NET, a government job-description database.',
   ONET_PROXY: 'The day-to-day tasks listed for this job. Comes from O*NET, a government job-description database, using the closest matching occupation for this role.',
   ```
   Select on `job.isAlias` when building the chip.

**Acceptance criteria**
- Brand Manager (`job-14`) shows: `OES`, `OOH`, `O*NET`, `CLAUDE TASKS`, `CLAUDE FORECAST`. No `STATE OES`.
- All 50 roles show an O\*NET chip; the 13 alias roles show the proxy-worded tooltip.
- Map view retains State OES provenance.
- Forecast tooltip contains "prediction" and no longer contains "guess".

**Tests (new — `src/__tests__/provenance.test.ts`)**
- Every job in `initialJobs` yields an O\*NET chip. *(This is the guard whose absence caused the bug; `audit.mjs:828-830` predicted it.)*
- `DATA_SOURCES.ONET` appears verbatim in ≥1 `dataSources` entry — the same string-drift guard `oesVintage.test.ts` gives OES.
- `jobSourceProvenanceChips(job, 'panel')` never returns `st`; `'map'` does when location data exists.
- No provenance tooltip contains the word "guess".
- Alias vs non-alias roles resolve to different O\*NET tooltip copy.
- `CONFIDENCE.ONET_BONUS` is actually applied: every role's computed `confidenceScore` reaches 1.0 after `fetchRealData`. *(Guards the third instance of the string-mismatch bug.)*

---

### PR-2 — "Defend this task": correct the prompt and the contradiction (Ray #1)

**Intent:** the per-task action gives strategically correct advice, and the panel stops arguing with itself.

**Changes**

1. `src/utils/analysis.ts:223-245` — replace the inverted premise. New signature carries the risk score so the model reasons from fact, not fiction:
   ```ts
   export async function generateUpskillCourses(
       jobTitle: string,
       taskName: string,
       aiRiskPercent: number,
   ): Promise<UpskillCoursesResult>
   ```
   Prompt intent (exact wording at implementer's discretion, these points are mandatory):
   - State the truth: this task is assessed at ~`{aiRiskPercent}`% automation exposure for a `{jobTitle}`.
   - Ask for training that moves the professional **from performing the task to owning the judgment around it**: supervising AI output, catching failure modes, handling exceptions/edge cases, accountability, stakeholder and ethical judgment, and the domain expertise required to know when the automated output is wrong.
   - Explicitly forbid recommending courses that just teach faster manual execution of the automatable part.
   - Require 3 real, currently-existing courses/certifications with real providers (retain today's constraint).
   - `whyTheseCourses` must explain **how these reduce the user's personal exposure on this specific task**.

2. `src/components/UpskillModal.tsx`
   - Pass the risk score through from the caller.
   - Header: `"Recommended Training"` → `"Defending this task"`, with a one-line strategy statement directly under the task name, e.g. *"This task is highly automatable. The goal isn't to do it faster — it's to own the judgment around it."*
   - Impact notice (currently `UPSKILL_IMPACT` copy): reword to personal framing — what changes is *your* exposure, not the occupation's risk. (Final wording lands with PR-5; if PR-5 is deferred, use personal-but-honest phrasing here and do not claim the occupation's risk dropped.)
   - Toast: replace *"…is now a human-strength skill — Automation Risk just dropped"* with something true, e.g. *"Logged. You're building oversight on '{task}' — tracked in your dashboard."*

3. `src/components/JobDetailPanel.tsx`
   - `:403` — `Train for this` → **`Defend this task`**.
   - `:486` — `Reduce focus on {X}` → `Shift routine {X} toward oversight` (or equivalent) so the two panels state one coherent strategy. Keep the `IconTrendingDown` semantic.
   - Add a one-line explainer above the Automation Risk task list stating what the action means, so the logic is self-evident without a tooltip — this is the substance of Ray's "what's the added value" question.

**Acceptance criteria**
- No screen states both "reduce focus on X" and "train for X".
- The prompt sent to Claude contains the real risk percentage and never asserts the task is human-valued.
- A student reading only the panel can articulate why an automatable task has a training action.

**Tests**
- Unit-test the prompt builder (extract prompt construction into a pure exported function so it is assertable without a network call): asserts the risk % is interpolated, and that the string does not contain the old premise `"high human value"`.
- Snapshot/string test that `JobDetailPanel` copy no longer contains `"Train for this"`.

---

### PR-3 — Dashboard: view every report, in full (Ray #4, part 1)

**Intent:** every saved report is readable *inside* the dashboard, at full fidelity. This is the prerequisite for export — you cannot print what you cannot render.

**Changes**

1. **Extract presentational report renderers** (no behaviour change to the existing modals) into `src/components/reports/`:
   - `ScenarioReport.tsx` — from `ScenarioModal.tsx`
   - `RoadmapReport.tsx` — from `RoadmapModal.tsx:120-190` (`phases`, `resources`, `successMetrics`)
   - `SkillsReport.tsx` — from `SavedReports.tsx:29-50`, unchanged fields
   - `StartupIdeasReport.tsx` — **full fidelity**, from `StartupIdeasModal`: founder profile (`summary`, `coreSkills`, `domains`, `unfairAdvantages`, `gaps`), all ideas, and for the top three every execution field in `StartupTopThreeSchema`/`StartupDetailSchema` (`validation48h`, `mvp7day`, `launch30day`, `revenue90day`, `techStack`, `firstCustomers`, `outreachScript`, `killCriteria`, `mvpPlan`, `firstCustomerPath`, `pricingModel`, `pathTo10kMrr`, `pathToScale`, `risks`, `validation`, `applicableSkills`, `skillsNeeded`), plus `startHere`.

   Each takes exactly one prop (its payload type), renders no modal chrome, holds no state, and applies `data-print-card` to each logical block so the existing print CSS paginates cleanly.

   *Why extraction rather than duplication:* `SavedReports.tsx` today re-implements a lossy second copy of two renderers, which is precisely how it drifted out of sync. One renderer per report kind, used by both the modal and the dashboard, makes the drift structurally impossible.

2. `src/components/dashboard/SavedReports.tsx`
   - **Delete the navigate-away behaviour** (`:100-104`). All four kinds open the in-dashboard viewer.
   - Keep "Open this role" as a *secondary* action on role-based reports, so the map path Ray may already rely on is preserved rather than removed.
   - The viewer Modal gains `printable` (see PR-4).

3. `src/components/Modals/RoadmapModal.tsx`, `ScenarioModal.tsx`, `StartupIdeasModal.tsx` — swap their inline bodies for the extracted components. Pure refactor; generation, caching, and save paths untouched.

**Acceptance criteria**
- All four report kinds open and render fully inside `/dashboard` without navigation.
- A saved Startup Ideas report displays every stored field; nothing in the payload is unreachable from the UI.
- Existing modals look and behave exactly as before.

**Tests**
- Extend `dashboardSelectors.test.ts` (or add `reports.test.ts`) with pure-function coverage of any payload-shaping helpers introduced.
- Guard the fidelity regression: a test asserting the Startup Ideas renderer references every key in `StartupTopThreeSchema`, so future fields cannot be silently dropped again. *(Implement by reading the schema's `shape` keys — no DOM required, consistent with this repo's pure-logic test convention.)*

---

### PR-4 — Print and download (Ray #4, part 2)

**Intent:** every report leaves the app as a document.

**Changes**

1. `src/utils/reportExport.ts` (new, pure, fully unit-testable):
   ```ts
   export function reportToMarkdown(artifact: StoredArtifact): string
   export function reportFilename(artifact: StoredArtifact, ext: 'md'): string
   ```
   - One `case` per `ArtifactKind`, each emitting a clean `#`/`##`/bullet document with a title, the role (when role-based), the saved date, and every payload field.
   - Filename pattern: `future-of-jobs-{kind}-{role-slug-or-'resume'}-{YYYY-MM-DD}.md`.
   - Pure string in / string out. No DOM, no network — the entire export is covered by unit tests.

2. `src/components/dashboard/SavedReports.tsx` — viewer modal gains:
   - `printable` on the `Modal` (reusing `index.css:141-196`).
   - **Print** button → `window.print()`.
   - **Download .md** button → `Blob` + object URL + `<a download>` + `URL.revokeObjectURL`.
   - Both in the modal footer, matching the existing button styling in `StudentGuideModal.tsx:126-141`.

3. `src/index.css` — generalise the print block: its comment currently scopes it to "Student Guide". Add light-background/dark-text overrides for the report renderers so a printed report is legible on paper, and confirm `[data-print-card]` covers the new blocks. **Do not fork the ruleset.**

4. Print header: a `print:block hidden` header inside the viewer (title, role, date, `futureofjobs.vercel.app`), mirroring `StudentGuideModal.tsx:146-151`, so a printed page is self-identifying.

**Acceptance criteria**
- Every report kind prints to a clean, paginated, legible page with no app chrome, no dark background, and no clipped scroll containers.
- "Save as PDF" from the browser print dialog produces a usable PDF for all four kinds.
- `.md` download contains 100% of the payload.
- Bundle size: no new runtime dependency.

**Tests (`src/__tests__/reportExport.test.ts`)**
- One test per kind: every payload field appears in the Markdown output.
- Empty/partial payloads degrade gracefully (no `undefined`, no thrown error) — `catch([])`/`.default('')` in the schemas means fields legitimately can be empty.
- Filename slugging: spaces, `&`, `/`, and non-ASCII produce a safe filename.

**Manual verification (required — print CSS cannot be unit-tested)**
Print-preview all four kinds at A4 and Letter; confirm pagination, contrast, and that `[data-print-card]` prevents mid-block breaks.

---

### PR-5 — Personal training stops rewriting occupation-level risk (§2.2)

**Ship only after §2.2 is approved.** Isolated deliberately so PRs 1-4 are not blocked by it.

**Changes**
- `src/store.ts:257-268` — `upskillTask` no longer mutates `state.jobs`.
- `src/App.tsx` — `reapplyUpskillCompletions` becomes a personal-overlay rehydration rather than a score re-application.
- `src/components/JobDetailPanel.tsx` — task cards read the personal overlay for the "Trained" state (already driven by `completedTaskNames`, `:52-56`) and display personal exposure separately from the occupation's risk %.
- `src/config/GameMechanics.ts` — retain constants; re-document them as *personal* adjustments.

**Acceptance criteria**
- A role's risk %, terrain height, and map colour are identical for a signed-out visitor and a user who has completed training. Occupation-level numbers derive only from BLS/O\*NET/Claude.
- The user still sees their own progress, and the dashboard Training Log is unchanged.

**Tests**
- Store test: `upskillTask` leaves `jobs[].tasks[].aiCapabilityScore` untouched.
- Store test: `automationCostIndex` is invariant across upskill completions.
- Existing `userStore.test.ts:214-219` continues to pass (it asserts the persistence path, which is unchanged).

---

## 4. Sequencing and verification

```
PR-1 (badges) ──┐
PR-2 (defend)  ─┼─→ independent, ship in any order
PR-3 (viewers) ─┴─→ PR-4 (export)   [PR-4 depends on PR-3's renderers]
PR-5 (model fix) ── after §2.2 sign-off; pairs with PR-2's copy
```

**Every PR must clear, before merge:**
```bash
npx tsc -b                # clean
npx vitest run            # 124 existing + new, all green
node scripts/audit.mjs    # 63/63
npm run lint              # ≤ 26 problems (no new)
```
Then the established workflow: feature branch → `gh pr create` → `gh pr checks --watch` → `gh pr merge --squash --delete-branch` → confirm the Production deployment for the merge commit.

**Live verification after PR-1 and PR-2** (Playwright against the deployed build, per the pattern used in PRs #35-#40): open `job-14`, assert the chip set is exactly `OES, OOH, O*NET, CLAUDE TASKS, CLAUDE FORECAST`, assert no `STATE OES`, assert the forecast tooltip contains "prediction", assert the panel contains no `"Train for this"` string.

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Confidence scores change for all 50 roles | **Expected, and correct** | `ONET_BONUS` has never applied (§1.2). Once PR-1 fixes the constant *and* replaces the `.includes('ONET')` test with a comparison against `DATA_SOURCES.ONET`, every role moves 0.75 → 1.0. `confidenceScore` is read by no component, so nothing user-visible changes; assert the new value in a test and state the before/after in the PR body. |
| `.includes('ONET')` left unfixed while the constant is corrected | Medium | Fixing only `constants.ts` repairs the badge but leaves the confidence bug alive and now *inconsistent* with the badge. PR-1 must change both sites together. |
| Print CSS regressions in the Student Guide | Medium | The guide shares the ruleset. Print-preview the Student Guide as part of PR-4's manual check. |
| Extraction refactor (PR-3) changes existing modal appearance | Medium | Extract verbatim first, commit, then extend `StartupIdeasReport` for full fidelity in a second commit, so any visual diff is bisectable. |
| Rewritten prompt returns lower-quality or non-existent courses | Medium | Keep the "real, currently existing" constraint; spot-check 3 roles across risk bands (high/medium/low) manually before merge. |
| Copy changes contradict the shipped PDF guide | Low | The student PDF describes features, not this copy. Re-check the mobile/updates PDF after PR-2 and reissue if it references "Train for this". |

---

## 6. Draft answers for Ray

Ray asked direct questions and deserves direct answers, not just a changelog.

> **On "TRAIN FOR THIS":** You're right, and it was worse than a labelling problem — thank you for catching it. The button was pointed at the high-risk tasks, but the instructions behind it told the AI the task was already a human strength, so the recommendations were being generated on a false premise. I'm reframing it as **"Defend this task"**: for an automatable task the goal isn't to learn to do it faster, it's to move into the judgment layer around it — supervising the AI's output, catching where it fails, owning the calls it can't make. That's the distinction from the Roadmap, which handles the whole-career pivot. I'm also fixing the contradiction you spotted, where the strategy line said "reduce focus" on the very task the button offered training for.

> **On the badges:** Also right, and it uncovered a bug. The O\*NET badge existed in the code but could never appear — the identifier didn't match what the data actually says, so it silently never rendered for any role. It's fixed, and I'm adding the regression test that should have caught it. I'm also adding the O\*NET marker to 13 roles that were missing it despite having real O\*NET tasks. Where a role's tasks come from a closely-related occupation rather than an exact match, the tooltip now says so. And you're right about STATE OES: that's map data, so it no longer shows on the role panel.

> **On "guess":** Agreed, changed to "prediction", and the tooltip now names BLS OOH as the anchor it's built on.

> **On the dashboard:** This is the most useful note in your email. Right now you can't print or download anything, and Career Roadmap can't even be *viewed* from the dashboard — it bounces you back to the map. I'm making all four report types readable in place, at full detail (the Startup Ideas view was quietly dropping most of each plan), and adding **Print / Save as PDF** and **Download** to each one. You're right that this is where the dashboard's value actually is.

---

## 7. Explicitly out of scope

- Migrating `dataSources` from strings to a typed enum. Correct long-term, but a cross-cutting refactor that would bury four user-visible fixes.
- Adding CPS or other new provenance chips.
- Re-generating O\*NET task data or resolving the 13 proxy roles to exact SOC matches (a data-pipeline task, not a UI one).
- Bulk "export entire dashboard" — worth doing once single-report export is proven; noted for a follow-up.
- `.docx`/`.json` export formats, pending §2.4.
