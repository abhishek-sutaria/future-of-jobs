#!/usr/bin/env python3
"""
Extract national pay for every mapped role from the official BLS OEWS
May 2025 national workbook into src/data/national_wages.json.

Dev-only tool (openpyxl); nothing here ships in the app bundle.

Source: data/national_M2025_dl.xlsx, unmodified from
https://www.bls.gov/oes/special-requests/oesm25nat.zip. api.bls.gov was
returning 503 when this was built, and www.bls.gov blocks scripted
downloads, so the workbook was downloaded by hand and committed as-is.

HARD RULES
  - The workbook's SHA-256 must match EXPECTED_SHA256, or nothing is read.
  - Before anything is written, TOT_EMP for every SOC must equal the
    employment in src/data/national_employment.json. A mismatch means a
    different release from the one the site shows, so the run aborts.
  - Values are copied exactly. Nothing is converted (hourly is never turned
    into annual), rounded, interpolated, or borrowed from another SOC/year.
  - Workbook symbols, as defined on its own "Field Descriptions" sheet:
      "#"  wage at or above BLS's cap  -> null, topcoded: true
      "*"  wage estimate not available -> null, with that reason
      ANNUAL = TRUE / HOURLY = TRUE    -> only that measure is published;
                                          the other is null, with that reason
    Any other text in a wage cell aborts the run rather than being guessed at.
  - The cap amount is read from the notes sheet, never hardcoded.
  - Titles that share a SOC share one entry; wages are never split.

USAGE
  python3 scripts/extract_oews_wages.py [--dry-run]
"""

import datetime
import hashlib
import json
import os
import re
import sys

try:
    import openpyxl
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKBOOK = os.path.join(ROOT, "data", "national_M2025_dl.xlsx")
WORKBOOK_URL = "https://www.bls.gov/oes/special-requests/oesm25nat.zip"
EXPECTED_SHA256 = "852250997ceff9b721ff68f63e877d818f9c1ec8b1b69dd367958faedd5282b2"
DATA_SHEET = "national_M2025_dl"
NOTES_SHEET = "Field Descriptions"
BLS_RELEASE = "OEWS May 2025"
ONET_TS = os.path.join(ROOT, "src", "utils", "onet.ts")
EMPLOYMENT_JSON = os.path.join(ROOT, "src", "data", "national_employment.json")
OUT = os.path.join(ROOT, "src", "data", "national_wages.json")

# JSON measure -> workbook column. annualPct10/90 are stored, not yet shown.
MEASURES = {
    "annualMedian": "A_MEDIAN",
    "annualMean": "A_MEAN",
    "hourlyMedian": "H_MEDIAN",
    "hourlyMean": "H_MEAN",
    "annualPct10": "A_PCT10",
    "annualPct90": "A_PCT90",
}
ANNUAL_MEASURES = {"annualMedian", "annualMean", "annualPct10", "annualPct90"}

# Equivalent api.bls.gov series (OEUN0000000000000{SOC6}{datatype}), kept so
# scripts/verify_wages.mjs can cross-check the API once it answers. Codes
# checked against https://download.bls.gov/pub/time.series/oe/oe.datatype.
SERIES_DATATYPES = {"annualMedian": "13", "annualMean": "04", "hourlyMedian": "08", "hourlyMean": "03"}

DRY_RUN = "--dry-run" in sys.argv


def die(msg):
    sys.exit(f"\nextract_oews_wages: ABORT: {msg}\n")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def soc_map():
    src = open(ONET_TS, encoding="utf-8").read()
    block = re.search(r"MAP_TITLE_TO_SOC[^=]*=\s*\{([\s\S]*?)\n\};", src)
    if not block:
        die("could not find MAP_TITLE_TO_SOC in src/utils/onet.ts")
    return dict(re.findall(r'"([^"]+)"\s*:\s*"(\d{2}-\d{4})"', block.group(1)))


