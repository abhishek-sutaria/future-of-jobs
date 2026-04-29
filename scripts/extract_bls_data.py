#!/usr/bin/env python3
"""
BLS Data Extraction Script
===========================
Extracts REAL data from BLS OES May 2023 (all_data_M_2023.xlsx) and
merges with existing project data to replace all hardcoded values.

Inputs:
  - data/all_data_M_2023.xlsx (BLS OES May 2023 - 413K rows)
  - data/Kelley_Job_Map.csv (SOC → title mapping)
  - data/ai_impact_scores.json (pre-scored tasks, partial)

Outputs:
  - src/data/geo_real.json (real state-level employment data)
  - src/data/national_employment.json (national figures)
  - src/data/bls_extracted.json (full extracted dataset for data.ts)
"""

import csv
import json
import os
import sys

try:
    import openpyxl
except ImportError:
    print("Installing openpyxl...")
    os.system(f"{sys.executable} -m pip install openpyxl -q")
    import openpyxl

# --- Configuration ---
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
SRC_DATA_DIR = os.path.join(PROJECT_ROOT, "src", "data")

XLSX_PATH = os.path.join(DATA_DIR, "all_data_M_2023.xlsx")
CSV_PATH = os.path.join(DATA_DIR, "Kelley_Job_Map.csv")
AI_SCORES_PATH = os.path.join(DATA_DIR, "ai_impact_scores.json")

# BLS Employment Projections 2022-2032
# Source: https://www.bls.gov/ooh/ (Occupational Outlook Handbook)
# These are the OFFICIAL projected percent change in employment, 2022-32
BLS_GROWTH_PROJECTIONS = {
    "11-2021": 7,     # Marketing Managers: 7% (faster than average)
    "13-1161": 13,    # Market Research Analysts: 13% (much faster than average)
    "13-1199": 10,    # Business Operations Specialists, All Other: 10%
    "13-2051": 8,     # Financial Analysts: 8% (faster than average)
    "11-3031": 16,    # Financial Managers: 16% (much faster than average)
    "13-1111": 10,    # Management Analysts/Consultants: 10% (faster than average)
    "11-3071": 18,    # Transportation/Storage/Distribution Managers: 18%
    "13-1081": 18,    # Logisticians: 18% (much faster than average)
    "15-1252": 25,    # Software Developers: 25% (much faster than average)
    "15-2031": 23,    # Operations Research Analysts: 23% (much faster)
    "41-3031": 7,     # Securities/Financial Services Sales Agents: 7%
    "11-2022": 4,     # Sales Managers: 4% (as fast as average)
    "13-2011": 4,     # Accountants and Auditors: 4% (as fast as average)
}

