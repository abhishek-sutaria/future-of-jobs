# Outside-study check: do published studies rank jobs the way we do?

**In short.** We compared our AI risk scores for 783 jobs with the best-known published study of which jobs AI language models affect most, "GPTs are GPTs" (OpenAI and the University of Pennsylvania, published in *Science* in 2024). Every one of our 783 jobs matched a job in their data. The two rankings agree strongly (rank correlation 0.77 on a scale where 1 is a perfect match), and the job families look the same: in their data too, most business, finance, sales, office and computer jobs land in the most exposed third, and construction, repair and most health care jobs land in the least exposed third. Only 10 of our 783 jobs are red in ours but green in theirs, and 3 the other way round. A second, very different study (Microsoft Research, 2025, built from real Copilot conversations) tells the same story. Where we differ most is factory and plant jobs, which we rate somewhat more exposed than they do. We also checked how we pick the 5 tasks per job: O*NET already lists each job's tasks with the most important core tasks first, so our "first 5" are almost always the job's most important tasks. Re-scoring with a different task pick would not change the picture.

This is a check only. No score, colour or app code was changed, and no AI API call was made.

## What we compared

- **Ours.** `src/data/ai_scores_bls.json`: 783 scored jobs, each scored on 5 O*NET tasks; risk = mean task AI capability score. Colours as the app shows them (`buildRiskScale` in `src/config/theme.ts`): the lowest third of the 783 is green, the middle third amber, the top third red (cut-offs 0.25 and 0.43).
- **GPTs are GPTs** (Eloundou, Manning, Mishkin and Rock, *Science* 384(6702), 1306-1308, 2024). Each O*NET task was labelled by trained human annotators and, separately, by GPT-4: E0 = an AI language model does not cut the time for this task by half or more, E1 = it does on its own, E2 = it does with extra software built on top. Their headline job score is **β = share of E1 + half the share of E2**, averaged over the job's tasks with core tasks counted twice. They also publish α (E1 only) and γ (E1 + E2). **Main measure here: β from the human annotators**, because it is the one not made by an AI model. GPT-4's β and the other four are reported too.
- **Microsoft "Working with AI"** (Tomlinson, Jaffe, Wang, Counts and Suri, NeurIPS 2026). An "AI applicability score" per job, from how often and how well 2024 Bing Copilot conversations covered the job's work activities. The authors stress it does not measure whether AI can replace a job.
- All files are committed in `data/outside_study/raw/` as downloaded, pinned to a commit, with URL, date, sha256, licence and citation in `data/outside_study/sources.json`. The script refuses to run if any file's sha256 differs.

**Check on their data.** Their job scores in `occ_level.csv` can be rebuilt exactly, all six columns for all 923 jobs, from their task-level file with the rule above (core tasks count twice). So we know what their numbers mean, and we could score our exact 5 tasks their way (section f).

**How jobs were matched.** Their codes are 8-digit O*NET-SOC (for example 11-1011.00); ours are 6-digit SOC.

- 707 jobs: their one code under our SOC (11-1011.00 for 11-1011).
- 64 jobs: several of their codes under our SOC (for example 11-9199.01 to .11 for 11-9199); we use their mean.
- 12 jobs: our SOC is split into other codes in O*NET (for example 13-2020 = 13-2022 + 13-2023); we use the same split codes our own scoring uses (`src/config/onetSplitCodes.ts`) and take their mean.
- 0 jobs unmatched. No code is counted for two of our jobs (the script checks).
- Microsoft uses 6-digit SOC 2018 codes: all 783 match on the same code.

**Their thirds.** We cut their scores into thirds with the same rule the app uses (value at 1/3 and 2/3 of the sorted list; at or above the upper cut is red), across the same 783 jobs. That gives 261 green, 261 amber, 261 red for their human β (cut-offs 0.14 and 0.40).

## (a) to (c) How well do the rankings agree?

All 783 of our scored jobs match.

