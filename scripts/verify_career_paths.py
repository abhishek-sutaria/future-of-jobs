#!/usr/bin/env python3
"""
Independent check of the career paths data (src/data/career_paths/, built by
scripts/build_career_paths.ts). Plain Python, standard library only, and none
of the build's code: it re-reads the raw O*NET 30.1 files itself and checks

  - every input against its sha256 in data/career_paths/sources.json, and the
    O*NET version, release and license line in the Read Me;
  - every stored link back to its source rows: each row it lists maps to this
    job and to the link's target, the link's tier and Index are the strongest
    of those rows, and it lists EVERY row of the file for that pair;
  - that no link exists without a source row, no self-link is stored, and
    every row is accounted for (a link, a self-link, or an unmapped code);
  - the order of each job's links (tier, then Index, then file line);
  - every Job Zone, worked out again from Job Zones.txt;
  - that the counts in docs/career-paths.md and index.json match.

Mapping rule, written here on its own: an O*NET code belongs to its
seven-character SOC if that SOC is one of the app's 830 jobs; otherwise to the
combined job whose parts (src/config/onetSplitCodes.ts, read as text) include
that SOC; otherwise it is unmapped.

Link rule (own code first, decided 2026-11-22, by part): a code's "part" is
its seven-character SOC (the job itself, or one piece of a combined job).
When a part's .00 code has rows in Related Occupations.txt, only that code's
rows are used for the part; a part with no .00 code uses all of its codes. So
a job with its own .00 uses only it, a combined job (29-2010) uses each part's
.00 (never 29-2011.01/.02/.04 or 29-2012.01), and a SOC with only sub-codes
(15-1299) uses every sub-code: the same rule as the Job Zone below. A related
code always maps to its job by the mapping rule (a sub-code to its parent).

USAGE
  python3 scripts/verify_career_paths.py [--root <dir>]
  --root reads every file under <dir> instead of the repo (tests).
Exit 0 when every check passes, 1 otherwise.
"""

import csv
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "--root" in sys.argv:
    ROOT = os.path.abspath(sys.argv[sys.argv.index("--root") + 1])
TIERS = ["Primary-Short", "Primary-Long", "Supplemental"]
LABEL = "Similar jobs you could move to (O*NET, by similar skills and work)"

failures = []


def fail(msg):
    failures.append(msg)


def rel(p):
    return os.path.join(ROOT, p)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def read_tsv(path):
    """[(line, row)] with the header as line 1. Exact text, no quote handling."""
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        out = []
        for line, r in enumerate(reader, start=2):
            if len(r) != len(header):
                sys.exit(f"{path} line {line}: {len(r)} fields, expected {len(header)}")
            out.append((line, dict(zip(header, r))))
    return header, out


