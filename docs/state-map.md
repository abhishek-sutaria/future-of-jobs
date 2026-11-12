# State map: data and coverage

Built by `npx tsx scripts/build_state_map.ts` (method in `scripts/lib/stateMap.ts`). Do not edit by hand: `--check` and `stateMap.test.ts` fail if this file is stale.

The state map (the Map view) shows, for every one of the app's 830 jobs, how many people BLS counts in that job in each state and the job's location quotient there. Pay is not on the map.

## Source

- **File**: BLS Occupational Employment and Wage Statistics (OEWS), May 2025, state estimates: https://www.bls.gov/oes/special-requests/oesm25st.zip (seen at https://www.bls.gov/oes/tables.htm).
- **Retrieved**: 2026-11-10. Zip sha256 `74d5be0e1df865517d22dc3bd1fc3a8af5f6f9e3052a2163143021505d8e04c6`.
- **Workbook**: `oesm25st/state_M2025_dl.xlsx`, committed unchanged as `data/oews_state/state_M2025_dl.xlsx`, sha256 `e9590ec791fd2941341631f84ee6445d3df931c1ad5776b80ea07c9f89fba95d`, sheet `state_M2025_dl`.
- **Rows used**: 36,168 detailed-occupation rows (O_GROUP "detailed"), all cross-industry (NAICS 000000, OWN_CODE 1235), in 54 areas: the 50 states, the District of Columbia, Guam, Puerto Rico and the Virgin Islands. These are the same 54 areas the map covered before; none added or dropped.
- **Columns**: `TOT_EMP` (employment, rounded by BLS to the nearest 10, self-employed not included) and `LOC_QUOTIENT` (the job's share of the state's jobs divided by its share of all U.S. jobs). No wage column is used.
- **Map coordinates**: the circle positions are US Census Bureau state centroids (`data/oews_state/area_centroids.json`), display only, not BLS data.

## Method (the same for every job)

- A job's rows are the file's rows whose `OCC_CODE` is the job's SOC code. Every one of the app's jobs uses its own code; nothing is added up, split or estimated.
- BLS's note in the workbook: "**  = indicates that an employment estimate is not available". A cell marked `**`, or a state with no row for the job, is left out. The map shows that state grey (apart from the employment colours), and its tooltip says "No data from BLS". The wage symbols (`*`, `#`) do not apply: the map shows no pay.
- In this file `TOT_EMP` and `LOC_QUOTIENT` are always both published or both `**`. Any other value stops the build.
- Rows are ordered by employment, largest first; states with the same employment are ordered by name, A to Z. The map labels its top 15 states.
- The 50 Kelley roles read `src/data/geo_real.json` (their 47 codes, the format the map has always used). Every job, Kelley included, is also in `src/data/state_map/<field>.json`, one chunk per field, loaded when the field (or the Map view) needs it. The test checks the two agree row for row.

## Coverage

| | Jobs |
|---|---:|
| Full map: BLS publishes the job in all 54 areas | 98 |
| Some areas hidden or not listed by BLS | 727 |
| No state data at all | 5 |
| **All jobs** | **830** |

- 202 jobs have data in all 50 states and DC (the territories aside).
- Cells: 34,850 published, 1,318 marked `**` by BLS, 8,652 with no row in the file (830 jobs x 54 areas = 44,820).
- Jobs with some areas hidden, by how many areas BLS publishes: 50 to 53 areas: 256; 40 to 49: 216; 20 to 39: 186; 1 to 19: 69.

### Jobs with no state data

The Map view shows "BLS publishes no state data for this job" for these, not an empty map.

- 13-1074 Farm Labor Contractors: marked `**` in 3 areas and not listed in the other 51.
- 29-1024 Prosthodontists: no row in the state file at all (BLS publishes it in the national file only).
- 51-2061 Timing Device Assemblers and Adjusters: marked `**` in 1 area and not listed in the other 53.
- 51-7031 Model Makers, Wood: marked `**` in 1 area and not listed in the other 53.
- 51-7032 Patternmakers, Wood: marked `**` in 1 area and not listed in the other 53.

