# Scoring decisions for all 830 jobs

Decided by the owner on 2026-11-07, and on 2026-11-08 ("one method for every scored role"). This file records them, so later work can point here.

The plan itself is in `data/bls_score_plan_all.json`: **one row for every one of the 830 jobs, built by one set of rules**. It is built by `npm run generate-bls-scores -- --plan`, and `src/__tests__/scorePlanAll.test.ts` checks it.

## One method for every scored role (decided 2026-11-08)

An audit found that the 736 published scores all follow one method, and the 50 Kelley roles' first scores (`src/data/ai_scores.json`, Aug 2026) do not: 25 of 50 do not use the first 5 O*NET tasks, 22 of 50 have task text that is not in O*NET 30.1 (47 of 250 tasks; BI Analyst, PR Manager, Budget Analyst, IT Project Manager and UX Designer are mostly hand-written), Brand Manager uses 11-2011's tasks, and they used older growth and employment inputs, an older prompt, hand-rescaled forecasts and no prompt hash. **The owner decided: re-score the Kelley jobs with the same pipeline as the 736.**

- **The plan has a `kelley` batch.** The 47 BLS jobs the 50 Kelley titles map to are 47 rows with `"batch": "kelley"`, built exactly like every other row: the BLS title, OEWS May 2025 employment, EP 2025-35 growth, the same task rules, the same prompt builder. 44 use their own list, 2 use sub-codes (13-2099, 15-1299) and 1 is combined (13-1020 = 13-1021 + 13-1022 + 13-1023).
- **The 13 Business & Finance jobs are rows too** (`"batch": "business-finance"`), so every scored job has its row and its prompt hash. They were scored on 2026-11-01 and are never run again.
- **The 770 rows of the first plan are byte for byte as they were**, and come first (the test pins their SHA-256). `--family` and `--fields` only take rows with no batch, so they run exactly as before.
- **Controls for the Kelley batch** are 5 already-published Business & Finance jobs: 13-1074 Farm Labor Contractors (0.30, the lowest of the 13), 13-1199 Business Operations Specialists, All Other (0.40, sub-codes), 13-2020 Property Appraisers and Assessors (0.55, combined), 13-1031 Claims Adjusters (0.66) and 13-2081 Tax Examiners (0.73, the highest). Each is re-scored from its own plan row, whose prompt must hash to its published `promptSha256`, and compared with its published numbers. The run stops if the mean gap is over 5 points.
- **After the run, every Kelley title reads its tasks and scores from `ai_scores_bls.json` by its SOC**, like any other job. Titles that share a SOC (Marketing / Brand Manager, BI Analyst / Data Scientist, Wholesale & Retail Buyer / Purchasing Agent) get identical tasks and scores; they keep their own peaks and Kelley labels.
- **`src/data/ai_scores.json` stays in the repo as history only.** The build serves only its entries for Kelley titles whose SOC has no entry yet, so once the batch is in, the app reads nothing from it. Never write it again.
- **Until the batch is scored, nothing breaks:** each Kelley title keeps its first score, and Methodology says so. Tests prove both states; the after state uses a fake batch in a temporary file that is never committed (`src/__tests__/kelleyBatch.test.ts`, `kelleyBatchApp.test.tsx`).
- **A user's own re-score** (their own key, their browser only) still layers on top, but over a SOC entry only when it was made on the same tasks.

### The three Mac commands

Run them in the clone that holds the ledger (`data/ai_scores_bls_run.json`, gitignored), on this branch, with the key in `~/.foj_scoring_key` and the workspace in `~/.foj_scoring_workspace`:

```bash
# 1. Dry run: lists the 47 jobs with their tasks and the 5 controls. No calls.
npm run generate-bls-scores -- --batch kelley --dry-run

# 2. First run: the 5 controls, then 5 jobs (10 calls, up to 14 with retries).
npm run generate-bls-scores -- --batch kelley --direct --max-jobs 5 --max-calls 14

# 3. The rest: 42 jobs (up to 60 calls with retries).
npm run generate-bls-scores -- --batch kelley --direct --max-calls 60
```