# US State centroid coordinates
# Source: US Census Bureau Geographic Reference Files
STATE_INFO = {
    "Alabama": {"lat": 32.81, "lng": -86.79, "abbr": "AL"},
    "Alaska": {"lat": 63.35, "lng": -152.00, "abbr": "AK"},
    "Arizona": {"lat": 34.05, "lng": -111.09, "abbr": "AZ"},
    "Arkansas": {"lat": 34.75, "lng": -92.29, "abbr": "AR"},
    "California": {"lat": 36.78, "lng": -119.42, "abbr": "CA"},
    "Colorado": {"lat": 39.55, "lng": -105.78, "abbr": "CO"},
    "Connecticut": {"lat": 41.60, "lng": -73.09, "abbr": "CT"},
    "Delaware": {"lat": 38.91, "lng": -75.53, "abbr": "DE"},
    "District of Columbia": {"lat": 38.91, "lng": -77.04, "abbr": "DC"},
    "Florida": {"lat": 27.66, "lng": -81.52, "abbr": "FL"},
    "Georgia": {"lat": 32.17, "lng": -82.90, "abbr": "GA"},
    "Hawaii": {"lat": 19.90, "lng": -155.58, "abbr": "HI"},
    "Idaho": {"lat": 44.07, "lng": -114.74, "abbr": "ID"},
    "Illinois": {"lat": 40.63, "lng": -89.40, "abbr": "IL"},
    "Indiana": {"lat": 40.27, "lng": -86.13, "abbr": "IN"},
    "Iowa": {"lat": 41.88, "lng": -93.10, "abbr": "IA"},
    "Kansas": {"lat": 39.01, "lng": -98.48, "abbr": "KS"},
    "Kentucky": {"lat": 37.67, "lng": -84.65, "abbr": "KY"},
    "Louisiana": {"lat": 30.98, "lng": -91.96, "abbr": "LA"},
    "Maine": {"lat": 45.25, "lng": -69.45, "abbr": "ME"},
    "Maryland": {"lat": 39.05, "lng": -76.64, "abbr": "MD"},
    "Massachusetts": {"lat": 42.41, "lng": -71.38, "abbr": "MA"},
    "Michigan": {"lat": 44.31, "lng": -85.60, "abbr": "MI"},
    "Minnesota": {"lat": 46.73, "lng": -94.69, "abbr": "MN"},
    "Mississippi": {"lat": 32.35, "lng": -89.40, "abbr": "MS"},
    "Missouri": {"lat": 37.96, "lng": -91.83, "abbr": "MO"},
    "Montana": {"lat": 46.88, "lng": -110.36, "abbr": "MT"},
    "Nebraska": {"lat": 41.49, "lng": -99.90, "abbr": "NE"},
    "Nevada": {"lat": 38.80, "lng": -116.42, "abbr": "NV"},
    "New Hampshire": {"lat": 43.19, "lng": -71.57, "abbr": "NH"},
    "New Jersey": {"lat": 40.06, "lng": -74.41, "abbr": "NJ"},
    "New Mexico": {"lat": 34.52, "lng": -105.87, "abbr": "NM"},
    "New York": {"lat": 40.71, "lng": -74.01, "abbr": "NY"},
    "North Carolina": {"lat": 35.76, "lng": -79.02, "abbr": "NC"},
    "North Dakota": {"lat": 47.55, "lng": -101.00, "abbr": "ND"},
    "Ohio": {"lat": 40.42, "lng": -82.91, "abbr": "OH"},
    "Oklahoma": {"lat": 35.01, "lng": -97.09, "abbr": "OK"},
    "Oregon": {"lat": 43.80, "lng": -120.55, "abbr": "OR"},
    "Pennsylvania": {"lat": 41.20, "lng": -77.19, "abbr": "PA"},
    "Rhode Island": {"lat": 41.58, "lng": -71.48, "abbr": "RI"},
    "South Carolina": {"lat": 33.84, "lng": -81.16, "abbr": "SC"},
    "South Dakota": {"lat": 43.97, "lng": -99.90, "abbr": "SD"},
    "Tennessee": {"lat": 35.52, "lng": -86.58, "abbr": "TN"},
    "Texas": {"lat": 31.97, "lng": -99.90, "abbr": "TX"},
    "Utah": {"lat": 39.32, "lng": -111.09, "abbr": "UT"},
    "Vermont": {"lat": 44.56, "lng": -72.58, "abbr": "VT"},
    "Virginia": {"lat": 37.43, "lng": -78.66, "abbr": "VA"},
    "Washington": {"lat": 47.75, "lng": -120.74, "abbr": "WA"},
    "West Virginia": {"lat": 38.60, "lng": -80.45, "abbr": "WV"},
    "Wisconsin": {"lat": 43.78, "lng": -88.79, "abbr": "WI"},
    "Wyoming": {"lat": 43.08, "lng": -107.29, "abbr": "WY"},
    "Guam": {"lat": 13.44, "lng": 144.79, "abbr": "GU"},
    "Puerto Rico": {"lat": 18.22, "lng": -66.59, "abbr": "PR"},
    "Virgin Islands": {"lat": 18.34, "lng": -64.90, "abbr": "VI"},
}


def load_job_map():
    """Load the SOC → title mapping from Kelley_Job_Map.csv"""
    jobs = {}
    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            if len(row) == 1:
                parts = row[0].split(',')
            else:
                parts = row
            if len(parts) >= 4:
                soc = parts[0].strip()
                title = parts[2].strip()
                track = parts[3].strip().strip('"')
                jobs[soc] = {"title": title, "track": track}
    return jobs


