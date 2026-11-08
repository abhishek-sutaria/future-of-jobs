# Scoring decisions for the rest of the 830 jobs

Decided by the owner on 2026-11-07. This file records them, so later work can point here.

The plan itself is in `data/bls_score_plan_all.json`. It is built by `npm run generate-bls-scores -- --plan`, and `src/__tests__/scorePlanAll.test.ts` checks it.

## What is already scored (60 jobs, never planned again)

- **47 Kelley jobs**: the 50 Kelley roles map to 47 BLS jobs. Both buyer titles map to 13-1020, and two other pairs of titles also share a job. Scores are in `src/data/ai_scores.json`.
- **13 Business & Finance jobs**: scored on 2026-11-01. Scores are in `src/data/ai_scores_bls.json`.

That leaves **770 jobs**.

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

Every job is scored on **5 O*NET tasks**: the first 5 in the O*NET file, the same rule as the published scores. The tasks are always real O*NET rows, copied word for word.

| Rule | When | Jobs |
|---|---|---:|
| Own code | The job has its own O*NET task list. Take its first 5. | 693 |
| Sub-codes | No own list, but O*NET has smaller codes under it (for example 11-9199.01). Take one task from each in turn, skipping repeats (see below). | 20 |
| Combined | No O*NET code at all, because O*NET splits the job into separate codes. Take one task from each split code in turn. | 10 |
| No tasks | No O*NET tasks anywhere. **Not scored.** | 47 |

One exception: **39-5093 Shampooers** has only 4 tasks in O*NET, so it is scored on 4.

**Sub-codes skip repeated tasks.** Some sub-codes share tasks word for word. The occupations data keeps identical text once, under the first sub-code that has it (the others are listed in its `alsoIn`), so a sub-code job skips any task whose text exactly repeats another sub-code's task. Example: **19-3039** Psychologists, All Other. 19-3039.03 (Clinical Neuropsychologists) repeats 12 of the 14 tasks of 19-3039.02 (Neuropsychologists): its first six tasks in O*NET order are all repeats. So .03 starts at its first task of its own (22215), and the 5 tasks are .02 22193, .03 22215, .02 22206, .03 22212, .02 22202. The same text is in the plan's `taskRules["sub-codes"]`.

## The combine rule

Some jobs have one code at BLS, but O*NET splits them into several codes. These jobs are scored on the split codes' tasks: one from each code in turn, each code in O*NET file order. This is the same code and the same rule as 13-2020 Property Appraisers and Assessors (13-2022 + 13-2023), already scored.

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

- 13-1021, 13-1022, 13-1023: these belong to 13-1020, a Kelley job that is already scored.
- 29-2011.01, .02, .04, 29-2012.01 and 53-1042.01: sub-codes of codes that have their own task lists. The own list wins, as everywhere else.
- 11-1031 Legislators and 45-3031 Fishing and Hunting Workers: BLS publishes no pay or job data for them, so they are not among the 830.
- 55-xxxx military codes: no tasks, and not among the 830.

## Jobs not scored: "All Other" jobs with no O*NET tasks (47)

These keep showing **"not scored yet"**. Each one has no O*NET code and no split codes with tasks.

**Family 1 (19):** 11-9039 Education Administrators, 17-3019 Drafters, 19-1099 Life Scientists, 21-1019 Counselors, 21-1029 Social Workers, 21-1099 Community and Social Service Specialists, 21-2099 Religious Workers, 23-2099 Legal Support Workers, 25-1069 Social Sciences Teachers, Postsecondary, 25-1199 Postsecondary Teachers, 25-3099 Teachers and Instructors, 25-9099 Educational Instruction and Library Workers, 27-1019 Artists and Related Workers, 27-1029 Designers, 27-2099 Entertainers and Performers, Sports and Related Workers, 27-3099 Media and Communication Workers, 27-4099 Media and Communication Equipment Workers, 29-1029 Dentists (All Other Specialists), 29-1249 Surgeons. All are "All Other".

**Family 2 (5):** 41-9099 Sales and Related Workers, 43-2099 Communications Equipment Operators, 43-3099 Financial Clerks, 43-4199 Information and Record Clerks, 43-9199 Office and Administrative Support Workers. All are "All Other".

**Family 3 (23):** 33-1099 First-Line Supervisors of Protective Service Workers, 35-2019 Cooks, 35-9099 Food Preparation and Serving Related Workers, 37-2019 Building Cleaning Workers, 37-3019 Grounds Maintenance Workers, 39-3019 Gambling Service Workers, 39-3099 Entertainment Attendants and Related Workers, 39-9099 Personal Care and Service Workers, 45-2099 Agricultural Workers, 45-4029 Logging Workers, 47-3019 Helpers, Construction Trades, 47-5049 Underground Mining Machine Operators, 47-5099 Extraction Workers, 49-9069 Precision Instrument and Equipment Repairers, 51-3099 Food Processing Workers, 51-4199 Metal Workers and Plastic Workers, 51-6099 Textile, Apparel, and Furnishings Workers, 51-7099 Woodworkers, 51-9199 Production Workers, 53-3099 Motor Vehicle Operators, 53-4099 Rail Transportation Workers, 53-6099 Transportation Workers, 53-7199 Material Moving Workers. All are "All Other".

Some "All Other" jobs **are** scored, because O*NET has sub-codes with tasks for them (for example 11-9199 Managers, All Other). Those use the sub-code rule.