The call cap and the ledger work as for every batch: each call is logged with its cost and the running total; the controls are cached under the batch name `kelley`, so run 3 does not repeat them; a job rejected twice is skipped, and after 4 failed calls it is not tried again; nothing is written to `src/data` until all 47 are scored. Then the run writes the 47 entries (the 736 stay byte for byte) and refreshes `src/__tests__/fixtures/kelley50_rank_change.json`. Then `npx vitest run`, `npm run build`, and commit those two files. Expected cost: 52 calls, about $0.50.

## What was scored first

- **13 Business & Finance jobs**: scored on 2026-11-01 (plan `data/bls_scoring_plan.json`, the same code).
- **723 jobs** in three family batches, 2026-11-07/08.
- **47 Kelley jobs**: first scored in Jul/Aug 2026 by an older method (`src/data/ai_scores.json`); re-scored by `--batch kelley`.

The first plan (2026-11-07) left out the 60 Kelley and Business & Finance jobs, so it had **770 rows**; the family table below counts those.

## Scoring order

| Order | Family (BLS SOC family) | Fields | To do | Can be scored | No O*NET tasks |
|---|---|---|---:|---:|---:|
| 1 | Management, Business, Science, and Arts | 11 to 29 | 320 | 301 | 19 |
| 2 | Sales and Office | 41, 43 | 71 | 66 | 5 |
| 3 | Service; Natural Resources, Construction, and Maintenance; Production, Transportation, and Material Moving | 31 to 39, 45 to 53 | 379 | 356 | 23 |
| | **All** | | **770** | **723** | **47** |

**Check: 60 scored + 723 can be scored + 47 with no tasks = 830.**

Note: `--family 1|2|3` uses this order, not the BLS family numbers. Here, family 2 is BLS family 3 (Sales and Office).

## Which tasks a job is scored on