| Their measure | Jobs matched | Rank agreement (Spearman) | Same colour | Red in ours, green in theirs | Green in ours, red in theirs |
|---|---:|---:|---:|---:|---:|
| GPTs are GPTs, human raters, β (main) | 783 | 0.77 | 63.9% | 10 | 3 |
| GPTs are GPTs, GPT-4 rater, β | 783 | 0.82 | 69.0% | 7 | 2 |
| GPTs are GPTs, human, α | 783 | 0.64 | 56.4% | 15 | 11 |
| GPTs are GPTs, GPT-4, α | 783 | 0.54 | 52.7% | 30 | 37 |
| GPTs are GPTs, human, γ | 783 | 0.78 | 65.5% | 10 | 4 |
| GPTs are GPTs, GPT-4, γ | 783 | 0.80 | 67.2% | 7 | 4 |
| Microsoft Working with AI, AI applicability | 783 | 0.66 | 58.6% | 14 | 16 |

How to read this:

- **0.77 is strong agreement.** For scale, the two raters inside the same study (their humans vs their GPT-4) agree at 0.91, and the two outside studies agree with each other at 0.76. We agree with GPTs are GPTs about as well as it agrees with Microsoft.
- **Same colour 64%.** If colours were random, about 33% would match. Almost all the other 36% are one step apart (amber vs red or amber vs green). Two steps apart (red vs green) is 13 jobs of 783 (1.7%).
- α (only tasks a plain chatbot can halve) agrees less. That is expected: our score is closer to their β and γ, which also count AI with extra tools.

Their human β, colour by colour (rows ours, columns theirs):

| Ours \ Theirs | Green | Amber | Red |
|---|---:|---:|---:|
| Green | 183 | 75 | 3 |
| Amber | 68 | 125 | 66 |
| Red | 10 | 61 | 192 |

The 10 jobs red in ours but green in theirs: Physician Assistants (29-1071), Fast Food and Counter Workers (35-3023), Home Appliance Repairers (49-9031), Prepress Technicians (51-5111), Gas Plant Operators (51-8092), Mixing and Blending Machine Operators (51-9023), Semiconductor Processing Technicians (51-9141), Cooling and Freezing Equipment Operators (51-9193), Aircraft Cargo Handling Supervisors (53-1041), Gas Compressor and Pumping Station Operators (53-7071).

The 3 green in ours but red in theirs: Human Resources Managers (11-3121), Therapists, All Other (29-1129), First-Line Supervisors of Firefighting (33-1021).

## (d) By job family: % of jobs red

| Job family | Jobs | Red in ours | Red by their human β | Red by their GPT-4 β | Red by Microsoft |
|---|---:|---:|---:|---:|---:|
| Business & Finance (13) | 32 | 81% (26) | 88% (28) | 94% | 69% |
| Sales (41) | 21 | 86% (18) | 76% (16) | 62% | 86% |
| Office & Admin (43) | 50 | 82% (41) | 76% (38) | 82% | 80% |
| Management (11) | 36 | 47% (17) | 72% (26) | 61% | 14% |
| Computer & Math (15) | 21 | 86% (18) | 100% (21) | 100% | 90% |
| Healthcare (29 + 31) | 86 | 21% (18) | 14% (12) | 21% | 7% |
| Food (35) | 15 | 20% (3) | 0% (0) | 7% | 20% |
| Personal care (39) | 29 | 10% (3) | 3% (1) | 3% | 38% |
| Construction (47) | 57 | 0% (0) | 0% (0) | 0% | 0% |
| Repair (49) | 50 | 4% (2) | 0% (0) | 0% | 2% |
| Production (51) | 100 | 9% (9) | 0% (0) | 2% | 4% |
| Transport (53) | 46 | 15% (7) | 0% (0) | 2% | 4% |

Each study's own thirds, so in every column a third of all 783 jobs is red. Healthcare 29 alone: 25% ours, 17% human β; 31 alone: 6% ours, 0% human β (all groups are in the appendix).

What it shows:

- **Business, finance, sales and office jobs are mostly red in every source.** Their human annotators put even more business and finance jobs in red than we do (28 vs 26). In sales and office the outside studies are at or a little below us (sales: human β 76%, GPT-4 β 62%, Microsoft 86%, ours 86%).
- **Construction is 0% red in every source.** Repair, health care, food and personal care are low everywhere.
- **Where we are higher:** production (9% vs 0%) and transport (15% vs 0%). Factory, plant and driving jobs are the main place we differ (see e).
- **Where we are lower:** management (47% vs 72% human β), and science and engineering (appendix). Microsoft is much lower again for management (14%).

## (e) The 20 biggest disagreements