def main():
    sources = json.load(open(rel("data/career_paths/sources.json"), encoding="utf-8"))
    for f in sources["files"]:
        got = sha256(rel(f["path"]))
        if got != f["sha256"]:
            fail(f"sha256 mismatch for {f['path']}: {got}")
    readme = open(rel("data/db_30_1_text/Read Me.txt"), encoding="utf-8").read().splitlines()
    on = sources["onet"]
    if readme[0] != f"{on['version']} Database" or readme[1].strip() != on["release"]:
        fail(f"Read Me banner {readme[:2]} does not match sources.json {on['version']} / {on['release']}")
    if not any(l.startswith(on["licenseText"]) for l in readme) or on["license"] != "CC BY 4.0":
        fail("license in sources.json does not match the Read Me")

    # ── App jobs and the combined table (read as text) ──
    occ = json.load(open(rel("src/data/occupations/index.json"), encoding="utf-8"))["occupations"]
    app = {o["soc"]: o["title"] for o in occ}
    if len(app) != 830:
        fail(f"expected 830 app jobs, found {len(app)}")
    split_src = open(rel("src/config/onetSplitCodes.ts"), encoding="utf-8").read()
    owner = {}
    for table in ("ONET_CODES_FOR_SOC", "ONET_SPLIT_CODES_WITHOUT_TASKS"):
        body = re.search(table + r"[^=]*=\s*\{(.*?)\n\};", split_src, re.S).group(1)
        for combined, codes in re.findall(r"'(\d\d-\d{4})':\s*\[([^\]]*)\]", body):
            for c in re.findall(r"'(\d\d-\d{4})\.\d\d'", codes):
                if c in app:
                    fail(f"{c} is both an app job and a part of {combined}")
                if owner.get(c, combined) != combined:
                    fail(f"{c} is a part of two combined jobs")
                owner[c] = combined

    def to_app(code):
        soc = code[:7]
        if soc in app:
            return soc
        return owner.get(soc)

    # ── Raw O*NET files ──
    _, related = read_tsv(rel("data/db_30_1_text/Related Occupations.txt"))
    _, zone_rows = read_tsv(rel("data/db_30_1_text/Job Zones.txt"))
    zone_of = {}
    for line, r in zone_rows:
        zone_of[r["O*NET-SOC Code"]] = (int(r["Job Zone"]), line)

    # Parts (a code's seven-character SOC) whose .00 code has rows: only those rows are used.
    part_own = {r["O*NET-SOC Code"][:7] for _, r in related
                if r["O*NET-SOC Code"].endswith(".00") and to_app(r["O*NET-SOC Code"]) is not None}
    own_code = {p for p in part_own if p in app}  # jobs with their own .00 code
    pair_rows = defaultdict(list)  # (from_soc, to_soc) -> [(tier_rank, index, line)]
    codes_of = defaultdict(set)    # every code that maps to the job
    used_codes = defaultdict(set)  # the codes whose rows are used
    self_rows = unmapped_rows = not_own_rows = 0
    unmapped_codes = set()
    for line, r in related:
        a, b = r["O*NET-SOC Code"], r["Related O*NET-SOC Code"]
        fa, fb = to_app(a), to_app(b)
        unmapped_codes.update(c for c, m in ((a, fa), (b, fb)) if m is None)
        if fa:
            codes_of[fa].add(a)
        if fa is None:
            unmapped_rows += 1
            continue
        if a[:7] in part_own and not a.endswith(".00"):
            not_own_rows += 1
            continue
        used_codes[fa].add(a)
        if fb is None:
            unmapped_rows += 1
            continue
        if fa == fb:
            self_rows += 1
            continue
        pair_rows[(fa, fb)].append((TIERS.index(r["Relatedness Tier"]), int(r["Index"]), line))
    for code in zone_of:
        if to_app(code) is None:
            unmapped_codes.add(code)
    by_line = {line: r for line, r in related}

    # ── Committed outputs ──
    out_dir = rel("src/data/career_paths")
    stored = {}
    for name in sorted(os.listdir(out_dir)):
        if not re.fullmatch(r"\d\d\.json", name):
            continue
        chunk = json.load(open(os.path.join(out_dir, name), encoding="utf-8"))
        for soc, job in chunk["socs"].items():
            if soc[:2] != name[:2]:
                fail(f"{soc} stored in {name}")
            if soc not in app:
                fail(f"{soc} in {name} is not an app job")
            if soc in stored:
                fail(f"{soc} stored twice")
            stored[soc] = job
    majors = {s[:2] for s in app}
    chunks = {n[:2] for n in os.listdir(out_dir) if re.fullmatch(r"\d\d\.json", n)}
    if chunks != majors:
        fail(f"chunk files {sorted(chunks)} != major groups {sorted(majors)}")

    # Which jobs have data at all.
    with_codes = {s for s in app if codes_of.get(s)}
    if set(stored) != with_codes:
        fail(f"stored jobs differ from jobs with O*NET codes: extra {sorted(set(stored) - with_codes)[:5]}, missing {sorted(with_codes - set(stored))[:5]}")

    # ── Links ──
    seen_lines = set()
    links_total = 0
    for soc, job in stored.items():
        if sorted(used_codes[soc]) != job["onetCodes"]:
            fail(f"{soc}: onetCodes {job['onetCodes']} != {sorted(used_codes[soc])}")
        if soc in own_code and job["onetCodes"] != [soc + ".00"]:
            fail(f"{soc}: has its own .00 code but uses {job['onetCodes']}")
        by_part = sorted(c for c in codes_of[soc] if c.endswith(".00") or c[:7] not in part_own)
        if job["onetCodes"] != by_part:
            fail(f"{soc}: onetCodes {job['onetCodes']} != each part's .00, else its codes {by_part}")
        keys = []
        targets = set()
        for l in job["links"]:
            links_total += 1
            to = l["to"]
            if to == soc:
                fail(f"{soc}: self-link stored")
            if to in targets:
                fail(f"{soc}: two links to {to}")
            targets.add(to)
            if not l["rows"]:
                fail(f"{soc} -> {to}: no source row")
                continue
            for line in l["rows"]:
                r = by_line.get(line)
                if r is None:
                    fail(f"{soc} -> {to}: line {line} is not a data row")
                    continue
                if to_app(r["O*NET-SOC Code"]) != soc or to_app(r["Related O*NET-SOC Code"]) != to:
                    fail(f"{soc} -> {to}: line {line} is {r['O*NET-SOC Code']} -> {r['Related O*NET-SOC Code']}")
                if line in seen_lines:
                    fail(f"line {line} used by two links")
                seen_lines.add(line)
            expected = sorted(pair_rows.get((soc, to), []))
            if sorted(x[2] for x in expected) != l["rows"]:
                fail(f"{soc} -> {to}: rows {l['rows']} != every row for the pair {sorted(x[2] for x in expected)}")
            if expected:
                best = expected[0]
                if (TIERS[best[0]], best[1]) != (l["tier"], l["index"]):
                    fail(f"{soc} -> {to}: tier/index {l['tier']}/{l['index']} != strongest row {TIERS[best[0]]}/{best[1]}")
                keys.append(best)
        if keys != sorted(keys):
            fail(f"{soc}: links not in tier, Index, line order")
    # Every pair from the file is stored.
    missing_pairs = [p for p in pair_rows if p[0] not in stored or p[1] not in {l["to"] for l in stored[p[0]]["links"]}]
    if missing_pairs:
        fail(f"{len(missing_pairs)} pairs in the file have no stored link, e.g. {missing_pairs[:3]}")
    if len(seen_lines) + self_rows + unmapped_rows + not_own_rows != len(related):
        fail(f"rows: {len(seen_lines)} linked + {self_rows} self + {unmapped_rows} unmapped + {not_own_rows} not own code != {len(related)}")
    # No stored row comes from a sub-code whose part has its own .00 code.
    for soc, job in stored.items():
        for l in job["links"]:
            for line in l["rows"]:
                c = by_line[line]["O*NET-SOC Code"]
                if c[:7] in part_own and not c.endswith(".00"):
                    fail(f"{soc} -> {l['to']}: line {line} is from {c}, but {c[:7]}.00 has rows")

    # ── Job Zones ──
    zones_file = json.load(open(os.path.join(out_dir, "zones.json"), encoding="utf-8"))["zones"]
    mixed = []
    for soc, job in stored.items():
        mine = sorted(c for c in zone_of if to_app(c) == soc)
        if f"{soc}.00" in zone_of:
            used, rule = [f"{soc}.00"], ".00"
        else:
            parts = defaultdict(list)
            for c in mine:
                parts[c[:7]].append(c)
            used = sorted(c for p, cs in parts.items() for c in ([p + ".00"] if p + ".00" in cs else cs))
            rule = "combined" if any(c[:7] != soc for c in used) else "sub-codes"
        zs = {zone_of[c][0] for c in used}
        if len(zs) == 1:
            zone = zs.pop()
        else:
            zone, rule = None, "mixed"
            mixed.append(soc)
        if (job["jobZone"], job["jobZoneRule"]) != (zone, rule):
            fail(f"{soc}: Job Zone {job['jobZone']} ({job['jobZoneRule']}) != {zone} ({rule})")
        if job["jobZoneRows"] != sorted(zone_of[c][1] for c in used):
            fail(f"{soc}: jobZoneRows {job['jobZoneRows']} != {sorted(zone_of[c][1] for c in used)}")
        if zone is None and soc in zones_file:
            fail(f"{soc}: mixed but in zones.json")
        if zone is not None and zones_file.get(soc) != zone:
            fail(f"{soc}: zones.json has {zones_file.get(soc)}, expected {zone}")
    if set(zones_file) - set(stored):
        fail(f"zones.json has jobs with no data: {sorted(set(zones_file) - set(stored))}")

    # ── Counts: index.json and the doc ──
    n_links = {s: len(j["links"]) for s, j in stored.items()}
    counts = {
        "jobs": len(app),
        "withLinks": sum(1 for n in n_links.values() if n >= 1),
        "withFivePlus": sum(1 for n in n_links.values() if n >= 5),
        "noData": len(app) - len(stored),
        "withJobZone": len(zones_file),
    }
    index = json.load(open(os.path.join(out_dir, "index.json"), encoding="utf-8"))
    for k, v in counts.items():
        if index["coverage"][k] != v:
            fail(f"index.json coverage.{k} = {index['coverage'][k]}, counted {v}")
    if sorted(index["coverage"]["mixedZones"]) != sorted(mixed):
        fail("index.json mixedZones differ")
    if index["_meta"]["label"] != LABEL:
        fail(f"label is {index['_meta']['label']!r}")

    doc = open(rel("docs/career-paths.md"), encoding="utf-8").read()
    n = lambda v: f"{v:,}"  # noqa: E731
    want = [
        f"- Jobs in the app: **{n(counts['jobs'])}**",
        f"- Jobs with at least 1 link: **{n(counts['withLinks'])} of {n(counts['jobs'])}**",
        f"- Jobs with 5 or more links: **{n(counts['withFivePlus'])} of {n(counts['jobs'])}**",
        f"- Jobs with no O*NET data (no links, no zone): **{n(counts['noData'])}**",
        f"- Jobs with a Job Zone: **{n(counts['withJobZone'])}**; mixed: **{n(len(mixed))}**",
        f"- Links stored: **{n(links_total)}**",
        f"- {n(self_rows)} rows are self-links",
        f"- {n(unmapped_rows)} rows touch an unmapped code",
        f"- {n(not_own_rows)} rows come from sub-codes whose own .00 code (the job's, or a part's) has rows, and are not used",
        f"**\"{LABEL}\"**",
    ]
    for w in want:
        if w not in doc:
            fail(f"docs/career-paths.md does not say: {w}")
    for code in sorted(unmapped_codes):
        if f"- {code} " not in doc:
            fail(f"docs/career-paths.md does not list unmapped code {code}")
    for soc in mixed:
        if f"- {soc} {app[soc]}:" not in doc:
            fail(f"docs/career-paths.md does not list mixed job {soc}")
    for soc in sorted(set(app) - set(stored)):
        if f"{soc} {app[soc]}" not in doc:
            fail(f"docs/career-paths.md does not list no-data job {soc}")

    print("Career paths, checked against the raw O*NET 30.1 files")
    print(f"  {len(sources['files'])} inputs sha256 OK; {on['version']}, {on['release']}, {on['license']}")
    print(f"  {len(stored)} jobs stored, {counts['noData']} no data; {links_total:,} links from {len(seen_lines):,} rows; "
          f"{self_rows} self-link rows, {unmapped_rows} unmapped rows and {not_own_rows:,} sub-code rows whose part has its own .00 not used; "
          f"every one of {len(related):,} rows accounted for")
    combined_own = sorted(s for s in set(stored) - own_code if any(c.endswith(".00") for c in stored[s]["onetCodes"]))
    print(f"  own code first: {len(own_code & set(stored))} jobs use only their .00 rows, {len(combined_own)} combined jobs use each part's .00, "
          f"{len(set(stored) - own_code) - len(combined_own)} use their sub-codes")
    print(f"  {counts['withLinks']} jobs with at least 1 link, {counts['withFivePlus']} with 5 or more")
    print(f"  Job Zones: {counts['withJobZone']} set, {len(mixed)} mixed ({', '.join(mixed)})")
    print(f"  unmapped codes: {', '.join(sorted(unmapped_codes))}")
    if failures:
        print(f"\nFAILED: {len(failures)} problem(s)")
        for f in failures[:50]:
            print(f"  - {f}")
        sys.exit(1)
    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