Every job is scored on **5 O*NET tasks**, picked by one of four rules. The tasks are always real O*NET rows, copied word for word. Counts are of all 830 rows (the first plan's 770 had 693 / 20 / 10 / 47).

| Rule | When | Jobs |
|---|---|---:|
| Own code | The job has its own O*NET task list. Take its first 5. | 748 |
| Sub-codes | No own list, but O*NET has smaller codes under it (for example 11-9199.01). Take one task from each in turn, skipping repeats (see below). | 23 |
| Combined | No O*NET code at all, because O*NET splits the job into separate codes. Take one task from each split code in turn. The role panel names those codes. | 12 |
| No tasks | No O*NET tasks anywhere. **Not scored.** | 47 |

One exception: **39-5093 Shampooers** has only 4 tasks in O*NET, so it is scored on 4.

**Sub-codes skip repeated tasks.** Some sub-codes share tasks word for word. The occupations data keeps identical text once, under the first sub-code that has it (the others are listed in its `alsoIn`), so a sub-code job skips any task whose text exactly repeats another sub-code's task. Example: **19-3039** Psychologists, All Other. 19-3039.03 (Clinical Neuropsychologists) repeats 12 of the 14 tasks of 19-3039.02 (Neuropsychologists): its first six tasks in O*NET order are all repeats. So .03 starts at its first task of its own (22215), and the 5 tasks are .02 22193, .03 22215, .02 22206, .03 22212, .02 22202. The same text is in the plan's `taskRules["sub-codes"]`.

## The combine rule

Some jobs have one code at BLS, but O*NET splits them into several codes. These jobs are scored on the split codes' tasks: one from each code in turn, each code in O*NET file order. This is the same code and the same rule as 13-2020 Property Appraisers and Assessors (13-2022 + 13-2023), already scored. The table is `ONET_CODES_FOR_SOC` in `src/config/onetSplitCodes.ts`, with each code's O*NET title for the role panel.

**Kelley (1 job, added 2026-11-08)**

- **13-1020** Buyers and Purchasing Agents (Wholesale & Retail Buyer, Purchasing Agent): 13-1021 + 13-1022 + 13-1023

How they were found: we listed every O*NET 30.1 code whose job is not one of the 830 BLS jobs. Each one with tasks is now either used below or explained.

**Family 1 (4 jobs)**

- **21-1018** Substance Abuse, Behavioral Disorder, and Mental Health Counselors: 21-1011 + 21-1014
- **25-2052** Special Education Teachers, Kindergarten and Elementary School: 25-2055 + 25-2056
- **25-9045** Teaching Assistants, Except Postsecondary: 25-9042 + 25-9043
  - 25-9049 (All Other) has 0 tasks, so it adds nothing.
  - **25-9044 is not used.** It is Teaching Assistants, Postsecondary, which is its own BLS job.
- **29-2010** Clinical Laboratory Technologists and Technicians: 29-2011 + 29-2012

**Family 3 (6 jobs)**

- **31-1120** Home Health and Personal Care Aides: 31-1121 + 31-1122
- **39-7010** Tour and Travel Guides: 39-7011 + 39-7012
- **47-4090** Miscellaneous Construction and Related Workers: 47-4091 + 47-4099.03 (Weatherization Installers)
  - 47-4099 has no tasks of its own, so its one sub-code with tasks is used, as the sub-code rule does elsewhere. **Owner to confirm.**
- **51-2028** Electrical, Electronic, and Electromechanical Assemblers: 51-2022 + 51-2023
- **51-2090** Miscellaneous Assemblers and Fabricators: 51-2092 only
  - 51-2099 (All Other) has 0 tasks.
- **53-1047** First-Line Supervisors of Transportation and Material Moving Workers: 53-1042 + 53-1043 + 53-1044
  - 53-1049 (All Other) has 0 tasks.

**Families 1 and 2 have no other cases.** Family 2 has none.

**Split codes not used, and why**

- 29-2011.01, .02, .04, 29-2012.01 and 53-1042.01: sub-codes of codes that have their own task lists. The own list wins, as everywhere else.
- 11-1031 Legislators and 45-3031 Fishing and Hunting Workers: BLS publishes no pay or job data for them, so they are not among the 830.
- 55-xxxx military codes: no tasks, and not among the 830.

## Jobs not scored: "All Other" jobs with no O*NET tasks (47)

These show **"Not scored"** (the legend and hover say "Not scored · no O*NET tasks"), because nothing more is coming for them. Each one has no O*NET code and no split codes with tasks. (Until every other job was scored they said "not scored yet".)

**Family 1 (19):** 11-9039 Education Administrators, 17-3019 Drafters, 19-1099 Life Scientists, 21-1019 Counselors, 21-1029 Social Workers, 21-1099 Community and Social Service Specialists, 21-2099 Religious Workers, 23-2099 Legal Support Workers, 25-1069 Social Sciences Teachers, Postsecondary, 25-1199 Postsecondary Teachers, 25-3099 Teachers and Instructors, 25-9099 Educational Instruction and Library Workers, 27-1019 Artists and Related Workers, 27-1029 Designers, 27-2099 Entertainers and Performers, Sports and Related Workers, 27-3099 Media and Communication Workers, 27-4099 Media and Communication Equipment Workers, 29-1029 Dentists (All Other Specialists), 29-1249 Surgeons. All are "All Other".

**Family 2 (5):** 41-9099 Sales and Related Workers, 43-2099 Communications Equipment Operators, 43-3099 Financial Clerks, 43-4199 Information and Record Clerks, 43-9199 Office and Administrative Support Workers. All are "All Other".

**Family 3 (23):** 33-1099 First-Line Supervisors of Protective Service Workers, 35-2019 Cooks, 35-9099 Food Preparation and Serving Related Workers, 37-2019 Building Cleaning Workers, 37-3019 Grounds Maintenance Workers, 39-3019 Gambling Service Workers, 39-3099 Entertainment Attendants and Related Workers, 39-9099 Personal Care and Service Workers, 45-2099 Agricultural Workers, 45-4029 Logging Workers, 47-3019 Helpers, Construction Trades, 47-5049 Underground Mining Machine Operators, 47-5099 Extraction Workers, 49-9069 Precision Instrument and Equipment Repairers, 51-3099 Food Processing Workers, 51-4199 Metal Workers and Plastic Workers, 51-6099 Textile, Apparel, and Furnishings Workers, 51-7099 Woodworkers, 51-9199 Production Workers, 53-3099 Motor Vehicle Operators, 53-4099 Rail Transportation Workers, 53-6099 Transportation Workers, 53-7199 Material Moving Workers. All are "All Other".

Some "All Other" jobs **are** scored, because O*NET has sub-codes with tasks for them (for example 11-9199 Managers, All Other). Those use the sub-code rule.

Because of these 47 jobs, most fields will never be "fully scored". Only 13, 15 and 31 can be. Any text that says a whole field is in colour must allow for that.

## Ranks and percentiles (decided 2026-11-08: one scale for all)

Owner's call: "Compare everything to all the roles, not only Kelley." Since 2026-11-08 every rank, label and colour uses **all scored occupations together, each BLS code once**. Score **values** never change; only where a role sits among the others.

**Who is counted.** Every scored BLS occupation once: **783** (`SCORE_COUNTS.ranked`), before and after the Kelley batch.

- Three BLS occupations hold two Kelley titles each: 11-2021 (Marketing Manager, Brand Manager), 15-2051 (Business Intelligence Analyst, Data Scientist) and 13-1020 (Wholesale & Retail Buyer, Purchasing Agent). Each counts once.
- A Kelley title takes its SOC's rank. Once the Kelley batch is in, both titles of a SOC have that SOC's numbers, so this is exact. Until then each title still has its own first score: the SOC's one point is the mean of its two titles, and each title's own label is worked out from its own numbers on that scale.
- Every "among all N" text comes from the data (`rankScopeText`: "among all 783 scored occupations").

**The rules** (`src/utils/roleScale.ts`), the same as before, only over all occupations:

- Human Resilience: mean Human Criticality at or above the 75th percentile is Future-Proof, at or above the 25th is High, below is At Risk. Means are compared at 4 decimals (exact for five or four two-decimal scores), so float noise never breaks a tie.
- Salary volatility label: Automation Risk percentiles 50 and 75, as before.
- Colour bands: thirds (terciles) of Automation Risk; the continuous ramp runs from the 5th to the 95th percentile. The role panel's risk gauge and its % use the same band function and colours as the hill (they used fixed 30% / 60% cut-offs before, which disagreed with the hill for 276 of 786 roles). Each label's tooltip shows its cut-offs, so a "Future-Proof" role on a red hill, or 84% shown both as Future-Proof and High, explains itself.
- Every % on screen is rounded once from whole hundredths, halves up (`src/utils/scoreRounding.ts`). Shampooers' Human Criticality of exactly 72.5% shows as 73% (float rounding showed 72%).

**What changed for the 50 Kelley roles.** `scripts/rank_table.ts` writes the before/after table to `src/__tests__/fixtures/kelley50_rank_change.json` (checked by `rankScale.test.ts`); `--batch kelley` re-runs it. With the first scores on the 783 scale, 26 of 50 Human Resilience labels and 30 of 50 colour bands differ from the old 50-only rule; the cut-offs move from 0.600 / 0.712 to 0.650 / 0.844, and the colour bands from 0.50 / 0.56 to 0.25 / 0.43. These change again when the Kelley batch is in.

**Removed:** the "Compared with the 50 Kelley roles" line on other occupations' panels.

## One common app for all scored roles (decided 2026-11-08)

- Every scored role opens the same panel with the same features as a Kelley role (Analyze / Strategic Insight, Roadmap, Scenario, Defend / Build, Save role, Human Resilience, the task view). Kelley-only facts are small labels on Kelley roles only.
- The 47 "All Other" jobs with no O*NET tasks keep the numbers-only panel and say "Not scored". They never call Claude.
- **Source badges only where the data is in the repo.** The OOH badge shows on Kelley roles only: the repo's OOH extract covers them only. Other roles show OES, Pay, EP, O*NET and Claude tasks.
- **State map: every job (2026-11-10).** The state map now covers all 830 jobs from one file, the official BLS OEWS May 2025 state file (oesm25st.zip), Kelley included; the May 2023 workbook is still not used. Method, coverage and the small changes to the Kelley data: `docs/state-map.md`.
- **Live Claude answers are saved once and shared, when saving is on** (it needs `SUPABASE_SERVICE_ROLE_KEY` and migration 0003; until then each visitor gets a fresh answer, and the note under the answer says so). Every text that mentions saving says "when saving is on". See `README.md`, "Claude gateway and shared answers".
- **A failed Claude answer costs the visitor nothing.** If Claude's answer fails or is rejected, the gateway gives the visitor's hour and day slots back (migration `0004_rate_give.sql`; until it is applied, the slot stays used). The whole-app daily ceiling still counts the call, since it was paid for. The browser retries a rejected answer once, never more, so one click costs at most 2 calls.

## How a run works (no calls in this PR)

- **Route:** `--direct` calls `https://api.anthropic.com/v1/messages` itself.
  - Key: `FOJ_SCORING_API_KEY`, or else the file `~/.foj_scoring_key`.
  - Workspace: `FOJ_SCORING_WORKSPACE`, or else the file `~/.foj_scoring_workspace`.
  - It never reads `ANTHROPIC_API_KEY`.
  - `--proxy <url>` still works as before. The request body is byte-identical either way.
- **Same settings as the published scores:** claude-sonnet-5, the same prompt, thinking disabled, max_tokens 4096.
- **Controls:** each batch first re-scores 5 published roles (never published). `--family` / `--fields` use 5 Kelley roles against `ai_scores.json`; `--batch kelley` uses 5 published Business & Finance jobs against `ai_scores_bls.json`. It stops if the average gap is over 5 points.
- **Limits:**
  - `--max-calls N` limits calls per run (default 30). Anything above 450 is refused.
  - `--max-jobs N` limits how many new jobs one run scores.
- **Ledger:** every call goes into `data/ai_scores_bls_run.json` (gitignored), with its tokens, cost and the running total.
  - A re-run skips jobs already scored (in the ledger, or already in `ai_scores_bls.json`; a published entry is never replaced).
  - A job whose answer is rejected twice is skipped and the run goes on.
  - After 4 failed calls, a job is not tried again.
- **Writing scores:** nothing is written to `src/data/ai_scores_bls.json` until the whole batch is scored. Then the new jobs are added, and the existing entries stay byte for byte.
- **The old Business & Finance mode** (no `--family`, `--fields` or `--batch`) rewrites the whole file with its 13 entries only, so it now refuses to run once the file holds anything else.

## Cost estimate (no calls made, 2026-11-07)

Based on the Business & Finance run: 1,208 input + 721 output tokens per call, $2 / $10 per million tokens, about 7 s per call. Input tokens are scaled by each job's prompt length.

| Family | Jobs | Normal | +15% retries | Time |
|---|---:|---:|---:|---:|
| 1 | 301 | $2.90 | $3.34 | about 35 min |
| 2 | 66 | $0.63 | $0.73 | about 8 min |
| 3 | 356 | $3.42 | $3.94 | about 42 min |
| All | 723 | $6.96 | $8.00 | about 84 min |
| Kelley (2026-11-08) | 47 | $0.45 | $0.52 | about 5 min |

Controls add 5 calls per batch, about $0.05. The three family batches really cost $7.16 (745 calls, ledger).

## After scoring: what needed updating (done in PR #90 on 2026-11-07)

Tests that go red once the new scores are in (found with fake scores in a private copy):

- `blsScores.test.tsx`: "never holds a partial set", "scores no occupation outside Business & Finance", "has all 13…", "every one of the 32 occupations in the field resolves to a score" (fields 15 and 31 also become fully scored), "leaves every other field exactly as it was".
- `occupationPanel.test.tsx`: "lists each O*NET task verbatim, or says there is no list". Its list of no-task jobs that have scores grows from 13-1020 + 13-2020 to also include the 10 combined jobs.
- `stage.test.ts`: "an all-grey field bakes to nothing else". It uses field 47, which will no longer be all grey.

User-facing text to update:

- **Coverage text:** `SCORE_COVERAGE` and `BUSINESS_FINANCE_FULLY_SCORED` in `src/utils/blsScores.ts`. This text is used by the OccupationPanel and the IntroModal.
- **Legend:** "Scored: 50 Kelley roles + all Business & Finance", and "Not scored yet · AI scores coming soon".
- **Methodology:** the coverage items, "The state map and the task view cover the 50 Kelley roles", the Business & Finance scoring note, "Relative labels … against the other 49", and "The scores for all 50 roles…".
- **Student Guide:** `StudentGuideModal.tsx`, `public/student-guide.html` and `public/student-guide.pdf` (regenerate the PDF).
- **IntroModal:** "Slate peaks are scored soon".
- **Kelley comparison** in `BlsScoreSections.tsx` ("where it would sit among the 50"). It stays correct under the ranks rule, but check the wording.
- Also mention: GuidedTour, KelleyOnlyNote, and the Header re-score tooltip ("re-score the 50 Kelley roles").