Ranked by the gap between our rank and theirs among the 783 (rank 1 = most exposed; their human β). For each job: our 5 tasks with our AI score, and the label their human annotators and GPT-4 gave the **same task** (matched by O*NET code and Task ID). "Their human β on our same 5 tasks" is their rule applied to only our 5 tasks.

Patterns:

- **We rank 15 of the 20 more exposed. 13 of them are production or transport jobs** (plant operators, machine operators, supervisors, Taxi Drivers); the other two are Fast Food and Counter Workers and Medical Transcriptionists. For these the gap is about how each task is rated, not which tasks were picked: their human β on **our same 5 tasks** is about as low as on the whole job. Our scores give credit for automation of record keeping, gauge reading and machine control; their study asks only whether a language model can halve the time of the task, and their human annotators said no for almost all hands-on and machine tasks.
- **Their own two raters often split on these same jobs.** Medical Transcriptionists: their humans gave all 5 of our tasks E0, their GPT-4 gave all 5 E1 (GPT-4 β 0.88 for that job, near the top). We are closer to their GPT-4 there. Prepress Technicians and Aircraft Cargo Handling Supervisors: the same split.
- **We rank 5 of the 20 less exposed:** Psychiatric Technicians, Firefighting Supervisors, Childcare Workers, Preschool and Childcare Administrators, Funeral Home Managers. Care and people jobs. For three of them (Childcare Workers, Firefighting Supervisors, Preschool Administrators) their human β on our 5 tasks is lower than on the whole job (for example 0.10 vs 0.34): the job's paperwork and planning tasks, which their annotators saw as exposed, are further down O*NET's list. Our 5 are still the job's most important tasks (5 of 5 in the top 5 where rated), so picking by importance would not change this either.
- **18 of the 20 have importance ratings for every task. In those, on average 4.6 of our 5 tasks are among the job's 5 most important** (the same as all other jobs). Taxi Drivers has no O*NET importance ratings; Firefighting Supervisors has some tasks unrated.

**1. 53-1041 Aircraft Cargo Handling Supervisors**. Ours: 0.55, red, rank 117. Theirs (human β): 0.00, green, rank 756 (GPT-4 β 0.30). We rank it **more** exposed. Their human β on our same 5 tasks: 0. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Determine the quantity and orientation of cargo, and compute an aircraft's center of gravity. | 0.75 | E0 | E2 |
| Direct ground crews in the loading, unloading, securing, or staging of aircraft cargo or baggage. | 0.25 | E0 | E0 |
| Train new employees in areas such as safety procedures or equipment operation. | 0.30 | E0 | E0 |
| Distribute cargo to maximize use of space. | 0.65 | E0 | E2 |
| Calculate load weights for different aircraft compartments, using charts and computers. | 0.80 | E0 | E1 |

**2. 51-5111 Prepress Technicians and Workers**. Ours: 0.63, red, rank 58. Theirs (human β): 0.11, green, rank 567.5 (GPT-4 β 0.44). We rank it **more** exposed. Their human β on our same 5 tasks: 0.1. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Generate prepress proofs in digital or other format to approximate the appearance of the final printed piece. | 0.75 | E0 | E2 |
| Proofread and perform quality control of text and images. | 0.70 | E0 | E2 |
| Enter, position, and alter text size, using computers, to make up and arrange pages so that printed materials can be produced. | 0.80 | E2 | E2 |
| Perform "preflight" check of required font, graphic, text and image files to ensure completeness prior to delivery to printer. | 0.65 | E0 | E2 |
| Operate and maintain laser plate-making equipment that converts electronic data to plates without the use of film. | 0.25 | E0 | E0 |

**3. 35-3023 Fast Food and Counter Workers**. Ours: 0.57, red, rank 91.5. Theirs (human β): 0.12, green, rank 557 (GPT-4 β 0.10). We rank it **more** exposed. Their human β on our same 5 tasks: 0.2. Task pick: 4 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Accept payment from customers, and make change as necessary. | 0.75 | E0 | E0 |
| Serve customers in eating places that specialize in fast service and inexpensive carry-out food. | 0.30 | E0 | E0 |
| Request and record customer orders, and compute bills, using cash registers, multi-counting machines, or pencil and paper. | 0.70 | E0 | E2 |
| Balance receipts and payments in cash registers. | 0.65 | E2 | E0 |
| Communicate with customers regarding orders, comments, and complaints. | 0.45 | E2 | E0 |

