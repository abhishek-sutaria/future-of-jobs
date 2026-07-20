/**
 * Functional career clusters for the 3D terrain layout.
 *
 * The Job.cluster field in data.ts is uniformly "Business", so territory
 * grouping uses this explicit title → cluster map instead (derived from the
 * SOC groups in utils/onet.ts, with manual overrides such as Actuary → Finance
 * despite its 15-2011 SOC code).
 *
 * Leaf module: must not import from utils/terrainMath (it imports from here).
 */

/** Territory order around the disc — adjacent entries are related fields, and the list wraps. */
export const CLUSTER_ORDER = [
    'Finance',
    'Business Ops',
    'Management & HR',
    'Operations & Logistics',
    'Sales',
    'Marketing',
    'Data Science',
    'Information Technology',
] as const;

export type FunctionalCluster = (typeof CLUSTER_ORDER)[number];

export const TITLE_TO_FUNCTIONAL_CLUSTER: Record<string, FunctionalCluster> = {
    // Finance (13-2*, 11-3031; Actuary 15-2011 override)
    'Financial Analyst': 'Finance',
    'Financial Manager': 'Finance',
    'Accountant & Auditor': 'Finance',
    'Personal Financial Advisor': 'Finance',
    'Credit Analyst': 'Finance',
    'Budget Analyst': 'Finance',
    'Risk Specialist': 'Finance',
    'Insurance Underwriter': 'Finance',
    'Actuary': 'Finance',
    'Loan Officer': 'Finance',
    'Financial Risk Analyst': 'Finance',

    // Business Ops (13-1111, 13-1082, 13-1051)
    'Management Consultant': 'Business Ops',
    'Project Management Specialist': 'Business Ops',
    'Cost Estimator': 'Business Ops',

    // Management & HR (11-1021, 11-31**, 13-107*/114*/115*)
    'General Manager': 'Management & HR',
    'HR Manager': 'Management & HR',
    'HR Specialist': 'Management & HR',
    'Training & Development Specialist': 'Management & HR',
    'Training & Development Manager': 'Management & HR',
    'Compensation Analyst': 'Management & HR',
    'Compensation & Benefits Manager': 'Management & HR',

    // Operations & Logistics (11-305*/306*/307*, 13-108*/102*)
    'Supply Chain Manager': 'Operations & Logistics',
    'Logistics Analyst': 'Operations & Logistics',
    'Purchasing Manager': 'Operations & Logistics',
    'Purchasing Agent': 'Operations & Logistics',
    'Wholesale & Retail Buyer': 'Operations & Logistics',
    'Industrial Production Manager': 'Operations & Logistics',

    // Sales (41-*, 11-2022)
    'Sales Manager': 'Sales',
    'Securities & Sales Agent': 'Sales',
    'Advertising Sales Agent': 'Sales',
    'Account Executive': 'Sales',
    'Sales Representative': 'Sales',
    'Insurance Sales Agent': 'Sales',

    // Marketing (11-2021/2032, 13-1161/1121)
    'Marketing Manager': 'Marketing',
    'Brand Manager': 'Marketing',
    'Public Relations Manager': 'Marketing',
    'Market Research Analyst': 'Marketing',
    'Event Coordinator': 'Marketing',

    // Data Science (15-2*, 15-2051)
    'Data Scientist': 'Data Science',
    'Statistician': 'Data Science',
    'Operations Research Analyst': 'Data Science',
    'Business Intelligence Analyst': 'Data Science',

    // Information Technology (15-1*, 11-3021)
    'Software Developer': 'Information Technology',
    'UX Designer': 'Information Technology',
    'IT Manager': 'Information Technology',
    'Cybersecurity Analyst': 'Information Technology',
    'Web Developer': 'Information Technology',
    'Database Administrator': 'Information Technology',
    'IT Project Manager': 'Information Technology',
    'Computer Systems Analyst': 'Information Technology',
};

export function getFunctionalCluster(title: string): FunctionalCluster {
    return TITLE_TO_FUNCTIONAL_CLUSTER[title] ?? 'Business Ops';
}