def read_notes(wb):
    """Pull the field definitions and symbol notes BLS ships in the workbook."""
    fields, notes, title = {}, {}, None
    for row in wb[NOTES_SHEET].iter_rows(values_only=True):
        a, b = (row + (None, None))[:2]
        if not isinstance(a, str):
            continue
        a_clean = a.strip()
        if title is None:
            title = a_clean
        if b and re.fullmatch(r"[a-z0-9_ ]+", a_clean):
            fields[a_clean.upper().replace(" ", "_")] = str(b).strip()
        for sym in ("#", "*"):
            if re.match(rf"^\{sym}\s+=", a_clean):
                notes[sym] = a_clean
    if title is None or "May 2025" not in title:
        die(f'notes sheet title is "{title}", expected a May 2025 release')
    for sym in ("#", "*"):
        if sym not in notes:
            die(f'notes sheet has no "{sym}" definition')
    cap = re.search(r"\$([\d,]+(?:\.\d+)?) per hour or \$([\d,]+(?:\.\d+)?) per year", notes["#"])
    if not cap:
        die(f'could not read the cap from: "{notes["#"]}"')
    topcode = {
        "symbol": "#",
        "text": notes["#"],
        "hourly": float(cap.group(1).replace(",", "")),
        "annual": int(cap.group(2).replace(",", "")),
    }
    return title, fields, notes, topcode