**4. 51-9193 Cooling and Freezing Equipment Operators and Tenders**. Ours: 0.46, red, rank 219.5. Theirs (human β): 0.04, green, rank 681.5 (GPT-4 β 0.08). We rank it **more** exposed. Their human β on our same 5 tasks: 0.1. Task pick: 3 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Record temperatures, amounts of materials processed, or test results on report forms. | 0.75 | E2 | E1 |
| Monitor pressure gauges, ammeters, flowmeters, thermometers, or products, and adjust controls to maintain specified conditions, such as feed rate, product consistency, temperature, air pressure, and machine speed. | 0.55 | E0 | E0 |
| Read dials and gauges on panel control boards to ascertain temperatures, alkalinities, and densities of mixtures, and turn valves to obtain specified mixtures. | 0.50 | E0 | E0 |
| Start machinery, such as pumps, feeders, or conveyors, and turn valves to heat, admit, or transfer products, refrigerants, or mixes. | 0.35 | E0 | E0 |
| Correct machinery malfunctions by performing actions such as removing jams, and inform supervisors of malfunctions as necessary. | 0.15 | E0 | E0 |

**5. 51-9141 Semiconductor Processing Technicians**. Ours: 0.49, red, rank 185. Theirs (human β): 0.06, green, rank 643 (GPT-4 β 0.23). We rank it **more** exposed. Their human β on our same 5 tasks: 0.1. Task pick: 3 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Manipulate valves, switches, and buttons, or key commands into control panels to start semiconductor processing cycles. | 0.35 | E0 | E0 |
| Maintain processing, production, and inspection information and reports. | 0.75 | E2 | E1 |
| Inspect materials, components, or products for surface defects and measure circuitry, using electronic test equipment, precision measuring instruments, microscope, and standard procedures. | 0.55 | E0 | E2 |
| Clean semiconductor wafers using cleaning equipment, such as chemical baths, automatic wafer cleaners, or blow-off wands. | 0.20 | E0 | E0 |
| Study work orders, instructions, formulas, and processing charts to determine specifications and sequence of operations. | 0.60 | E0 | E1 |

**6. 51-9151 Photographic Process Workers and Processing Machine Operators**. Ours: 0.65, red, rank 51. Theirs (human β): 0.17, amber, rank 489 (GPT-4 β 0.38). We rank it **more** exposed. Their human β on our same 5 tasks: 0.4. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Select digital images for printing, specify number of images to be printed, and direct to printer, using computer software. | 0.85 | E2 | E2 |
| Create prints according to customer specifications and laboratory protocols. | 0.70 | E2 | E2 |
| Produce color or black-and-white photographs, negatives, or slides, applying standard photographic reproduction techniques and procedures. | 0.60 | E2 | E2 |
| Set or adjust machine controls, according to specifications, type of operation, or material requirements. | 0.45 | E0 | E0 |
| Review computer-processed digital images for quality. | 0.65 | E2 | E2 |

**7. 31-9094 Medical Transcriptionists**. Ours: 0.77, red, rank 7.5. Theirs (human β): 0.23, amber, rank 438 (GPT-4 β 0.88). We rank it **more** exposed. Their human β on our same 5 tasks: 0. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Return dictated reports in printed or electronic form for physician's review, signature, and corrections and for inclusion in patients' medical records. | 0.85 | E0 | E1 |
| Produce medical reports, correspondence, records, patient-care information, statistics, medical research, and administrative material. | 0.80 | E0 | E1 |
| Identify mistakes in reports and check with doctors to obtain the correct information. | 0.55 | E0 | E1 |
| Review and edit transcribed reports or dictated material for spelling, grammar, clarity, consistency, and proper medical terminology. | 0.75 | E0 | E1 |
| Transcribe dictation for a variety of medical reports, such as patient histories, physical examinations, emergency room visits, operations, chart reviews, consultation, or discharge summaries. | 0.90 | E0 | E1 |

