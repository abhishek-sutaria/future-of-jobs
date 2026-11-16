# Course matches (Step 2 of 3)

Step 1 built a catalog of real courses, each with a checked link
(`data/course_catalog/catalog.json`, see `docs/course-catalog.md`). This step
matches catalog courses to the 783 scored jobs. The result is
`data/course_catalog/matches.json`: `matches` maps each SOC code to 0 to 5
`{ id, reason }`. It is offline data: nothing in the app reads it yet (Step 3).

**The rule: match only what truly fits.** The catalog is 98% Microsoft and Google
technology training, so most jobs get `[]`. That is the intended result. In
Step 3 those jobs keep the #99 course buttons, which always work.

## How it works

1. **Job profile, from O*NET 30.1** (`data/db_30_1_text/`): the job's
   description, up to 10 tasks (Core first, in O*NET order) and up to 15
   technology skills (Hot Technology first), over every O*NET code the job's
   score used (`src/data/ai_scores_bls.json`).
2. **Shortlist, local and free:** the 30 catalog entries that share the most
   rare words with the job. This is BM25 over each entry's title (counted 3
   times), tags (twice) and description. The job title weighs 3, technology 2
   and tasks 1. Two kinds of entry are never offered:
   - 35 entries whose own description says they are retired or will retire. The
     Step 1 retired check only knew one wording; this should also be fixed in
     PR #100.
   - 25 generic Microsoft Office Specialist certifications (Word, Excel,
     Outlook, PowerPoint, Access, Microsoft 365 Apps). Excel for Accounting and
     Excel for Business Finance stay, because they teach a subject.
3. **Claude picks 0 to 5** from the shortlist. Model: `claude-sonnet-5` (the
   app's model), thinking off, sent through the Message Batches API (half
   price). The answer is structured JSON. Claude may only return IDs from the
   shortlist. An ID that is not on the shortlist, a duplicate, a pick with no
   reason, or a sixth pick is rejected and logged. The prompt is
   `SYSTEM_PROMPT` in `scripts/lib/courseMatch.ts`, version `course-match-v3`.
4. **Build check:** `matches.json` is written only if every ID is in
   `catalog.json`, with at most 5 per job, each once and each with a reason. A
   unit test checks the committed file the same way.

Every answer is in `data/course_catalog/match_responses.json`, with its
shortlist, tokens, kept picks and rejected picks. Every Claude API use is in
`data/course_catalog/match_runs.json`, with real tokens and dollars.

## Cost

Prices for `claude-sonnet-5` through Batches: $1 per million input tokens and $5
per million output tokens.

- **Estimate first:** I counted every request with the free token-count
  endpoint. That came to 4,508,677 input tokens for all 783 jobs, about $5.68
  (worst case $8.52), under the $10 cap.

| Run | Prompt | Jobs | Input tokens | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| Pilot | v1 | 20 | 115,182 | 3,990 | $0.135 |
| Pilot | v2 | 20 | 118,562 | 2,591 | $0.132 |
| Full run | v2 | 763 | 4,522,442 | 45,519 | $4.750 |
| Re-run, Office certifications removed | v2 | 113 | 653,280 | 9,132 | $0.699 |
| Re-run, stricter prompt | v3 | 138 | 809,260 | 16,696 | $0.893 |
| **Total** | | | **6,218,726** | **77,928** | **$6.61** |

Each batch finished in 1 to 3 minutes.

## How the prompt and rules were tightened

- **v1 → v2, after the pilot:** v1 gave generic Office certifications to
  nurses and retail staff. It gave admin and implementer courses to people
  who only use the product (Google Workspace admin for HR). One reason
  invented a task ("nurses track patient data in Excel"). v2 added "does not
  fit" rules for each.
- **Office certifications removed, after the first 25-match check:** only 8 of
  25 matches were truly relevant. 300 of 610 matches were generic Office
  Specialist certifications given to 113 jobs (freight agents, file clerks,
  production supervisors). O*NET lists Office for almost every job. I removed
  them from the shortlist and re-ran only those 113 jobs.
- **v2 → v3, after the second check:** 13 of 25 were relevant. The weak ones
  came from tools that are only in O*NET's long tool list (a SQL course for
  teaching assistants, Kafka for management analysts), generic AI assistant
  courses, and a fitness certification for ambulance drivers. v3 adds a rule
  for each. Only the 138 jobs that had matches were re-run. A stricter prompt
  cannot add a match, so the 645 jobs v2 found nothing for keep their `[]`,
  marked `course-match-v2` in `match_responses.json`.
- **Third check, on the final file:** 21 of 25 were relevant (16 clearly, 5
  reasonable). The 4 weak ones were GitHub and TensorFlow for "Biological
  Scientists, All Other", a Gemini NDA-drafting course for lawyers, and an ACE
  certification for athletic trainers.

## Coverage

Final: **92 of 783 jobs have at least one match** (221 matches, 2.4 per
matched job). 691 jobs have none.

| SOC group | Jobs | With a match | None |
| --- | --- | --- | --- |
| 11 Management | 36 | 9 | 27 |
| 13 Business and Financial Operations | 32 | 17 | 15 |
| 15 Computer and Mathematical | 21 | 17 | 4 |
| 17 Architecture and Engineering | 35 | 1 | 34 |
| 19 Life, Physical, and Social Science | 47 | 10 | 37 |
| 21 Community and Social Service | 13 | 2 | 11 |
| 23 Legal | 7 | 2 | 5 |
| 25 Educational Instruction and Library | 60 | 8 | 52 |
| 27 Arts, Design, Entertainment, Sports, and Media | 36 | 3 | 33 |
| 29 Healthcare Practitioners and Technical | 69 | 5 | 64 |
| 31 Healthcare Support | 17 | 2 | 15 |
| 33 Protective Service | 23 | 0 | 23 |
| 35 Food Preparation and Serving Related | 15 | 0 | 15 |
| 37 Building and Grounds Cleaning and Maintenance | 8 | 0 | 8 |
| 39 Personal Care and Service | 29 | 1 | 28 |
| 41 Sales and Related | 21 | 3 | 18 |
| 43 Office and Administrative Support | 50 | 11 | 39 |
| 45 Farming, Fishing, and Forestry | 11 | 0 | 11 |
| 47 Construction and Extraction | 57 | 0 | 57 |
| 49 Installation, Maintenance, and Repair | 50 | 0 | 50 |
| 51 Production | 100 | 0 | 100 |
| 53 Transportation and Material Moving | 46 | 1 | 45 |

## How to re-run

```sh
npx tsx scripts/match_course_catalog.ts --shortlist 13-2011      # one job's prompt and 30 candidates (no API)
npx tsx scripts/match_course_catalog.ts --estimate               # free token count and cost estimate
npx tsx scripts/match_course_catalog.ts --run --max-usd 10       # every job without a current answer, only if under the cap
npx tsx scripts/match_course_catalog.ts --run --socs 13-2011,15-1252
npx tsx scripts/match_course_catalog.ts                          # rebuild matches.json from the saved answers (no API)
```

It uses the scoring key (`FOJ_SCORING_API_KEY` or `~/.foj_scoring_key`, plus
the workspace ID; see `scripts/lib/scoringAuth.ts`). If the catalog changes
(for example after the retired-entries fix in #100), re-run the jobs whose
shortlist changed. A new prompt version means re-running every job.