def load_ai_scores():
    """Load pre-scored AI impact data"""
    with open(AI_SCORES_PATH, 'r') as f:
        return json.load(f)


def extract_national_data(wb, soc_codes):
    """Extract national employment data for each SOC code from BLS OES"""
    ws = wb.active
    headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
    col_idx = {name: i for i, name in enumerate(headers)}
    
    results = {}
    
    for row in ws.iter_rows(min_row=2):
        vals = [cell.value for cell in row]
        area = str(vals[col_idx['AREA']] or '')
        occ_code = str(vals[col_idx['OCC_CODE']] or '')
        i_group = str(vals[col_idx['I_GROUP']] or '')
        
        # National data: AREA='99', cross-industry
        if area == '99' and i_group == 'cross-industry' and occ_code in soc_codes:
            o_group = str(vals[col_idx['O_GROUP']] or '')
            if o_group == 'detailed':
                tot_emp = vals[col_idx['TOT_EMP']]
                a_mean = vals[col_idx['A_MEAN']]
                a_median = vals[col_idx['A_MEDIAN']]
                
                emp = parse_int(tot_emp)
                salary_mean = parse_int(a_mean)
                salary_median = parse_int(a_median)
                
                results[occ_code] = {
                    "employment": emp,
                    "salary_mean": salary_mean,
                    "salary_median": salary_median,
                }
                print(f"  ✓ {occ_code}: emp={emp:,}, mean=${salary_mean:,}, median=${salary_median:,}")
    
    return results


def extract_state_data(wb, soc_codes, top_n=5):
    """Extract top N states by employment for each SOC code.
    
    BLS OES uses 2-digit FIPS codes for states. We filter for state-level,
    cross-industry, detailed occupation rows.
    """
    ws = wb.active
    headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
    col_idx = {name: i for i, name in enumerate(headers)}
    
    # Build reverse lookup: state name used in xlsx
    state_data = {soc: [] for soc in soc_codes}
    
    for row in ws.iter_rows(min_row=2):
        vals = [cell.value for cell in row]
        area = str(vals[col_idx['AREA']] or '')
        occ_code = str(vals[col_idx['OCC_CODE']] or '')
        i_group = str(vals[col_idx['I_GROUP']] or '')
        o_group = str(vals[col_idx['O_GROUP']] or '')
        area_title = str(vals[col_idx['AREA_TITLE']] or '')
        
        # State-level: AREA is 2-digit (01-72), not '99' (national)
        # Also check that the area_title matches a known state
        is_state = area != '99' and len(area) <= 2 and area_title in STATE_INFO
        
        if is_state and i_group == 'cross-industry' and o_group == 'detailed' and occ_code in soc_codes:
            tot_emp = vals[col_idx['TOT_EMP']]
            loc_q = vals[col_idx['LOC_QUOTIENT']]
            
            emp = parse_int(tot_emp)
            lq = parse_float(loc_q)
            
            if emp > 0:
                state_data[occ_code].append({
                    "state_name": area_title,
                    "employment": emp,
                    "lq": round(lq, 2),
                })
    
    # Sort by employment, take top N
    geo_result = {}
    for soc in soc_codes:
        states = sorted(state_data[soc], key=lambda x: x['employment'], reverse=True)[:top_n]
        geo_result[soc] = []
        for s in states:
            info = STATE_INFO[s['state_name']]
            geo_result[soc].append({
                "name": s['state_name'],
                "lat": info['lat'],
                "lng": info['lng'],
                "employment": s['employment'],
                "lq": s['lq'],
            })
        top_info = f"{states[0]['state_name']} = {states[0]['employment']:,}" if states else "—"
        print(f"  ✓ {soc}: {len(states)} states (top: {top_info})")
    
    return geo_result


def parse_int(val):
    """Safely parse a BLS cell as integer (handles '**', '#', commas)"""
    if not val or str(val).strip() in ('**', '*', '#', ''):
        return 0
    try:
        return int(str(val).replace(',', '').split('.')[0])
    except (ValueError, TypeError):
        return 0


