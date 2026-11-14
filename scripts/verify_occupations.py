#!/usr/bin/env python3
"""
Independent check of src/data/occupations/ against the raw source files.

Shares no code with scripts/build_occupations.py or extract_oews_wages.py and
uses only the standard library: the two workbooks are read as zip archives of
XML (zipfile + ElementTree, no openpyxl), and the O*NET files are split on
CRLF and tab by hand (no csv module). The hierarchy is rebuilt by walking the
OEWS rows in file order rather than by comparing codes, and the O*NET task
rule is re-implemented from its description.

Every stored value is compared with the cell or line it came from. Expected
output: 0 mismatches.

USAGE
  python3 scripts/verify_occupations.py
"""

import hashlib
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "data", "occupations")
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

mismatches = []
checked = {"oews": 0, "ep": 0, "onet": 0, "index": 0}


def fail(msg):
    mismatches.append(msg)


def same(kind, where, got, want):
    checked[kind] += 1
    if got != want or isinstance(got, bool) != isinstance(want, bool):
        fail(f"{where}: stored {got!r}, source {want!r}")


# ── raw xlsx ──────────────────────────────────────────────────────────────

def sheet_cells(path, sheet_name):
    """{(row, column letters): raw text} for one sheet, plus the row order."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rid = next(s.get(REL) for s in wb.find("m:sheets", NS) if s.get("name") == sheet_name)
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = next(r.get("Target") for r in rels if r.get("Id") == rid)
    target = target.lstrip("/") if target.startswith("/") else "xl/" + target
    cells, rows = {}, []
    for row in ET.fromstring(z.read(target)).find("m:sheetData", NS):
        n = int(row.get("r"))
        rows.append(n)
        for c in row:
            ref = c.get("r")
            letters = re.match(r"[A-Z]+", ref).group(0)
            t = c.get("t")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
            else:
                v = c.find("m:v", NS)
                if v is None:
                    continue
                val = shared[int(v.text)] if t == "s" else v.text
                if t not in ("s", "str", None, "n", "b"):
                    raise SystemExit(f"unhandled cell type {t} at {ref}")
                if t in (None, "n"):
                    val = ("num", v.text)
            cells[(n, letters)] = val
    return cells, rows


def header_letters(cells, row):
    return {v.strip(): l for (r, l), v in cells.items() if r == row and isinstance(v, str)}


def num(raw):
    """Raw numeric cell text -> int or float, the way JSON would hold it."""
    f = float(raw[1])
    return int(f) if f.is_integer() and re.fullmatch(r"-?\d+", raw[1]) else f


def text(raw):
    return raw if isinstance(raw, str) else None


def as_str(raw):
    """Cell text whether stored as a string or a number (codes like AREA 99)."""
    return raw[1] if isinstance(raw, tuple) else raw


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main():
    index = json.load(open(os.path.join(OUT, "index.json"), encoding="utf-8"))
    meta = index["_meta"]
    files = {c["code"]: json.load(open(os.path.join(OUT, c["file"]), encoding="utf-8")) for c in index["continents"]}
    entries = {soc: e for f in files.values() for soc, e in f["occupations"].items()}
    print(f"\nverify_occupations: {len(index['continents'])} continents, {len(entries)} entries\n")

    # ── hashes ──
    s = meta["sources"]
    for label, path, want in [
        ("OEWS", s["oews"]["file"], s["oews"]["sha256"]),
        ("EP", s["ep"]["file"], s["ep"]["sha256"]),
        *[(f"O*NET {n}", os.path.join(s["onet"]["dir"], n), h) for n, h in s["onet"]["sha256"].items()],
    ]:
        got = sha(os.path.join(ROOT, path))
        print(f"  sha256 {'OK ' if got == want else 'BAD'} {got}  {label}")
        if got != want:
            fail(f"{label} sha256 {got} != stored {want}")

    # ── OEWS ──
    cells, rows = sheet_cells(os.path.join(ROOT, s["oews"]["file"]), s["oews"]["sheet"])
    H = header_letters(cells, 1)
    get = lambda r, name: cells.get((r, H[name]))  # noqa: E731
    fields = {"employment": "TOT_EMP", "annualMedian": "A_MEDIAN", "annualMean": "A_MEAN", "hourlyMedian": "H_MEDIAN",
              "hourlyMean": "H_MEAN", "annualPct10": "A_PCT10", "annualPct90": "A_PCT90"}

    major = minor = None
    broad_row = {}
    detailed_rows = {}
    minor_members, majors, minors = {}, {}, {}
    for r in rows[1:]:
        if as_str(get(r, "AREA")) != "99" or as_str(get(r, "NAICS")) != "000000":
            continue
        code, group = text(get(r, "OCC_CODE")), text(get(r, "O_GROUP"))
        if group == "major":
            major, minor = code, None
            majors[code] = r
        elif group == "minor":
            minor = code
            minors[code] = (r, major)
            minor_members[code] = []
        elif group == "broad":
            broad_row[code] = r
        elif group == "detailed":
            if code in detailed_rows:
                fail(f"OEWS detailed {code} twice")
            detailed_rows[code] = (r, major, minor)
            minor_members[minor].append(code)

    if set(detailed_rows) != set(entries):
        fail(f"detailed codes differ: only OEWS {sorted(set(detailed_rows) - set(entries))}, only JSON {sorted(set(entries) - set(detailed_rows))}")

    for soc, (r, mj, mn) in sorted(detailed_rows.items()):
        e = entries.get(soc)
        if not e:
            continue
        where = f"{soc} (OEWS row {r})"
        same("oews", f"{where} title", e["title"], text(get(r, "OCC_TITLE")))
        same("oews", f"{where} major", e["major"], mj)
        same("oews", f"{where} minor", e["minor"], mn)
        same("oews", f"{where} first row", e["oewsRows"][0], r)
        b = soc[:6] + "0"
        same("oews", f"{where} broad", e["broad"], b if b in broad_row else None)
        if len(e["oewsRows"]) > 1:
            same("oews", f"{where} second row is the broad row", e["oewsRows"][1:], [broad_row.get(soc)])
        annual_only = text(get(r, "ANNUAL")) == "TRUE"
        hourly_only = text(get(r, "HOURLY")) == "TRUE"
        same("oews", f"{where} annualOnly", e["annualOnly"], annual_only)
        same("oews", f"{where} hourlyOnly", e["hourlyOnly"], hourly_only)
        for f, colname in fields.items():
            raw = get(r, colname)
            ref = f"oews:{s['oews']['sheet']}!{H[colname]}{r}"
            same("oews", f"{where} {f} source", e["sources"].get(f), ref)
            if isinstance(raw, tuple):
                same("oews", f"{where} {f}", e[f], num(raw))
            elif raw in ("*", "**", "#"):
                same("oews", f"{where} {f} null for {raw!r}", e[f], None)
                if not e["nullReasons"].get(f):
                    fail(f"{where} {f}: null without reason")
                if raw == "#" and not e["topcoded"].get(f):
                    fail(f"{where} {f}: '#' but not marked topcoded")
                if raw == "*" and hourly_only and f.startswith("annual") and "only hourly" not in e["nullReasons"].get(f, ""):
                    fail(f"{where} {f}: hourly-only reason missing")
                if raw == "*" and annual_only and f.startswith("hourly") and "only annual" not in e["nullReasons"].get(f, ""):
                    fail(f"{where} {f}: annual-only reason missing")
            else:
                fail(f"{where} {f}: unexpected raw value {raw!r}")

    for c in index["continents"]:
        r = majors[c["soc"]]
        same("oews", f"continent {c['soc']} title", c["title"], text(get(r, "OCC_TITLE")))
        same("oews", f"continent {c['soc']} employment", c["employment"], num(get(r, "TOT_EMP")))
        want_minors = sorted(m for m, (_, mj) in minors.items() if mj == c["soc"])
        same("oews", f"continent {c['soc']} minor groups", [g["soc"] for g in c["minorGroups"]], want_minors)
        for g in c["minorGroups"]:
            mr = minors[g["soc"]][0]
            same("oews", f"minor {g['soc']} title", g["title"], text(get(mr, "OCC_TITLE")))
            same("oews", f"minor {g['soc']} employment", g["employment"], num(get(mr, "TOT_EMP")))
            same("oews", f"minor {g['soc']} members", g["socs"], minor_members[g["soc"]])
        for g in files[c["code"]]["broadGroups"]:
            br = broad_row[g["soc"]]
            same("oews", f"broad {g['soc']} title", g["title"], text(get(br, "OCC_TITLE")))
            same("oews", f"broad {g['soc']} employment", g["employment"], num(get(br, "TOT_EMP")))
        same("oews", f"continent {c['soc']} broad groups", [g["soc"] for g in files[c["code"]]["broadGroups"]],
             sorted(b for b in broad_row if b[:2] == c["code"]))

    # ── EP Table 1.2 ──
    cells, rows = sheet_cells(os.path.join(ROOT, s["ep"]["file"]), s["ep"]["sheet"])
    E = header_letters(cells, 2)
    eget = lambda r, name: cells.get((r, E[name]))  # noqa: E731
    ep_cols = {"employment2025": "Employment, 2025", "employment2035": "Employment, 2035",
               "numericChange": "Employment change, numeric, 2025–35", "percentChange": "Employment change, percent, 2025–35"}
    ep_lines, ep_summaries = {}, {}
    for r in rows:
        kind = text(eget(r, "Occupation type"))
        code = text(eget(r, "2025 National Employment Matrix code"))
        if kind == "Line item":
            ep_lines[code] = r
        elif kind == "Summary":
            if code in ep_summaries:
                fail(f"EP summary {code} twice")
            ep_summaries[code] = r

    def check_ep_block(where, block, block_sources, r):
        """One stored EP block (title + the four columns) against its raw row."""
        if block is None:
            fail(f"{where}: ep is null but EP row {r} exists")
            return
        same("ep", f"{where} title", block["title"], text(eget(r, "2025 National Employment Matrix title")).strip())
        same("ep", f"{where} title source", block_sources.get("ep.title"),
             f"ep:{s['ep']['sheet']}!{E['2025 National Employment Matrix title']}{r}")
        for f, colname in ep_cols.items():
            raw = eget(r, colname)
            same("ep", f"{where} {f} source", block_sources.get(f"ep.{f}"), f"ep:{s['ep']['sheet']}!{E[colname]}{r}")
            if not isinstance(raw, tuple):
                fail(f"{where} {f}: non-numeric {raw!r}")
                continue
            stored = block[f]
            if f == "percentChange":
                same("ep", f"{where} {f}", float(stored), float(raw[1]))
            else:
                checked["ep"] += 1
                if not isinstance(stored, int) or stored / 1000 != float(raw[1]):
                    fail(f"{where} {f}: stored {stored!r} persons, source {raw[1]} thousand")
    for soc, e in sorted(entries.items()):
        r = ep_lines.get(soc)
        if r is None:
            same("ep", f"{soc} ep null (no line item)", e["ep"], None)
            continue
        if e["ep"] is None:
            fail(f"{soc}: EP line item at row {r} but ep is null")
            continue
        where = f"{soc} (EP row {r})"
        same("ep", f"{where} title", e["ep"]["title"], text(eget(r, "2025 National Employment Matrix title")).strip())
        for f, colname in ep_cols.items():
            raw = eget(r, colname)
            same("ep", f"{where} {f} source", e["sources"].get(f"ep.{f}"), f"ep:{s['ep']['sheet']}!{E[colname]}{r}")
            if not isinstance(raw, tuple):
                fail(f"{where} {f}: non-numeric {raw!r}")
                continue
            stored = e["ep"][f]
            if f == "percentChange":
                same("ep", f"{where} {f}", float(stored), float(raw[1]))
            else:
                # Stored in persons; source is thousands. Correctly rounded division
                # must give back the source's double exactly.
                checked["ep"] += 1
                if not isinstance(stored, int) or stored / 1000 != float(raw[1]):
                    fail(f"{where} {f}: stored {stored!r} persons, source {raw[1]} thousand")
    # Region totals: the published summary row for every continent and minor group, never a sum.
    for c in index["continents"]:
        r = ep_summaries.get(c["soc"])
        if r is None:
            fail(f"continent {c['soc']}: no EP summary row")
        else:
            check_ep_block(f"continent {c['soc']} (EP row {r})", c.get("ep"), c["sources"], r)
        for g in c["minorGroups"]:
            r = ep_summaries.get(g["soc"])
            if r is None:
                fail(f"minor {g['soc']}: no EP summary row")
            else:
                check_ep_block(f"minor {g['soc']} (EP row {r})", g.get("ep"), g["sources"], r)
    total = s["ep"]["allOccupations"]
    check_ep_block(f"all occupations (EP row {ep_summaries['00-0000']})", total, total["sources"], ep_summaries["00-0000"])
    groups = {c["soc"] for c in index["continents"]} | {g["soc"] for c in index["continents"] for g in c["minorGroups"]}
    same("ep", "unmatched EP summary groups", [u["soc"] for u in meta["unmatched"]["epSummaryWithoutOews"]],
         sorted(k for k in ep_summaries if k.endswith("00") and k != "00-0000" and k not in groups))

    only_ep = sorted(set(ep_lines) - set(entries))
    only_oews = sorted(set(entries) - set(ep_lines))
    same("ep", "unmatched EP lines", [u["soc"] for u in meta["unmatched"]["epWithoutOews"]], only_ep)
    same("ep", "unmatched OEWS codes", [u["soc"] for u in meta["unmatched"]["oewsWithoutEp"]], only_oews)

    # ── O*NET ──
    def lines_of(name):
        raw = open(os.path.join(ROOT, s["onet"]["dir"], name), "rb").read().decode("utf-8")
        out = raw.split("\r\n")
        if out[-1] == "":
            out.pop()
        return [ln.split("\t") for ln in out]

    occ = lines_of("Occupation Data.txt")
    occ_line = {f[0]: (i + 1, f) for i, f in enumerate(occ) if i}
    task_lines = lines_of("Task Statements.txt")
    tasks_by_code = {}
    for i, f in enumerate(task_lines):
        if i:
            tasks_by_code.setdefault(f[0], []).append((i + 1, f))

    total_tasks = 0
    for soc, e in sorted(entries.items()):
        codes = sorted(c for c in occ_line if c.startswith(soc + "."))
        base = soc + ".00"
        if base in occ_line:
            ln, f = occ_line[base]
            same("onet", f"{soc} description", e["description"], f[2])
            same("onet", f"{soc} description source", e["sources"].get("description"), f"onet:Occupation Data.txt#L{ln}:Description")
            same("onet", f"{soc} onetCode", e["onetCode"], base)
        else:
            same("onet", f"{soc} description", e["description"], None)
            same("onet", f"{soc} onetCode", e["onetCode"], None)
        if tasks_by_code.get(base):
            want = [(ln, f) for ln, f in tasks_by_code[base]]
        else:
            want, seen = [], set()
            for c in codes:
                for ln, f in tasks_by_code.get(c, []):
                    if f[2] not in seen:
                        seen.add(f[2])
                        want.append((ln, f))
        same("onet", f"{soc} task count", len(e["tasks"]), len(want))
        for t, (ln, f) in zip(e["tasks"], want):
            same("onet", f"{soc} task line", t["line"], ln)
            same("onet", f"{soc} task {f[1]} code", t["onetCode"], f[0])
            same("onet", f"{soc} task {f[1]} id", t["id"], int(f[1]))
            same("onet", f"{soc} task {f[1]} text", t["text"], f[2])
            same("onet", f"{soc} task {f[1]} type", t["type"], f[3])
        if not want and not e["nullReasons"].get("tasks"):
            fail(f"{soc}: no tasks and no reason")
        total_tasks += len(want)

    # ── index ──
    for row in index["occupations"]:
        e = entries[row["soc"]]
        for k, v in [("title", e["title"]), ("minor", e["minor"]), ("employment", e["employment"]),
                     ("annualMedian", e["annualMedian"]), ("epPercentChange", e["ep"]["percentChange"] if e["ep"] else None),
                     ("epEmployment2025", e["ep"]["employment2025"] if e["ep"] else None),
                     ("epEmployment2035", e["ep"]["employment2035"] if e["ep"] else None),
                     ("taskCount", len(e["tasks"]))]:
            same("index", f"index {row['soc']} {k}", row[k], v)
    same("index", "index occupation count", len(index["occupations"]), len(detailed_rows))
    same("index", "index task total", meta["counts"]["tasks"], total_tasks)

    # ── report ──
    print(f"\n  OEWS  values checked against raw XML: {checked['oews']:,}")
    print(f"  EP    values checked against raw XML: {checked['ep']:,}")
    print(f"  O*NET values checked against raw text: {checked['onet']:,}")
    print(f"  index values checked against continent files: {checked['index']:,}")
    print(f"\n  mismatches: {len(mismatches)}")
    for m in mismatches[:50]:
        print(f"    {m}")
    print()
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
