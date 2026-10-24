/**
 * Short display labels for the 22 "continents" (BLS SOC major groups).
 *
 * These are UI labels, not data. The official name of each group is the BLS
 * title stored in src/data/occupations/index.json (continents[].title, read
 * from the OEWS May 2025 workbook); use that wherever the source is cited.
 *
 * Keyed by the two-digit SOC major code (continents[].code).
 */
export const CONTINENT_DISPLAY_NAMES: Record<string, string> = {
    '11': 'Management',
    '13': 'Business & Finance',
    '15': 'Computer & Math',
    '17': 'Architecture & Engineering',
    '19': 'Science',
    '21': 'Community & Social Service',
    '23': 'Legal',
    '25': 'Education',
    '27': 'Arts & Media',
    '29': 'Healthcare Practitioners',
    '31': 'Healthcare Support',
    '33': 'Protective Service',
    '35': 'Food Service',
    '37': 'Cleaning & Grounds',
    '39': 'Personal Care',
    '41': 'Sales',
    '43': 'Office & Admin',
    '45': 'Farming, Fishing & Forestry',
    '47': 'Construction & Extraction',
    '49': 'Installation & Repair',
    '51': 'Production',
    '53': 'Transportation & Moving',
};