### Combined codes

The 12 combined codes in `src/config/onetSplitCodes.ts` (BLS codes that O*NET splits into smaller codes) are single codes in OEWS, and the state file publishes each under that exact code. So each uses its own rows: no job counts are added up, and no pay is involved.

- 13-1020 Buyers and Purchasing Agents: the file's own 13-1020 rows, published in 53 of 54 areas (a Kelley code).
- 13-2020 Property Appraisers and Assessors: the file's own 13-2020 rows, published in 51 of 54 areas.
- 21-1018 Substance Abuse, Behavioral Disorder, and Mental Health Counselors: the file's own 21-1018 rows, published in 51 of 54 areas.
- 25-2052 Special Education Teachers, Kindergarten and Elementary School: the file's own 25-2052 rows, published in 52 of 54 areas.
- 25-9045 Teaching Assistants, Except Postsecondary: the file's own 25-9045 rows, published in 54 of 54 areas.
- 29-2010 Clinical Laboratory Technologists and Technicians: the file's own 29-2010 rows, published in 54 of 54 areas.
- 31-1120 Home Health and Personal Care Aides: the file's own 31-1120 rows, published in 54 of 54 areas.
- 39-7010 Tour and Travel Guides: the file's own 39-7010 rows, published in 52 of 54 areas.
- 47-4090 Miscellaneous Construction and Related Workers: the file's own 47-4090 rows, published in 43 of 54 areas.
- 51-2028 Electrical, Electronic, and Electromechanical Assemblers, Except Coil Winders, Tapers, and Finishers: the file's own 51-2028 rows, published in 49 of 54 areas.
- 51-2090 Miscellaneous Assemblers and Fabricators: the file's own 51-2090 rows, published in 52 of 54 areas.
- 53-1047 First-Line Supervisors of Transportation and Material Moving Workers, Except Aircraft Cargo Handling Supervisors: the file's own 53-1047 rows, published in 54 of 54 areas.

## Check against the earlier Kelley data

