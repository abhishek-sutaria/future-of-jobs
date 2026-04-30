export interface OnetTask {
    name: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

// Map of job titles to Standard Occupational Classification (SOC) codes
// Used for linking to BLS OES geographic employment data
// SOC codes sourced from O*NET 28.2 / BLS OES standard classification
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
    "Brand Manager":                   "11-2021",  // alias: Advertising & Promotions Managers
    "Public Relations Manager":        "11-2031",
    "Advertising Sales Agent":         "41-3011",
    "Event Coordinator":               "13-1121",
    "Account Executive":               "41-3099",
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
    "Financial Risk Analyst":          "13-2099",

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
    "Wholesale & Retail Buyer":        "13-1022",
    "Purchasing Agent":                "13-1023",
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