**8. 29-2053 Psychiatric Technicians**. Ours: 0.08, green, rank 734. Theirs (human β): 0.34, amber, rank 327.5 (GPT-4 β 0.12). We rank it **less** exposed. Their human β on our same 5 tasks: 0.333. Task pick: 4 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Provide nursing, psychiatric, or personal care to patients with cognitive, intellectual, or developmental disabilities. | 0.05 | E2 | E0 |
| Encourage patients to develop work skills and to participate in social, recreational, or other therapeutic activities that enhance interpersonal skills or develop social relationships. | 0.10 | E0 | E0 |
| Restrain violent, potentially violent, or suicidal patients by verbal or physical means as required. | 0.02 | E0 | E0 |
| Lead prescribed individual or group therapy sessions as part of specific therapeutic procedures. | 0.08 | E1 | E0 |
| Monitor patients' physical and emotional well-being and report unusual behavior or physical ailments to medical staff. | 0.15 | E2 | E2 |

**9. 51-8092 Gas Plant Operators**. Ours: 0.47, red, rank 207.5. Theirs (human β): 0.08, green, rank 612.5 (GPT-4 β 0.09). We rank it **more** exposed. Their human β on our same 5 tasks: 0.125. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Monitor equipment functioning, observe temperature, level, and flow gauges, and perform regular unit checks to ensure that all equipment is operating as it should. | 0.55 | E0 | E0 |
| Distribute or process gas for utility companies or industrial plants, using panel boards, control boards, and semi-automatic equipment. | 0.40 | E0 | E0 |
| Control operation of compressors, scrubbers, evaporators, and refrigeration equipment to liquefy, compress, or regasify natural gas. | 0.35 | E0 | E0 |
| Control equipment to regulate flow and pressure of gas to feedlines of boilers, furnaces, and related steam-generating or heating equipment. | 0.35 | E0 | E0 |
| Record, review, and compile operations records, test results, and gauge readings such as temperatures, pressures, concentrations, and flows. | 0.70 | E2 | E2 |

**10. 33-1021 First-Line Supervisors of Firefighting and Prevention Workers**. Ours: 0.15, green, rank 649.5. Theirs (human β): 0.41, red, rank 249 (GPT-4 β 0.41). We rank it **less** exposed. Their human β on our same 5 tasks: 0.2. Task pick: some tasks unrated.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Assign firefighters to jobs at strategic locations to facilitate rescue of persons and maximize application of extinguishing agents. | 0.15 | E0 | E0 |
| Provide emergency medical services as required, and perform light to heavy rescue functions at emergencies. | 0.05 | E0 | E0 |
| Assess nature and extent of fire, condition of building, danger to adjacent buildings, and water supply status to determine crew or company requirements. | 0.20 | E1 | E2 |
| Communicate fire details to superiors, subordinates, or interagency dispatch centers, using two-way radios. | 0.30 | E0 | E1 |
| Serve as a working leader of an engine, hand, helicopter, or prescribed fire crew of three or more firefighters. | 0.05 | E0 | E0 |

**11. 53-7071 Gas Compressor and Gas Pumping Station Operators**. Ours: 0.46, red, rank 219.5. Theirs (human β): 0.08, green, rank 614.5 (GPT-4 β 0.27). We rank it **more** exposed. Their human β on our same 5 tasks: 0.1. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Monitor meters and pressure gauges to determine consumption rate variations, temperatures, and pressures. | 0.65 | E0 | E0 |
| Respond to problems by adjusting control room equipment or instructing other personnel to adjust equipment at problem locations or in other control areas. | 0.35 | E0 | E0 |
| Record instrument readings and operational changes in operating logs. | 0.80 | E2 | E1 |
| Adjust valves and equipment to obtain specified performance. | 0.30 | E0 | E0 |
| Move controls and turn valves to start compressor engines, pumps, and auxiliary equipment. | 0.20 | E0 | E0 |

**12. 51-4122 Welding, Soldering, and Brazing Machine Setters, Operators, and Tenders**. Ours: 0.42, amber, rank 269.5. Theirs (human β): 0.06, green, rank 652 (GPT-4 β 0.07). We rank it **more** exposed. Their human β on our same 5 tasks: 0.056. Task pick: 4 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Read blueprints, work orders, or production schedules to determine product or job instructions or specifications. | 0.55 | E0 | E2 |
| Inspect, measure, or test completed metal workpieces to ensure conformance to specifications, using measuring and testing devices. | 0.40 | E0 | E0 |
| Record operational information on specified production reports. | 0.70 | E2 | E1 |
| Correct problems by adjusting controls or by stopping machines and opening holding devices. | 0.20 | E0 | E0 |
| Set up, operate, or tend welding machines that join or bond components to fabricate metal products or assemblies. | 0.25 | E0 | E0 |