Because of these 47 jobs, most fields will never be "fully scored". Only 13, 15 and 31 can be. Any text that says a whole field is in colour must allow for that.

## Ranks and percentiles (decided 2026-11-08: one scale for all)

Owner's call: "Compare everything to all the roles, not only Kelley." Since 2026-11-08 every rank, label and colour uses **all scored roles together**. Score **values** never change; only where a role sits among the others.

**Who is counted.** Every scored role once:

- each of the 50 Kelley titles, with its own published tasks and scores, and
- each other scored BLS occupation (ai_scores_bls.json).

Three BLS occupations hold two Kelley titles each: 11-2021 (Marketing Manager, Brand Manager), 15-2051 (Business Intelligence Analyst, Data Scientist) and 13-1020 (Wholesale & Retail Buyer, Purchasing Agent). Each title was scored on its own five tasks and has its own numbers, so each title counts once as its own role. The BLS occupation itself is never counted again: no Kelley code is in ai_scores_bls.json. So **roles = Kelley titles + other scored occupations** (786 = 50 + 736 today), from **783 scored occupations**. The counts in the app come from `SCORE_COUNTS` (`roles`, `scored`, `kelleyTitles`, `sharedKelleySocs`), never typed in.

**The rules** (`src/utils/roleScale.ts`), the same as before, only over all roles:

- Human Resilience: mean Human Criticality at or above the 75th percentile is Future-Proof, at or above the 25th is High, below is At Risk. Means are compared at 4 decimals (exact for five or four two-decimal scores), so float noise never breaks a tie.
- Salary volatility label: Automation Risk percentiles 50 and 75, as before.
- Colour bands: thirds (terciles) of Automation Risk; the continuous ramp runs from the 5th to the 95th percentile.

**What changed for the 50 Kelley roles.** `scripts/rank_table.ts` writes the before/after table to `src/__tests__/fixtures/kelley50_rank_change.json` (checked by `rankScale.test.ts`). 25 of 50 Human Resilience labels and 30 of 50 colour bands change. Business roles score as more automatable than the economy as a whole, so most of them move toward At Risk and red: the Human Resilience cut-offs move from 0.600 / 0.712 to 0.650 / 0.840, and the colour bands from 0.50 / 0.56 to 0.25 / 0.43.

**Removed:** the "Compared with the 50 Kelley roles" line on other occupations' panels.

## One common app for all scored roles (decided 2026-11-08)

- Every scored role opens the same panel with the same features as a Kelley role (Analyze / Strategic Insight, Roadmap, Scenario, Defend / Build, Save role, Human Resilience, the task view). Kelley-only facts are small labels on Kelley roles only.
- The 47 "All Other" jobs with no O*NET tasks keep the numbers-only panel and say "Not scored". They never call Claude.
- **Source badges only where the data is in the repo.** The OOH badge shows on Kelley roles only: the repo's OOH extract covers them only. Other roles show OES, Pay, EP, O*NET and Claude tasks.
- **State map: Kelley roles only.** `src/data/geo_real.json` (BLS OEWS May 2025, from the BLS API) covers the 47 Kelley codes. The only file in the repo with state data for every occupation is `data/all_data_M_2023.xlsx`: an official BLS file, but **May 2023**, two years older (it has 829 of the 830 codes; 29-1024 is missing). It is not used, so one map never mixes two survey years. To add the other occupations, download the official OEWS May 2025 state file (`state_M2025_dl.xlsx`) into `data/` and build them from it the same way.
- **Live Claude answers are saved once and shared.** See `README.md`, "Claude gateway and shared answers".

## How a run works (no calls in this PR)

- **Route:** `--direct` calls `https://api.anthropic.com/v1/messages` itself.
  - Key: `FOJ_SCORING_API_KEY`, or else the file `~/.foj_scoring_key`.
  - Workspace: `FOJ_SCORING_WORKSPACE`, or else the file `~/.foj_scoring_workspace`.
  - It never reads `ANTHROPIC_API_KEY`.
  - `--proxy <url>` still works as before. The request body is byte-identical either way.
- **Same settings as the published scores:** claude-sonnet-5, the same prompt, thinking disabled, max_tokens 4096.
- **Controls:** each batch first re-scores 5 published Kelley roles (never published). It stops if the average gap is over 5 points.
- **Limits:**
  - `--max-calls N` limits calls per run (default 30). Anything above 450 is refused.
  - `--max-jobs N` limits how many new jobs one run scores.
- **Ledger:** every call goes into `data/ai_scores_bls_run.json` (gitignored), with its tokens, cost and the running total.
  - A re-run skips jobs already scored.
  - A job whose answer is rejected twice is skipped and the run goes on.
  - After 4 failed calls, a job is not tried again.
- **Writing scores:** nothing is written to `src/data/ai_scores_bls.json` until the whole batch is scored. Then the new jobs are added, and the existing entries stay byte for byte.

## Cost estimate (no calls made)

Based on the Business & Finance run: 1,208 input + 721 output tokens per call, $2 / $10 per million tokens, about 7 s per call. Input tokens are scaled by each job's prompt length.

| Family | Jobs | Normal | +15% retries | Time |
|---|---:|---:|---:|---:|
| 1 | 301 | $2.90 | $3.34 | about 35 min |
| 2 | 66 | $0.63 | $0.73 | about 8 min |
| 3 | 356 | $3.42 | $3.94 | about 42 min |
| All | 723 | $6.96 | $8.00 | about 84 min |

Controls add 5 calls per batch, about $0.05.

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
