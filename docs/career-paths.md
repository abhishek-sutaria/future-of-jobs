# Career paths data (O*NET Related Occupations)

Built by `npx tsx scripts/build_career_paths.ts` (method in `scripts/lib/careerPaths.ts`), checked by `python3 scripts/verify_career_paths.py`. Do not edit by hand: `--check` fails if this file is stale.

## What it is, and what it is not

The screen must call these links: **"Similar jobs you could move to (O*NET, by similar skills and work)"**.

It is **not** "where people actually moved". O*NET picks related jobs from what the jobs involve, not from data on people changing jobs. Every link is a row of the official O*NET file: no AI, no guessing, no similarity score of our own. A job O*NET has nothing for is stored as nothing, and the screen says "no data".

## Sources

O*NET 30.1 (December 2025 Release), National Center for O*NET Development, for the U.S. Department of Labor, Employment and Training Administration. Zip: https://www.onetcenter.org/dl_files/database/db_30_1_text.zip. License: CC BY 4.0 (Creative Commons Attribution 4.0 International License, https://www.onetcenter.org/license_db.html). The Read Me says: "The content of the O*NET 30.1 Database is licensed under a Creative Commons Attribution 4.0 International License."

Attribution to show with the data: "This page includes information from the O*NET 30.1 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA."

Every file is pinned by sha256 in `data/career_paths/sources.json`; the build and the verifier both stop on a mismatch.

- `data/db_30_1_text/Related Occupations.txt`: Related Occupations: for each O*NET-SOC code, 20 related codes with a relatedness tier and an index. sha256 `af539f6f01a36e9514a0dd13cbe125df8cca1114c690505342837f338621906c`
- `data/db_30_1_text/Job Zones.txt`: Job Zones: the preparation level (1 to 5) of each O*NET-SOC code. sha256 `7b13748f1d880dbbc6bd2a5f91bd457492f82c3f3bf9bd64909e73f600cd5fba`
- `data/db_30_1_text/Job Zone Reference.txt`: Job Zone Reference: the official name of each Job Zone (1 to 5). sha256 `0d705299759ff75785a3c503dc39da21db26ec652afac145c65736149d3744ea`
- `data/db_30_1_text/Occupation Data.txt`: Occupation Data: the O*NET title of each code (used only to name codes in docs/career-paths.md). sha256 `63e6029d3d30ff5c7cf39b5304a733b77a409e01c65ae7095fe92f6d18d74a66`
- `data/db_30_1_text/Read Me.txt`: The O*NET 30.1 Read Me: version banner, release date and license. sha256 `45cd3154c7f5e1e9ca3a0be6eb565c80acddc9bd7b63feeb76dfdd2e845a6c5f`

## How O*NET builds Related Occupations (its own words)

> The related occupations in this file are developed using an approach which includes three important contributors to occupational similarity: what people in the occupations do, what they know, and what they are called.
>
> Related Occupations - O*NET 30.1 Data Dictionary, https://www.onetcenter.org/dictionary/30.1/text/related_occupations.html

> The final occupational relatedness composite reflects the following components: (a) task- and detailed work activity (DWA)-based similarity, (b) knowledge importance similarity, and (c) alternate title similarity.
>
> Developing Related Occupations for the O*NET Program (April 2022), https://www.onetcenter.org/reports/Related_2022.html

The same data dictionary page defines the columns:

- Index: "Order of related code mappings based on expert review"
- Primary-Short: "Five most strongly related occupations after expert review."
- Primary-Long: "6th to 10th most strongly related occupations after expert review."
- Supplemental: "11th to 20th most strongly related occupations after expert review."