**13. 39-9011 Childcare Workers**. Ours: 0.10, green, rank 705. Theirs (human β): 0.34, amber, rank 325 (GPT-4 β 0.14). We rank it **less** exposed. Their human β on our same 5 tasks: 0.1. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Maintain a safe play environment. | 0.05 | E0 | E0 |
| Observe and monitor children's play activities. | 0.10 | E0 | E0 |
| Communicate with children's parents or guardians about daily activities, behaviors, and related issues. | 0.25 | E2 | E0 |
| Support children's emotional and social development, encouraging understanding of others and positive self-concepts. | 0.05 | E0 | E0 |
| Care for children in institutional setting, such as group homes, nursery schools, private businesses, or schools for people with disabilities. | 0.03 | E0 | E0 |

**14. 11-9031 Education and Childcare Administrators, Preschool and Daycare**. Ours: 0.26, amber, rank 504.5. Theirs (human β): 0.52, red, rank 129 (GPT-4 β 0.47). We rank it **less** exposed. Their human β on our same 5 tasks: 0.3. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Confer with parents and staff to discuss educational activities and policies and students' behavioral or learning problems. | 0.25 | E0 | E0 |
| Monitor students' progress and provide students and teachers with assistance in resolving any problems. | 0.30 | E2 | E2 |
| Recruit, hire, train, and evaluate primary and supplemental staff and recommend personnel actions for programs and services. | 0.35 | E0 | E2 |
| Teach classes or courses or provide direct care to children. | 0.10 | E0 | E0 |
| Set educational standards and goals and help establish policies, procedures, and programs to carry them out. | 0.30 | E1 | E2 |

**15. 51-1011 First-Line Supervisors of Production and Operating Workers**. Ours: 0.59, red, rank 79.5. Theirs (human β): 0.23, amber, rank 447 (GPT-4 β 0.40). We rank it **more** exposed. Their human β on our same 5 tasks: 0.3. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Enforce safety and sanitation regulations. | 0.25 | E0 | E0 |
| Keep records of employees' attendance and hours worked. | 0.85 | E2 | E1 |
| Inspect materials, products, or equipment to detect defects or malfunctions. | 0.55 | E0 | E0 |
| Read and analyze charts, work orders, production schedules, and other records and reports to determine production requirements and to evaluate current production estimates and outputs. | 0.70 | E2 | E2 |
| Plan and establish work schedules, assignments, and production sequences to meet production goals. | 0.60 | E2 | E2 |

**16. 51-9051 Furnace, Kiln, Oven, Drier, and Kettle Operators and Tenders**. Ours: 0.39, amber, rank 320. Theirs (human β): 0.04, green, rank 681.5 (GPT-4 β 0.16). We rank it **more** exposed. Their human β on our same 5 tasks: 0.1. Task pick: 4 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Monitor equipment operation, gauges, and panel lights to detect deviations from standards. | 0.45 | E0 | E0 |
| Confer with supervisors or other equipment operators to report equipment malfunctions or to resolve production problems. | 0.25 | E0 | E0 |
| Press and adjust controls to activate, set, and regulate equipment according to specifications. | 0.30 | E0 | E0 |
| Record gauge readings, test results, and shift production in log books. | 0.55 | E2 | E1 |
| Read and interpret work orders and instructions to determine work assignments, process specifications, and production schedules. | 0.40 | E0 | E1 |

**17. 51-9023 Mixing and Blending Machine Setters, Operators, and Tenders**. Ours: 0.44, red, rank 245.5. Theirs (human β): 0.08, green, rank 602 (GPT-4 β 0.11). We rank it **more** exposed. Their human β on our same 5 tasks: 0.2. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Weigh or measure materials, ingredients, or products to ensure conformance to requirements. | 0.55 | E0 | E0 |
| Read work orders to determine production specifications or information. | 0.60 | E1 | E1 |
| Observe production or monitor equipment to ensure safe and efficient operation. | 0.35 | E0 | E0 |
| Mix or blend ingredients by starting machines and mixing for specified times. | 0.40 | E0 | E0 |
| Stop mixing or blending machines when specified product qualities are obtained and open valves and start pumps to transfer mixtures. | 0.30 | E0 | E0 |

