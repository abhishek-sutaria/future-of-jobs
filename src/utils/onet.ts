export interface OnetTask {
    name: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

// Map of job titles to Standard Occupational Classification (SOC) codes
// Used for linking to BLS OEWS employment data (national + state).
// SOC codes sourced from O*NET 30.1 / BLS OEWS 2018 SOC structure.
//
// This map is the single source of truth for the OEWS refresh
// (scripts/refresh_oes_data.mjs). Titles sharing a SOC are true aliases:
// each carries its occupation's full published headcount, and the map
// aggregation layer de-dupes by SOC so state totals are never double counted.
export const MAP_TITLE_TO_SOC: Record<string, string> = {
    // Original 13 jobs
    "Marketing Manager":               "11-2021",
    "Market Research Analyst":         "13-1161",
    "Business Intelligence Analyst":   "15-2051",
    "Financial Analyst":               "13-2051",
    "Financial Manager":               "11-3031",
    "Software Developer":              "15-1252",
    "Management Consultant":           "13-1111",
    "Sales Manager":                   "11-2022",
    "Accountant & Auditor":            "13-2011",
    "Operations Research Analyst":     "15-2031",
    "Logistics Analyst":               "13-1081",
    "Securities & Sales Agent":        "41-3031",
    "Supply Chain Manager":            "11-3071",

    // Business / Marketing
    "Brand Manager":                   "11-2021",  // Marketing Managers (same BLS group as Marketing Manager)
    "Public Relations Manager":        "11-2032",  // BLS 2018 SOC: 11-2032 (was 11-2031 pre-2018)
    "Advertising Sales Agent":         "41-3011",
    "Event Coordinator":               "13-1121",
    "Account Executive":               "41-3091",  // Sales Representatives of Services (BLS OES)
    "Sales Representative":            "41-4012",
    "Insurance Sales Agent":           "41-3021",

    // Finance
    "Personal Financial Advisor":      "13-2052",
    "Credit Analyst":                  "13-2041",
    "Budget Analyst":                  "13-2031",
    "Risk Specialist":                 "13-2099",
    "Insurance Underwriter":           "13-2053",
    "Actuary":                         "15-2011",
    "Loan Officer":                    "13-2072",
    // O*NET 13-2054.00 "Financial Risk Specialists" lists "Financial Risk Analyst"
    // as an explicit Alternate Title, and BLS publishes 13-2054 at the detailed
    // level. Previously 13-2099 ("Financial Specialists, All Other"), a residual
    // catch-all that also collided with Risk Specialist above.
    "Financial Risk Analyst":          "13-2054",

    // Data & Technology
    "Data Scientist":                  "15-2051",
    "Statistician":                    "15-2041",
    "Computer Systems Analyst":        "15-1211",
    "UX Designer":                     "15-1255",
    "IT Manager":                      "11-3021",
    "Cybersecurity Analyst":           "15-1212",
    "Web Developer":                   "15-1254",
    "Database Administrator":          "15-1242",
    "IT Project Manager":              "15-1299",

    // Operations
    "Cost Estimator":                  "13-1051",
    "Compensation Analyst":            "13-1141",
    "Purchasing Manager":              "11-3061",
    // BLS retired the detailed codes 13-1022 (Wholesale and Retail Buyers) and
    // 13-1023 (Purchasing Agents) and now publishes only the combined broad code
    // 13-1020 "Buyers and Purchasing Agents". Verified against OEWS May 2025:
    // 13-1021/13-1022/13-1023 return no series; 13-1020 does, including state
    // level. Both titles therefore share the broad-group estimate as aliases.
    "Wholesale & Retail Buyer":        "13-1020",
    "Purchasing Agent":                "13-1020",
    "Industrial Production Manager":   "11-3051",

    // HR & Management
    "General Manager":                 "11-1021",
    "HR Manager":                      "11-3121",
    "Project Management Specialist":   "13-1082",
    "Training & Development Specialist":"13-1151",
    "HR Specialist":                   "13-1071",
    "Training & Development Manager":  "11-3131",
    "Compensation & Benefits Manager": "11-3111",
};