def read_cell(raw, measure, annual_only, hourly_only, ctx):
    """One workbook wage cell -> (value, topcoded, null reason). Never converts."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return raw, False, None
    if raw == "#":
        return None, True, f'Top-coded: "#" in the BLS workbook ({ctx["topcode"]["text"]})'
    if raw == "*":
        if hourly_only and measure in ANNUAL_MEASURES:
            return None, False, f"BLS releases only hourly wages for this occupation: {ctx['fields'].get('HOURLY')}"
        if annual_only and measure not in ANNUAL_MEASURES:
            return None, False, f"BLS releases only annual wages for this occupation: {ctx['fields'].get('ANNUAL')}"
        return None, False, f'Not available: "*" in the BLS workbook ({ctx["notes"]["*"]})'
    if raw in (None, ""):
        return None, False, "Blank in the BLS workbook"
    raise ValueError(f"unrecognised workbook value {raw!r}")


def self_test(ctx, ws, col):
    """
    Our 47 SOCs may contain no symbols at all, so prove the handling on
    synthetic cells and on real rows of this workbook that do carry them.
    """
    assert read_cell(105770, "annualMedian", False, False, ctx) == (105770, False, None)
    v, top, why = read_cell("#", "annualMedian", False, False, ctx)
    assert v is None and top and ctx["topcode"]["text"] in why
    v, top, why = read_cell("*", "annualMean", False, False, ctx)
    assert v is None and not top and "not available" in why
    assert "only hourly" in read_cell("*", "annualMedian", False, True, ctx)[2]
    assert "only annual" in read_cell("*", "hourlyMedian", True, False, ctx)[2]
    try:
        read_cell("~", "annualMedian", False, False, ctx)
        raise AssertionError("unknown symbol accepted")
    except ValueError:
        pass

    checked = {"ANNUAL": None, "HOURLY": None}
    rows = ws.iter_rows(values_only=True)
    next(rows)
    for excel_row, r in enumerate(rows, start=2):
        for flag, nulls, kept in (("ANNUAL", "H_MEDIAN", "A_MEDIAN"), ("HOURLY", "A_MEDIAN", "H_MEDIAN")):
            if checked[flag] is None and r[col[flag]] == "TRUE":
                null_measure = "hourlyMedian" if flag == "ANNUAL" else "annualMedian"
                kept_measure = "annualMedian" if flag == "ANNUAL" else "hourlyMedian"
                a, h = flag == "ANNUAL", flag == "HOURLY"
                v, _, why = read_cell(r[col[nulls]], null_measure, a, h, ctx)
                assert v is None and f"only {flag.lower()}" in why, (excel_row, why)
                kv, _, _ = read_cell(r[col[kept]], kept_measure, a, h, ctx)
                assert kv is not None, excel_row
                checked[flag] = f"row {excel_row} {r[col['OCC_CODE']]}"
    print(f"  self-test OK (synthetic #, *, blank, unknown; real ANNUAL=TRUE {checked['ANNUAL']}, HOURLY=TRUE {checked['HOURLY']})")


def main():
    print(f"\nBLS OEWS wages from {os.path.relpath(WORKBOOK, ROOT)}\n")

    # ── 1. Integrity ──
    if not os.path.exists(WORKBOOK):
        die(f"{WORKBOOK} not found")
    digest = sha256(WORKBOOK)
    if digest != EXPECTED_SHA256:
        die(f"SHA-256 mismatch\n  expected {EXPECTED_SHA256}\n  got      {digest}\nThe workbook was modified or replaced; refusing to read it.")
    print(f"  sha256 OK  {digest}")

    wb = openpyxl.load_workbook(WORKBOOK, read_only=True, data_only=True)
    notes_title, fields, notes, topcode = read_notes(wb)
    print(f'  notes: "{notes_title}"')
    print(f'  cap:   "{topcode["text"]}"')

    ws = wb[DATA_SHEET]
    rows = ws.iter_rows(values_only=True)
    header = [str(h).strip() for h in next(rows)]
    col = {name: i for i, name in enumerate(header)}
    for needed in ["AREA", "NAICS", "I_GROUP", "OWN_CODE", "OCC_CODE", "OCC_TITLE", "O_GROUP", "TOT_EMP", "ANNUAL", "HOURLY", *MEASURES.values()]:
        if needed not in col:
            die(f"column {needed} missing from {DATA_SHEET}")
    letter = {name: get_column_letter(i + 1) for name, i in col.items()}

    # ── 2. National, cross-industry rows for our SOCs ──
    titles = soc_map()
    socs = sorted(set(titles.values()))
    print(f"  SOC map: {len(titles)} titles -> {len(socs)} SOCs")

    found = {soc: [] for soc in socs}
    for excel_row, r in enumerate(rows, start=2):
        if str(r[col["AREA"]]) != "99" or str(r[col["NAICS"]]) != "000000" or r[col["I_GROUP"]] != "cross-industry":
            continue
        soc = r[col["OCC_CODE"]]
        if soc in found:
            found[soc].append((excel_row, r))

    missing = [s for s in socs if not found[s]]
    if missing:
        die(f"no national cross-industry row for {', '.join(missing)}")

    # Broad codes OEWS publishes at the broad level appear twice (once
    # "broad", once "detailed"). Both rows must agree; we cite both.
    compare = ["OCC_TITLE", "TOT_EMP", "ANNUAL", "HOURLY", *MEASURES.values()]
    picked = {}
    for soc in socs:
        hits = found[soc]
        if len({tuple(r[col[c]] for c in compare) for _, r in hits}) != 1:
            die(f"{soc} has {len(hits)} rows that disagree: {[n for n, _ in hits]}")
        hits.sort(key=lambda h: h[1][col["O_GROUP"]] != "detailed")
        picked[soc] = hits

    # ── 3. Vintage gate: must be the release the site already shows ──
    employment = json.load(open(EMPLOYMENT_JSON, encoding="utf-8"))
    if employment["_meta"].get("bls_release") != BLS_RELEASE:
        die(f'national_employment.json is {employment["_meta"].get("bls_release")}, workbook is {BLS_RELEASE}')
    mismatches = []
    for soc in socs:
        wb_emp = picked[soc][0][1][col["TOT_EMP"]]
        site_emp = employment.get(soc, {}).get("employment")
        if wb_emp != site_emp:
            mismatches.append(f"{soc}: workbook TOT_EMP {wb_emp} != national_employment.json {site_emp}")
    print(f"  vintage gate: TOT_EMP vs national_employment.json -> {len(mismatches)} mismatches across {len(socs)} SOCs")
    if mismatches:
        die("different release from the site's employment figures:\n  " + "\n  ".join(mismatches))

    # ── 4. Build entries ──
    ctx = {"topcode": topcode, "notes": notes, "fields": fields}
    self_test(ctx, ws, col)
    entries = {}
    for soc in socs:
        hits = picked[soc]
        r = hits[0][1]
        annual_only = r[col["ANNUAL"]] == "TRUE"
        hourly_only = r[col["HOURLY"]] == "TRUE"
        if r[col["ANNUAL"]] not in ("", None, "TRUE") or r[col["HOURLY"]] not in ("", None, "TRUE"):
            die(f"{soc}: unexpected ANNUAL/HOURLY flag {r[col['ANNUAL']]!r}/{r[col['HOURLY']]!r}")

        entry = {
            "occTitle": r[col["OCC_TITLE"]],
            "source": {
                "sheet": DATA_SHEET,
                "rows": [n for n, _ in hits],
                "oGroups": [h[col["O_GROUP"]] for _, h in hits],
                "columns": {m: letter[c] for m, c in MEASURES.items()}
                | {"annualOnly": letter["ANNUAL"], "hourlyOnly": letter["HOURLY"], "totEmp": letter["TOT_EMP"]},
            },
            "seriesIds": {m: f"OEUN0000000000000{soc.replace('-', '')}{dt}" for m, dt in SERIES_DATATYPES.items()},
            "annualOnly": annual_only,
            "hourlyOnly": hourly_only,
            "topcoded": {},
            "nullReasons": {},
        }
        for m, c in MEASURES.items():
            try:
                value, topcoded, reason = read_cell(r[col[c]], m, annual_only, hourly_only, ctx)
            except ValueError as err:
                die(f"{soc} {c} (row {hits[0][0]}): {err}")
            entry[m] = value
            entry["topcoded"][m] = topcoded
            if reason:
                entry["nullReasons"][m] = reason
        entries[soc] = entry

    # ── 5. Write ──
    out = {
        "_meta": {
            "source": "BLS OEWS May 2025, national_M2025_dl.xlsx",
            "source_url": WORKBOOK_URL,
            "sha256": digest,
            "method": "workbook",
            "bls_release": BLS_RELEASE,
            "api_vintage": "2025 A01",
            "extracted": datetime.date.today().isoformat(),
            "filter": "AREA = 99 (U.S.), NAICS = 000000, I_GROUP = cross-industry",
            "workbook_notes_title": notes_title,
            "topcode": topcode,
            "not_available_note": notes["*"],
            "field_definitions": {c: fields.get(c) for c in [*MEASURES.values(), "ANNUAL", "HOURLY", "TOT_EMP"]},
            "series_id_format": "OEUN0000000000000{SOC6}{datatype}",
            "series_datatypes": {
                m: {"code": dt, "oe_datatype": name}
                for (m, dt), name in zip(
                    SERIES_DATATYPES.items(),
                    ["Annual median wage", "Annual mean wage", "Hourly median wage", "Hourly mean wage"],
                )
            },
            "series_datatypes_source": "https://download.bls.gov/pub/time.series/oe/oe.datatype",
            "vintage_gate": f"TOT_EMP equals src/data/national_employment.json for all {len(socs)} SOCs",
            "note": (
                "Values are copied from the workbook unchanged. null means BLS did not publish that measure; "
                "nullReasons says why. Titles sharing a SOC show the same wage (never split). Hourly and annual "
                "figures are separate BLS columns; neither is derived from the other here."
            ),
            "note_refresh": "Regenerate with: python3 scripts/extract_oews_wages.py",
        },
        **entries,
    }
    if DRY_RUN:
        print("\n  --dry-run: not writing")
    else:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\n  wrote {os.path.relpath(OUT, ROOT)}")

    # ── 6. Report ──
    def fmt(e, m):
        if e["topcoded"][m]:
            return f">={topcode['annual' if m in ANNUAL_MEASURES else 'hourly']:,}"
        return "null" if e[m] is None else f"{e[m]:,}"

    print(f"\n  {'SOC':<8} {'ROW':>5} {'A_MEDIAN':>10} {'A_MEAN':>10} {'H_MEDIAN':>9} {'H_MEAN':>9}  TITLES")
    for soc in socs:
        e = entries[soc]
        names = " / ".join(t for t, s in titles.items() if s == soc)
        print(f"  {soc:<8} {e['source']['rows'][0]:>5} {fmt(e, 'annualMedian'):>10} {fmt(e, 'annualMean'):>10} "
              f"{fmt(e, 'hourlyMedian'):>9} {fmt(e, 'hourlyMean'):>9}  {names}")
    with_median = [s for s in socs if entries[s]["annualMedian"] is not None]
    print(f"\n  annual median: {len(with_median)}/{len(socs)} SOCs "
          f"({sum(1 for t in titles if titles[t] in with_median)}/{len(titles)} roles)")
    for soc in socs:
        for m, why in entries[soc]["nullReasons"].items():
            print(f"  NULL {soc} {m}: {why}")
        for m, flag in entries[soc]["topcoded"].items():
            if flag:
                print(f"  TOPCODED {soc} {m}")
    print()


if __name__ == "__main__":
    main()