**18. 53-7073 Wellhead Pumpers**. Ours: 0.33, amber, rank 402. Theirs (human β): 0.00, green, rank 756 (GPT-4 β 0.00). We rank it **more** exposed. Their human β on our same 5 tasks: 0. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Monitor pumps and flow lines for gas and fluid leaks. | 0.35 | E0 | E0 |
| Gauge oil and gas production. | 0.45 | E0 | E0 |
| Start compressor engines and divert oil from storage tanks into compressor units and auxiliary equipment to recover natural gas from oil. | 0.20 | E0 | E0 |
| Monitor control panels during pumping operations to ensure that materials are being pumped at the correct pressure, density, rate, and concentration. | 0.40 | E0 | E0 |
| Operate engines and pumps to shut off wells according to production schedules, and to switch flow of oil into storage tanks. | 0.25 | E0 | E0 |

**19. 53-3054 Taxi Drivers**. Ours: 0.62, red, rank 63.5. Theirs (human β): 0.25, amber, rank 416 (GPT-4 β 0.28). We rank it **more** exposed. Their human β on our same 5 tasks: 0.3. Task pick: no O*NET importance ratings.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Collect fares or vouchers from passengers, and make change or issue receipts as necessary. | 0.70 | E0 | E0 |
| Communicate with dispatchers by radio, telephone, or computer to exchange information and receive requests for passenger service. | 0.75 | E2 | E1 |
| Complete accident reports when necessary. | 0.55 | E2 | E1 |
| Determine fares based on trip distances and times, using taximeters and fee schedules, and announce fares to passengers. | 0.80 | E2 | E1 |
| Drive taxicabs or privately owned vehicles to transport passengers. | 0.30 | E0 | E0 |

**20. 11-9171 Funeral Home Managers**. Ours: 0.30, amber, rank 452.5. Theirs (human β): 0.54, red, rank 103 (GPT-4 β 0.43). We rank it **less** exposed. Their human β on our same 5 tasks: 0.5. Task pick: 5 of our 5 in its top 5.

| Our task | Our AI score | Their human label | Their GPT-4 label |
|---|---:|:---:|:---:|
| Consult with families or friends of the deceased to arrange funeral details, such as obituary notice wording, casket selection, or plans for services. | 0.30 | E2 | E0 |
| Schedule funerals, burials, or cremations. | 0.55 | E2 | E0 |
| Deliver death certificates to medical facilities or offices to obtain signatures from legally authorized persons. | 0.20 | not labelled | not labelled |
| Offer counsel and comfort to families and friends of the deceased. | 0.10 | E1 | E0 |
| Monitor funeral service operations to ensure that they comply with applicable policies, regulations, and laws. | 0.35 | E0 | E2 |

## (f) Our task-picking rule

748 of 783 jobs were scored on the first 5 O*NET tasks in file order. We checked these against O*NET 30.1 Task Ratings (importance, 1 to 5) and Task Statements (Core / Supplemental), both byte-identical to the official onetcenter.org zip (sha256 in `sources.json`).

**Key fact: O*NET's file lists each job's Core tasks first, and within Core and within Supplemental, most important first.** So "first 5 in file order" is, for most jobs, "the 5 most important Core tasks". (Example 13-1011: importance 4.57, 4.49, 4.28, 3.99, 3.99, ... all Core, then the Supplemental tasks.)

Jobs counted: only those where every task has an importance rating (702 of 783; 672 of the 748 first-5 jobs). 23 jobs have no importance ratings at all in O*NET 30.1 (their tasks were written by O*NET analysts, for example Taxi Drivers) and 58 have some tasks unrated; they are listed in `results.json` and left out of these numbers, not filled in. "Top 5" = the job's 5 highest-importance tasks (ties broken by O*NET file order; counting ties as in changes nothing: 4.59 instead of 4.58).

| Our 5 tasks vs the job's 5 most important | First-5 jobs (672) | All rated jobs (702) |
|---|---:|---:|
| How many of our 5 are in its top 5 (mean) | 4.58 | 4.53 |
| Jobs with all 5 in its top 5 | 492 (73%) | 498 (71%) |
| Jobs with 4 | 107 | 115 |
| Jobs with 3 | 53 | 64 |
| Jobs with 0 to 2 | 20 | 25 |
| A random 5 tasks would give (mean) | 1.42 | 1.40 |
| How many of our 5 are Core (mean) | 4.95 | 4.95 |
| Jobs with all 5 Core | 653 | 683 |
| Mean importance of our 5 | 4.43 | 4.43 |
| Mean importance of its top 5 | 4.44 | 4.45 |

