# Course catalog (Step 1 of 3)

When this step was written, the app asked Claude for course links, and most
were guessed wrong, so most buttons fell back to "Search on <site>". (Since
2026-11-22 there is no search fallback: a course without a checked link shows
with no link. See `docs/course-matches.md`.) The plan has three steps:

1. **This step:** build our own catalog of real courses and certifications, each
   with a link we checked. No Claude calls.
2. Later: match catalog courses to each of the 783 scored jobs.
3. Later: the app recommends only courses from those matches, so every button
   opens the exact course.

The catalog is data only: `data/course_catalog/catalog.json`. Nothing in `src/`
imports it, so it is not part of the app's bundle (a unit test checks this).
Step 2 will use it offline or on the server.

## Where the courses come from

Only from each provider's **own official public list**, in this order of
preference: official API, then the sitemap named in the site's robots.txt, then
the official catalog page. Before collecting from any site, its robots.txt and
terms of use were read (2026-11-15). Sites whose terms forbid automated
collection, or that block us, are skipped (table below). Nothing was worked
around.

| Site | Source used |
| --- | --- |
| Microsoft Learn | the public Catalog API, `learn.microsoft.com/api/catalog/?locale=en-us` (learning paths, certifications, instructor-led courses, Applied Skills) |
| Google Skills (Google Cloud Skills Boost) | its catalog pages, `www.skills.google/catalog?page=N` (allowed by robots.txt). Each page carries its list as data: title, type, level, duration, description, a "paid" flag. Courses only: labs are dropped |
| Grow with Google | the sitemap named in `grow.google/robots.txt`: the US-English certificate pages, their course pages, and the "-essentials" courses. Title, description and type come from each page |
| Certification bodies | `data/course_catalog/cert_pages.json`: a small hand-reviewed list of official certification pages (The IIA, PeopleCert, ACE). Each must still be linked from the body's own listing page under the same text |

Every field of an entry comes from the site: title, URL, level, duration,
description (cut to 200 characters), tags (Microsoft's product, role, subject
and skill names; Google Skills' "skill badge"). A field the site does not give
is left out. **Price:** `paid` when the site's list says paid (Google Skills) or
the course page shows a dollar price; `free` only when the page's structured
data says it is free; otherwise `unknown`. Microsoft Learn is always `unknown`,
because its API has no price field.

## The check

Every entry must pass the app's own link check, `checkCourseUrl` in
`src/shared/courseLinks.ts`, the same check used on Claude's links today: https,
on the provider list, not a home, search, listing or sign-in page, loads with a
success status (every redirect hop still a course page on the list), not a "not
found" page, and the page's title names the course. Then the build also drops:

- pages that are not English (the page's `lang`, or a title and description in
  another language);
- pages that say the course or certification **is retired or will retire**, in
  any of Microsoft's wordings ("has been retired", "are retired", "was retired
  on ...", "were fully retired", "will retire on ..."), on the page or in the
  entry's own description (Microsoft keeps pages for retired certifications);
- the same page listed twice (kept once).

For Grow with Google the title is read from the page itself, so the title part
of the check always agrees; the other checks still apply.

## Being polite

- User agent: `FutureOfJobsCourseCatalog/1.0 (+https://github.com/abhishek-sutaria/future-of-jobs; ...)`.
  The script says who it is. It never sends a browser user agent.
- robots.txt is read for every host and obeyed for every request, including
  `Crawl-delay`.
- One request at a time per host, at most one per second.
- Downloads are cached (gzip) in `.cache/course_catalog/` for 7 days, so a
  re-run does not download them again. `--fresh` ignores the cache; `--check`
  never uses it.
- Each list download is recorded in `data/course_catalog/sources.json`: URL,
  date, sha256 and size of exactly what was downloaded, plus the committed copy
  or extract in `data/course_catalog/raw/`.

## Counts

Collected = every item in the site's list. Passed = in the catalog. Every
dropped item and its reason is listed in `data/course_catalog/report.json`.
A fresh full run (2026-11-15) took **26 minutes** (2,084 requests, almost all
one-per-second link checks on learn.microsoft.com); a re-run within 7 days
uses the cache and takes about 2 minutes. Google Skills reported 1,312 items
but 1,303 distinct ones: its list shifted a little while the 164 pages were
read, so a few items appeared twice (a few may have been missed; the next run
picks them up).

<!-- counts:start (written by scripts/build_course_catalog.ts) -->

Last run: 2026-11-21, re-applying the filters to the saved downloads (no new downloads). Catalog: **1,767 entries**, 1281 KB.

- **Microsoft Learn** (official Catalog API): collected 1161, passed the check 1092, dropped 69: 69 page says it is retired.
- **Google Skills (Cloud Skills Boost)** (official catalog pages (the list they carry as data)): collected 1303, passed the check 636, dropped 667: 667 a lab, not a course.
- **Grow with Google** (sitemap listed in robots.txt): collected 28, passed the check 28, dropped 0.
- **Certification bodies (IIA, PeopleCert, ACE)** (hand-reviewed pages from each body's official certification listing): collected 12, passed the check 11, dropped 1: 1 title does not match.

<!-- counts:end -->

## Skipped, and why

Read on 2026-11-15. The exact clause for each is linked in `SKIPPED` in
`scripts/build_course_catalog.ts` and in `report.json`.

- **Coursera:** Terms of Use forbid scraping or data extraction by automated
  means without written consent.
- **edX:** Terms of Service forbid spiders, robots, crawlers and data mining
  tools other than edX's own (section 11.6).
- **LinkedIn Learning:** robots.txt says automated access without LinkedIn's
  express permission is prohibited.
- **Khan Academy:** Terms of Service forbid using software to scrape the
  Services or copy data from them (section 9).
- **AWS (Skill Builder, certifications):** Skill Builder's "Legal" link goes to
  the AWS Site Terms, which exclude data mining, robots and similar
  data-gathering tools.
- **Udemy:** skipped by the brief (it blocks link checks).
- **AICPA & CIMA (CPA), CFA Institute, ISACA, SHRM, NASBA, HRCI, CompTIA,
  IIBA, FINRA, AHIMA, ANCC, ServSafe, NASM, NCCER:** their terms forbid robots,
  scraping, data mining, or indexing / aggregating their content.
- **PMI (PMP), Scrum.org, OSHA, American Red Cross:** they block us (403 to an
  honest user agent).
- **ASCM / APICS, (ISC)², ACFE, IMA:** their terms could not be found or read,
  so they are not used.
- **AACN:** its terms allow it, but its certification list is built by
  JavaScript, so the official listing page has no certification links to take.

Any of these could be added with the site's written permission or an official
feed.

## How to re-run

```sh
npx tsx scripts/build_course_catalog.ts           # collect, check, write everything (uses the 7-day cache)
npx tsx scripts/build_course_catalog.ts --fresh   # the same, downloading everything again
npx tsx scripts/build_course_catalog.ts --check   # re-check every catalog link (for a monthly refresh)
```

`--check` re-checks every entry in `catalog.json` with the same check, gives any
failure a second try, then rewrites `catalog.json` without the entries that
failed twice (with new `lastChecked` dates) and lists the removed ones in
`data/course_catalog/check_report.json`. It is not scheduled yet.

To add a certification body: read its robots.txt and terms first. If they
allow it, add its pages to `data/course_catalog/cert_pages.json` (URL and link
text copied from the body's own listing page) and make sure its domain is in
`src/shared/courseProviders.ts`.
