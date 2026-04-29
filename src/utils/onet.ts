export interface OnetTask {
    name: string;
    aiCapabilityScore: number;
    humanCriticalityScore: number;
}

// Map of job titles to Standard Occupational Classification (SOC) codes
// Used for linking to BLS OES geographic employment data
export const MAP_TITLE_TO_SOC: Record<string, string> = {
    "Marketing Manager": "11-2021",
    "Market Research Analyst": "13-1161",
    "Business Intelligence Analyst": "15-2051",
    "Financial Analyst": "13-2051",
    "Financial Manager": "11-3031",
    "Software Developer": "15-1252",
    "Management Consultant": "13-1111",
    "Sales Manager": "11-2022",
    "Accountant & Auditor": "13-2011",
    "Operations Research Analyst": "15-2031",
    "Logistics Analyst": "13-1081",
    "Securities & Sales Agent": "41-3031",
    "Supply Chain Manager": "11-3071",
};