Where they differ, the swap costs little: the mean importance of our 5 is only 0.02 below the top 5 (on a 1 to 5 scale).

**Do the big disagreements come from the task pick? No.**

- The 20 biggest disagreements have 4.56 of 5 in the top 5 (18 jobs with ratings); all other jobs 4.53.
- Across all 702 rated jobs, the size of the rank gap is unrelated to how many of our tasks are in the top 5 (Spearman -0.003).
- **Same tasks, their raters** (742 jobs where every one of our tasks and every one of the top-5 tasks has their human label):
  - Their human β on **only our 5 tasks** vs their full-job β: 0.88.
  - Their human β on **only the 5 most important tasks** vs their full-job β: 0.87.
  - So by their own labels, our 5 tasks stand for the whole job as well as the top-5-by-importance tasks do (mean gap 0.085 vs 0.088).
  - Our scores vs their human β on **our same 5 tasks**: 0.77, the same as vs their whole job (0.77). The difference between us and them is in how a task is rated, not in which tasks were picked.

## What this means

- **Our reds are in line with the leading published study.** Business, finance, sales, office and computer jobs are mostly red in GPTs are GPTs too, with human annotators and with GPT-4, and in Microsoft's usage-based study. Construction, repair and most health care are low in all of them. The pattern Ray noticed is what the research finds, not a quirk of our scoring.
- **Re-scoring on "most important tasks" is not needed.** Our first-5 rule already picks the most important core tasks for almost every job, and their own labels show the change would not move scores closer to the whole job.
- **One honest soft spot:** about a dozen factory, plant and transport jobs are red or high amber in ours but low in theirs. Our scores count automation of monitoring and record keeping; their study counts only language-model help. Worth knowing if someone asks about a specific plant job.
- **Limits.** GPTs-are-GPTs labels date from 2023 (GPT-4 era) and measure exposure, not job loss; Microsoft measures 2024 Copilot use. Neither is "the truth"; they are independent checks. Colours are thirds in every column, so a third of jobs is red by design in each source.

## Reproduce

```
npx tsx scripts/outside_study_check.ts
```

Reads the pinned files (checks every sha256), writes `data/outside_study/results.json`: matching, every measure's agreement and cross-table, families, all SOC major groups, the 20 biggest disagreements with task labels, and the task-pick numbers. No network, no API call.

## Appendix: every SOC major group, % red

| SOC major group | Jobs | Red in ours | Red by human β | Red by GPT-4 β | Red by Microsoft |
|---|---:|---:|---:|---:|---:|
| 11 | 36 | 47% | 72% | 61% | 14% |
| 13 | 32 | 81% | 88% | 94% | 69% |
| 15 | 21 | 86% | 100% | 100% | 90% |
| 17 | 35 | 54% | 66% | 69% | 69% |
| 19 | 47 | 45% | 72% | 57% | 53% |
| 21 | 13 | 23% | 38% | 8% | 69% |
| 23 | 7 | 43% | 57% | 71% | 0% |
| 25 | 60 | 62% | 62% | 60% | 80% |
| 27 | 36 | 44% | 39% | 50% | 56% |
| 29 | 69 | 25% | 17% | 25% | 9% |
| 31 | 17 | 6% | 0% | 6% | 0% |
| 33 | 23 | 9% | 9% | 0% | 17% |
| 35 | 15 | 20% | 0% | 7% | 20% |
| 37 | 8 | 0% | 0% | 0% | 0% |
| 39 | 29 | 10% | 3% | 3% | 38% |
| 41 | 21 | 86% | 76% | 62% | 86% |
| 43 | 50 | 82% | 76% | 82% | 80% |
| 45 | 11 | 0% | 0% | 0% | 0% |
| 47 | 57 | 0% | 0% | 0% | 0% |
| 49 | 50 | 4% | 0% | 0% | 2% |
| 51 | 100 | 9% | 0% | 2% | 4% |
| 53 | 46 | 15% | 0% | 2% | 4% |