def parse_float(val):
    """Safely parse a BLS cell as float"""
    if not val or str(val).strip() in ('**', '*', '#', ''):
        return 0.0
    try:
        return float(str(val).replace(',', ''))
    except (ValueError, TypeError):
        return 0.0


def main():
    print("=" * 60)
    print("BLS Data Extraction Pipeline")
    print("=" * 60)
    
    # 1. Load job mapping
    print("\n📋 Loading job mapping...")
    job_map = load_job_map()
    soc_codes = list(job_map.keys())
    print(f"   Found {len(soc_codes)} SOC codes")
    
    # 2. Load AI impact scores
    print("\n🤖 Loading AI impact scores...")
    ai_scores = load_ai_scores()
    scored_socs = set(ai_scores.keys())
    missing_socs = set(soc_codes) - scored_socs
    print(f"   Pre-scored: {len(scored_socs)} SOC codes")
    if missing_socs:
        print(f"   ⚠ Missing: {len(missing_socs)} ({sorted(missing_socs)})")
    
    # 3. Open BLS xlsx
    print(f"\n📊 Opening BLS OES data...")
    print("   (scanning 413K rows...)")
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True)
    
    # 4. Extract national employment
    print("\n🇺🇸 National employment:")
    national = extract_national_data(wb, set(soc_codes))
    print(f"   → {len(national)}/{len(soc_codes)} SOC codes found")
    
    # 5. Extract state-level data
    print("\n🏛️  State-level employment (top 5 per SOC):")
    wb2 = openpyxl.load_workbook(XLSX_PATH, read_only=True)
    geo = extract_state_data(wb2, set(soc_codes))
    
    # 6. Write outputs
    print("\n📦 Writing output files...")
    
    # Output 1: geo_real.json
    geo_path = os.path.join(SRC_DATA_DIR, "geo_real.json")
    with open(geo_path, 'w') as f:
        json.dump(geo, f, indent=4)
    print(f"   ✓ {geo_path}")
    
    # Output 2: national_employment.json
    nat_path = os.path.join(SRC_DATA_DIR, "national_employment.json")
    with open(nat_path, 'w') as f:
        json.dump(national, f, indent=4)
    print(f"   ✓ {nat_path}")
    
    # Output 3: bls_extracted.json (comprehensive)
    bls_extracted = {}
    for soc in soc_codes:
        bls_extracted[soc] = {
            "soc_code": soc,
            "title": job_map[soc]["title"],
            "track": job_map[soc]["track"],
            "employment": national.get(soc, {}).get("employment", 0),
            "salary_mean": national.get(soc, {}).get("salary_mean", 0),
            "salary_median": national.get(soc, {}).get("salary_median", 0),
            "projectedGrowth": BLS_GROWTH_PROJECTIONS.get(soc, 0),
            "has_ai_scores": soc in scored_socs,
            "ai_task_count": len(ai_scores.get(soc, [])),
        }
    
    ext_path = os.path.join(SRC_DATA_DIR, "bls_extracted.json")
    with open(ext_path, 'w') as f:
        json.dump(bls_extracted, f, indent=4)
    print(f"   ✓ {ext_path}")
    
    # Summary table
    print("\n" + "=" * 80)
    print("EXTRACTION COMPLETE — Real BLS OES May 2023 Data")
    print("=" * 80)
    print(f"\n{'SOC Code':<12} {'Title':<35} {'Employment':>12} {'Growth':>8} {'Salary':>10}")
    print("-" * 80)
    for soc in soc_codes:
        e = bls_extracted[soc]
        print(f"{soc:<12} {e['title']:<35} {e['employment']:>12,} {e['projectedGrowth']:>7}% ${e['salary_mean']:>8,}")
    
    total_states = sum(len(geo.get(soc, [])) for soc in soc_codes)
    print(f"\n✅ {len(national)} jobs with real national data")
    print(f"✅ {total_states} state entries across {len(soc_codes)} occupations")
    print(f"⚠️  {len(missing_socs)} SOC codes need AI task scoring via Gemini")


if __name__ == "__main__":
    main()