All of the above was fetched and copied word for word on 2026-11-22. The full 2022 method report (https://www.onetcenter.org/dl_files/Related_2022.pdf) was not read for this build.

## Method

**1. O*NET code to app job.** The same rules the app already uses:

- A `.00` code belongs to its own SOC (748 codes).
- A sub-code (`.01`, `.02`, ...) belongs to its parent SOC (143 codes). `scripts/build_occupations.py` joins O*NET on the seven-character SOC the same way.
- A code whose SOC the app only has inside a combined BLS code belongs to that combined job (30 codes): for example 13-1021, 13-1022 and 13-1023 all belong to 13-1020 Buyers and Purchasing Agents. The table is `src/config/onetSplitCodes.ts` (the scoring plan's table), read through `socRollup` in `scripts/lib/iuSchools.ts`, so all three builds use one rule.
- Any other code is unmapped: listed below, never forced onto a job (2 codes).

**2. Links.** Each row of Related Occupations.txt (a code and one related code) becomes a link between their two app jobs. 18,460 rows in all:

- 18,025 rows make links.
- 387 rows are self-links (both codes land on the same app job, for example two sub-codes of one SOC) and are dropped.
- 48 rows touch an unmapped code and are dropped.
- Rows that land on the same pair of jobs (from sub-codes) merge into one link: 2,523 rows merged away. The link keeps the strongest tier, then the lowest Index, and stores every row it came from (`rows`, line numbers in the file, header = line 1).
- A job's links are in O*NET's order: tier (Primary-Short, Primary-Long, Supplemental), then Index, then file line.

**3. Job Zone.** O*NET's preparation level, 1 to 5 (names from `Job Zone Reference.txt`: 1 "Job Zone One: Little or No Preparation Needed", 2 "Job Zone Two: Some Preparation Needed", 3 "Job Zone Three: Medium Preparation Needed", 4 "Job Zone Four: Considerable Preparation Needed", 5 "Job Zone Five: Extensive Preparation Needed").

- The job's own `.00` code's zone (748 jobs).
- Otherwise the sub-codes' zone, if they all agree (14 jobs).
- A combined job uses its parts' zones, each part's `.00` when it has one, if they all agree (8 jobs).
- Otherwise null, marked "mixed" (13 jobs, listed below).
- Where a job has its own `.00` zone, it wins over its sub-codes. 17 jobs have a sub-code with a different zone (listed below).

**4. Direction.** The screen shows "step up", "same level" or "step down" from the Job Zone difference (target minus current). With either zone missing, the direction is unknown and not shown.

## Coverage

- Jobs in the app: **830**
- Jobs with at least 1 link: **783 of 830**
- Jobs with 5 or more links: **783 of 830**
- Jobs with no O*NET data (no links, no zone): **47**
- Jobs with a Job Zone: **770**; mixed: **13**
- Links stored: **15,502** (Primary-Short 4,042, Primary-Long 3,823, Supplemental 7,637); median 19 per job, most 73
- Jobs whose links come from more than one O*NET code: **75**
- Direction of the stored links: up 3,463, same 8,084, down 3,153, unknown 802

## Jobs with no data

O*NET 30.1 has no Related Occupations or Job Zone row for any code of these 47 jobs, so nothing is stored for them. All are BLS "All Other" groups. They are exactly the 47 jobs with no O*NET tasks anywhere, the ones left not scored (docs/scoring-decisions.md, rule "No tasks").

11-9039 Education Administrators, All Other; 17-3019 Drafters, All Other; 19-1099 Life Scientists, All Other; 21-1019 Counselors, All Other; 21-1029 Social Workers, All Other; 21-1099 Community and Social Service Specialists, All Other; 21-2099 Religious Workers, All Other; 23-2099 Legal Support Workers, All Other; 25-1069 Social Sciences Teachers, Postsecondary, All Other; 25-1199 Postsecondary Teachers, All Other; 25-3099 Teachers and Instructors, All Other; 25-9099 Educational Instruction and Library Workers, All Other; 27-1019 Artists and Related Workers, All Other; 27-1029 Designers, All Other; 27-2099 Entertainers and Performers, Sports and Related Workers, All Other; 27-3099 Media and Communication Workers, All Other; 27-4099 Media and Communication Equipment Workers, All Other; 29-1029 Dentists, All Other Specialists; 29-1249 Surgeons, All Other; 33-1099 First-Line Supervisors of Protective Service Workers, All Other; 35-2019 Cooks, All Other; 35-9099 Food Preparation and Serving Related Workers, All Other; 37-2019 Building Cleaning Workers, All Other; 37-3019 Grounds Maintenance Workers, All Other; 39-3019 Gambling Service Workers, All Other; 39-3099 Entertainment Attendants and Related Workers, All Other; 39-9099 Personal Care and Service Workers, All Other; 41-9099 Sales and Related Workers, All Other; 43-2099 Communications Equipment Operators, All Other; 43-3099 Financial Clerks, All Other; 43-4199 Information and Record Clerks, All Other; 43-9199 Office and Administrative Support Workers, All Other; 45-2099 Agricultural Workers, All Other; 45-4029 Logging Workers, All Other; 47-3019 Helpers, Construction Trades, All Other; 47-5049 Underground Mining Machine Operators, All Other; 47-5099 Extraction Workers, All Other; 49-9069 Precision Instrument and Equipment Repairers, All Other; 51-3099 Food Processing Workers, All Other; 51-4199 Metal Workers and Plastic Workers, All Other; 51-6099 Textile, Apparel, and Furnishings Workers, All Other; 51-7099 Woodworkers, All Other; 51-9199 Production Workers, All Other; 53-3099 Motor Vehicle Operators, All Other; 53-4099 Rail Transportation Workers, All Other; 53-6099 Transportation Workers, All Other; 53-7199 Material Moving Workers, All Other.

## Unmapped O*NET codes

Codes in the O*NET files that are not one of the app's jobs. Their rows are dropped, both ways.

- 11-1031.00 Legislators: 20 rows from it, 2 rows to it.
- 45-3031.00 Fishing and Hunting Workers: 20 rows from it, 6 rows to it.

## Mixed Job Zones

- 11-9179 Personal Service Managers, All Other: 11-9179.01 zone 4, 11-9179.02 zone 3. Stored as null; direction unknown.
- 11-9199 Managers, All Other: 11-9199.01 zone 4, 11-9199.02 zone 4, 11-9199.08 zone 4, 11-9199.09 zone 3, 11-9199.10 zone 4, 11-9199.11 zone 4. Stored as null; direction unknown.
- 13-1020 Buyers and Purchasing Agents: 13-1021.00 zone 4, 13-1022.00 zone 3, 13-1023.00 zone 4. Stored as null; direction unknown.
- 13-2099 Financial Specialists, All Other: 13-2099.01 zone 5, 13-2099.04 zone 4. Stored as null; direction unknown.
- 15-1299 Computer Occupations, All Other: 15-1299.01 zone 4, 15-1299.02 zone 3, 15-1299.03 zone 4, 15-1299.04 zone 4, 15-1299.05 zone 4, 15-1299.06 zone 4, 15-1299.07 zone 4, 15-1299.08 zone 3, 15-1299.09 zone 4. Stored as null; direction unknown.
- 17-2199 Engineers, All Other: 17-2199.03 zone 4, 17-2199.05 zone 4, 17-2199.06 zone 5, 17-2199.07 zone 4, 17-2199.08 zone 4, 17-2199.09 zone 5, 17-2199.10 zone 4, 17-2199.11 zone 4. Stored as null; direction unknown.
- 17-3029 Engineering Technologists and Technicians, Except Drafters, All Other: 17-3029.01 zone 2, 17-3029.08 zone 3. Stored as null; direction unknown.
- 19-4099 Life, Physical, and Social Science Technicians, All Other: 19-4099.01 zone 3, 19-4099.03 zone 4. Stored as null; direction unknown.
- 29-1129 Therapists, All Other: 29-1129.01 zone 5, 29-1129.02 zone 4. Stored as null; direction unknown.
- 29-2010 Clinical Laboratory Technologists and Technicians: 29-2011.00 zone 4, 29-2012.00 zone 3. Stored as null; direction unknown.
- 31-9099 Healthcare Support Workers, All Other: 31-9099.01 zone 3, 31-9099.02 zone 2. Stored as null; direction unknown.
- 39-7010 Tour and Travel Guides: 39-7011.00 zone 3, 39-7012.00 zone 2. Stored as null; direction unknown.
- 53-1047 First-Line Supervisors of Transportation and Material Moving Workers, Except Aircraft Cargo Handling Supervisors: 53-1042.00 zone 2, 53-1043.00 zone 3, 53-1044.00 zone 3. Stored as null; direction unknown.

## A sub-code with a different zone from the job's own .00

The `.00` zone is used. Listed so the choice is visible.

- 11-3013 Facilities Managers: .00 zone 3; 11-3013.01 zone 4
- 11-3031 Financial Managers: .00 zone 4; 11-3031.03 zone 5
- 11-3051 Industrial Production Managers: .00 zone 4; 11-3051.02 zone 3, 11-3051.06 zone 3
- 11-9041 Architectural and Engineering Managers: .00 zone 5; 11-9041.01 zone 4
- 11-9121 Natural Sciences Managers: .00 zone 5; 11-9121.01 zone 4, 11-9121.02 zone 4
- 13-1041 Compliance Officers: .00 zone 4; 13-1041.04 zone 3, 13-1041.06 zone 3, 13-1041.08 zone 3
- 15-1211 Computer Systems Analysts: .00 zone 3; 15-1211.01 zone 5
- 15-1241 Computer Network Architects: .00 zone 4; 15-1241.01 zone 3
- 17-2112 Industrial Engineers: .00 zone 4; 17-2112.01 zone 5
- 17-3026 Industrial Engineering Technologists and Technicians: .00 zone 3; 17-3026.01 zone 4
- 19-2041 Environmental Scientists and Specialists, Including Health: .00 zone 4; 19-2041.01 zone 5, 19-2041.02 zone 5, 19-2041.03 zone 5
- 29-1141 Registered Nurses: .00 zone 4; 29-1141.02 zone 5, 29-1141.04 zone 5
- 33-3021 Detectives and Criminal Investigators: .00 zone 3; 33-3021.06 zone 4
- 41-4011 Sales Representatives, Wholesale and Manufacturing, Technical and Scientific Products: .00 zone 4; 41-4011.07 zone 3
- 51-8013 Power Plant Operators: .00 zone 2; 51-8013.04 zone 3
- 51-9195 Molders, Shapers, and Casters, Except Metal and Plastic: .00 zone 2; 51-9195.05 zone 3
- 53-6051 Transportation Inspectors: .00 zone 4; 53-6051.01 zone 3, 53-6051.07 zone 2

## Self-links dropped

387 rows, by job: 11-1011 Chief Executives (2); 11-3013 Facilities Managers (2); 11-3031 Financial Managers (6); 11-3051 Industrial Production Managers (24); 11-3071 Transportation, Storage, and Distribution Managers (2); 11-9041 Architectural and Engineering Managers (1); 11-9121 Natural Sciences Managers (4); 11-9179 Personal Service Managers, All Other (2); 11-9199 Managers, All Other (5); 13-1020 Buyers and Purchasing Agents (6); 13-1041 Compliance Officers (27); 13-1081 Logisticians (6); 13-1161 Market Research Analysts and Marketing Specialists (2); 13-1199 Business Operations Specialists, All Other (1); 13-2020 Property Appraisers and Assessors (2); 15-1211 Computer Systems Analysts (2); 15-1241 Computer Network Architects (2); 15-1243 Database Architects (2); 15-1255 Web and Digital Interface Designers (2); 15-1299 Computer Occupations, All Other (30); 15-2041 Statisticians (2); 15-2051 Data Scientists (6); 17-1022 Surveyors (2); 17-2051 Civil Engineers (6); 17-2072 Electronics Engineers, Except Computer (2); 17-2111 Health and Safety Engineers, Except Mining Safety Engineers and Inspectors (2); 17-2112 Industrial Engineers (12); 17-2141 Mechanical Engineers (6); 17-2199 Engineers, All Other (23); 17-3024 Electro-Mechanical and Mechatronics Technologists and Technicians (2); 17-3026 Industrial Engineering Technologists and Technicians (2); 17-3027 Mechanical Engineering Technologists and Technicians (2); 17-3029 Engineering Technologists and Technicians, Except Drafters, All Other (1); 19-1029 Biological Scientists, All Other (11); 19-1031 Conservation Scientists (6); 19-2041 Environmental Scientists and Specialists, Including Health (12); 19-3011 Economists (2); 19-3039 Psychologists, All Other (2); 19-4012 Agricultural Technicians (2); 19-4051 Nuclear Technicians (2); 21-1018 Substance Abuse, Behavioral Disorder, and Mental Health Counselors (2); 25-2052 Special Education Teachers, Kindergarten and Elementary School (2); 25-9045 Teaching Assistants, Except Postsecondary (2); 27-2012 Producers and Directors (12); 27-3043 Writers and Authors (2); 29-1071 Physician Assistants (2); 29-1122 Occupational Therapists (2); 29-1129 Therapists, All Other (2); 29-1141 Registered Nurses (20); 29-1229 Physicians, All Other (11); 29-2010 Clinical Laboratory Technologists and Technicians (30); 29-2099 Health Technologists and Technicians, All Other (2); 31-1120 Home Health and Personal Care Aides (2); 33-3021 Detectives and Criminal Investigators (6); 33-3051 Police and Sheriff's Patrol Officers (2); 35-3023 Fast Food and Counter Workers (2); 39-7010 Tour and Travel Guides (2); 39-9011 Childcare Workers (2); 41-4011 Sales Representatives, Wholesale and Manufacturing, Technical and Scientific Products (2); 43-5011 Cargo and Freight Agents (2); 47-1011 First-Line Supervisors of Construction Trades and Extraction Workers (2); 47-2152 Plumbers, Pipefitters, and Steamfitters (2); 47-4011 Construction and Building Inspectors (2); 51-2028 Electrical, Electronic, and Electromechanical Assemblers, Except Coil Winders, Tapers, and Finishers (2); 51-8013 Power Plant Operators (6); 51-9071 Jewelers and Precious Stone and Metal Workers (2); 51-9195 Molders, Shapers, and Casters, Except Metal and Plastic (9); 53-1047 First-Line Supervisors of Transportation and Material Moving Workers, Except Aircraft Cargo Handling Supervisors (10); 53-6051 Transportation Inspectors (6); 53-7062 Laborers and Freight, Stock, and Material Movers, Hand (2).

## How pay and AI Exposure are shown

Neither is stored here. `src/utils/careerPaths.ts` reads them at view time from the data the app already shows:

- **Pay change**: the target's BLS OEWS May 2025 median annual wage minus the current job's, from the same figures as the role panel's pay line (`src/data/national_wages.json` for the Kelley codes, the occupations data for the rest). If either wage is missing (BLS did not publish it, or publishes only hourly pay), there is no pay change. If either wage is top-coded ("#" in the BLS file: at or above BLS's cap), the helper returns a top-coded flag with the cap, never an exact difference. In OEWS May 2025 none of the 830 annual medians is top-coded; a test fails if that changes.
- **AI Exposure**: the target's published Automation Risk (`ai_scores_bls.json`, already in the main bundle) put into the map's own colour band (`bandFor`, thirds of all scored occupations). A job with no score is "not scored".

## Files

| File | What |
|---|---|
| `data/career_paths/sources.json` | version, release, license and sha256 of every input |
| `src/data/career_paths/index.json` | meta, the label, tiers, Job Zone names, coverage (small) |
| `src/data/career_paths/zones.json` | every job's Job Zone (one lazy chunk) |
| `src/data/career_paths/<NN>.json` | each job's links, one lazy chunk per BLS major group (22 files) |
| `src/utils/careerPaths.ts` | the only reader of the chunks |

Examples: Accountants and Auditors (13-2011), Budget Analysts (13-2031) and Electricians (47-2111) are checked link by link against the raw file in `src/__tests__/careerPaths.test.ts`.