The earlier `geo_real.json` (47 Kelley codes) was built on 2026-08-29 from the BLS public API (https://api.bls.gov/publicAPI/v2/timeseries/data/), the same release (OEWS May 2025). It is kept unchanged as `data/oews_state/earlier_geo_real_bls_api.json`. Rebuilt from the state file by this method:

- Same states for all 47 codes, 2,411 rows: yes.
- Same employment in every row: yes.
- Same location quotient: 2,410 of 2,411 rows; 1 row differs (listed below).
- Same order: 25 of 47 codes; 22 list states with equal employment in another order.

## Changes from the earlier Kelley data

Decided 2026-11-10: every job, Kelley included, now reads the one official BLS state file, so all 830 jobs come from one source by one method. The Kelley roles change only in these ways:

- **Insurance Underwriters (13-2053), Nebraska**: location quotient 2.03 -> 2.04. The BLS API series gives 2.03; the BLS state file gives 2.04.
- **Operations Research Analysts (15-2031)**: shown on its own, its 15th circle label is now Arizona instead of Ohio (both 2,600 jobs; ties now go A to Z).
- **Tie order** (22 codes): states with equal employment are now listed A to Z. Numbers are unchanged; only the order of these rows moves, and only the circle label above is visible on the map.

  - 11-3051 Industrial Production Managers: 3,620 jobs: Iowa, Alabama -> Alabama, Iowa
  - 11-3061 Purchasing Managers: 40 jobs: Wyoming, Guam -> Guam, Wyoming
  - 11-3071 Transportation, Storage, and Distribution Managers: 2,410 jobs: Mississippi, Connecticut -> Connecticut, Mississippi
  - 11-3111 Compensation and Benefits Managers: 140 jobs: Nebraska, Arkansas -> Arkansas, Nebraska; 30 jobs: Puerto Rico, Alaska -> Alaska, Puerto Rico
  - 11-3121 Human Resources Managers: 1,290 jobs: Kansas, Arkansas -> Arkansas, Kansas
  - 11-3131 Training and Development Managers: 210 jobs: District of Columbia, Arkansas -> Arkansas, District of Columbia
  - 13-1082 Project Management Specialists: 3,190 jobs: Nebraska, Alabama -> Alabama, Nebraska
  - 13-1121 Meeting, Convention, and Event Planners: 550 jobs: Hawaii, Arkansas -> Arkansas, Hawaii
  - 13-1141 Compensation, Benefits, and Job Analysis Specialists: 180 jobs: Maine, Alaska -> Alaska, Maine
  - 13-1151 Training and Development Specialists: 3,650 jobs: Nebraska, Connecticut -> Connecticut, Nebraska
  - 13-2041 Credit Analysts: 370 jobs: Kentucky, Alabama -> Alabama, Kentucky; 300 jobs: North Dakota, Arkansas -> Arkansas, North Dakota; 40 jobs: Wyoming, Alaska -> Alaska, Wyoming
  - 13-2051 Financial and Investment Analysts: 190 jobs: Wyoming, Alaska -> Alaska, Wyoming
  - 13-2053 Insurance Underwriters: 100 jobs: New Mexico, Alaska -> Alaska, New Mexico
  - 13-2054 Financial Risk Specialists: 180 jobs: New Mexico, Alabama -> Alabama, New Mexico; 150 jobs: Kansas, Arkansas -> Arkansas, Kansas; 50 jobs: Montana, West Virginia, Alaska -> Alaska, Montana, West Virginia
  - 13-2099 Financial Specialists, All Other: 4,030 jobs: Pennsylvania, Colorado -> Colorado, Pennsylvania
  - 15-1211 Computer Systems Analysts: 11,330 jobs: Minnesota, Arizona -> Arizona, Minnesota
  - 15-1242 Database Administrators: 1,220 jobs: Wisconsin, Colorado -> Colorado, Wisconsin; 170 jobs: South Dakota, Puerto Rico -> Puerto Rico, South Dakota
  - 15-1254 Web Developers: 400 jobs: West Virginia, Arkansas -> Arkansas, West Virginia
  - 15-1255 Web and Digital Interface Designers: 1,060 jobs: Utah, Connecticut -> Connecticut, Utah; 130 jobs: Delaware, Alabama -> Alabama, Delaware; 30 jobs: Guam, Alaska -> Alaska, Guam
  - 15-2031 Operations Research Analysts: 2,600 jobs: Ohio, Arizona -> Arizona, Ohio; 550 jobs: Louisiana, Alabama -> Alabama, Louisiana
  - 15-2041 Statisticians: 2,480 jobs: Massachusetts, California -> California, Massachusetts; 780 jobs: Minnesota, Colorado -> Colorado, Minnesota; 570 jobs: Michigan, Arkansas -> Arkansas, Michigan; 80 jobs: Kansas, Kentucky, Maine, Mississippi, Alaska -> Alaska, Kansas, Kentucky, Maine, Mississippi
  - 41-3011 Advertising Sales Agents: 1,110 jobs: Utah, Colorado -> Colorado, Utah; 900 jobs: Iowa, Arkansas -> Arkansas, Iowa
- **No-data states** (every job, a look change, not a data change): a state where BLS publishes no number for the selected jobs is now a flat grey, with "No data from BLS" in the legend and the tooltip. Before, it was the same dark colour as a state with very few workers, so "hidden" and "few" looked alike.

## Files

| File | What |
|---|---|
| `data/oews_state/state_M2025_dl.xlsx` | the BLS workbook, unchanged |
| `data/oews_state/sources.json` | URL, retrieved date and sha256 of every input |
| `data/oews_state/area_centroids.json` | display coordinates of the 54 areas |
| `data/oews_state/earlier_geo_real_bls_api.json` | the earlier Kelley data, for the check above |
| `src/data/geo_real.json` | the Kelley codes (bundled as its own chunk, loaded at start) |
| `src/data/state_map/areas.json` | the 54 areas (in the main bundle) |
| `src/data/state_map/<field>.json` | one lazy chunk per field, 22 files, all 830 jobs |

