/**
 * The combine rule's table, shared by the scoring plan (scripts/lib/blsTasks.ts)
 * and the app (the role panel names where a job's scored tasks come from).
 * Pure data, no imports, so both Node and the browser load it.
 *
 * A BLS occupation with no O*NET code of its own, which O*NET splits into
 * smaller codes, is scored on those codes' real task rows, one from each code
 * in turn (rule round-robin-onet-codes, "combined"). 13-2020 was the first;
 * the rest were found by listing every O*NET 30.1 code whose six-digit SOC is
 * not one of the 830 BLS occupations (docs/scoring-decisions.md and
 * scorePlanAll.test.ts). 13-1020 (the two Kelley buyer titles) joined on
 * 2026-11-08, when the Kelley SOCs were planned by the same rules as every
 * other job.
 *
 * Each list holds only codes with task rows. A split code with a .00 task list
 * is used as .00 (its sub-codes are left out, as the .00-first rule does
 * everywhere); 47-4099 has no .00 tasks, so its one sub-code with tasks stands
 * in for it, as the sub-code rule does everywhere.
 */
export const ONET_CODES_FOR_SOC: Readonly<Record<string, readonly string[]>> = {
    '13-1020': ['13-1021.00', '13-1022.00', '13-1023.00'],
    '13-2020': ['13-2022.00', '13-2023.00'],
    '21-1018': ['21-1011.00', '21-1014.00'],
    '25-2052': ['25-2055.00', '25-2056.00'],
    '25-9045': ['25-9042.00', '25-9043.00'],
    '29-2010': ['29-2011.00', '29-2012.00'],
    '31-1120': ['31-1121.00', '31-1122.00'],
    '39-7010': ['39-7011.00', '39-7012.00'],
    '47-4090': ['47-4091.00', '47-4099.03'],
    '51-2028': ['51-2022.00', '51-2023.00'],
    '51-2090': ['51-2092.00'],
    '53-1047': ['53-1042.00', '53-1043.00', '53-1044.00'],
};

/** Split O*NET codes of a combined occupation that have no task rows, so add nothing. */
export const ONET_SPLIT_CODES_WITHOUT_TASKS: Readonly<Record<string, readonly string[]>> = {
    '25-9045': ['25-9049.00'],
    '47-4090': ['47-4099.00'],
    '51-2090': ['51-2099.00'],
    '53-1047': ['53-1049.00'],
};

/**
 * O*NET 30.1 titles of the split codes, copied from data/db_30_1_text/
 * Occupation Data.txt (scorePlanAll.test.ts checks each against the file), so
 * the role panel can name where a combined job's tasks come from.
 */
export const ONET_SPLIT_CODE_TITLES: Readonly<Record<string, string>> = {
    '13-1021.00': 'Buyers and Purchasing Agents, Farm Products',
    '13-1022.00': 'Wholesale and Retail Buyers, Except Farm Products',
    '13-1023.00': 'Purchasing Agents, Except Wholesale, Retail, and Farm Products',
    '13-2022.00': 'Appraisers of Personal and Business Property',
    '13-2023.00': 'Appraisers and Assessors of Real Estate',
    '21-1011.00': 'Substance Abuse and Behavioral Disorder Counselors',
    '21-1014.00': 'Mental Health Counselors',
    '25-2055.00': 'Special Education Teachers, Kindergarten',
    '25-2056.00': 'Special Education Teachers, Elementary School',
    '25-9042.00': 'Teaching Assistants, Preschool, Elementary, Middle, and Secondary School, Except Special Education',
    '25-9043.00': 'Teaching Assistants, Special Education',
    '29-2011.00': 'Medical and Clinical Laboratory Technologists',
    '29-2012.00': 'Medical and Clinical Laboratory Technicians',
    '31-1121.00': 'Home Health Aides',
    '31-1122.00': 'Personal Care Aides',
    '39-7011.00': 'Tour Guides and Escorts',
    '39-7012.00': 'Travel Guides',
    '47-4091.00': 'Segmental Pavers',
    '47-4099.03': 'Weatherization Installers and Technicians',
    '51-2022.00': 'Electrical and Electronic Equipment Assemblers',
    '51-2023.00': 'Electromechanical Equipment Assemblers',
    '51-2092.00': 'Team Assemblers',
    '53-1042.00': 'First-Line Supervisors of Helpers, Laborers, and Material Movers, Hand',
    '53-1043.00': 'First-Line Supervisors of Material-Moving Machine and Vehicle Operators',
    '53-1044.00': 'First-Line Supervisors of Passenger Attendants',
};

/** True when the BLS occupation takes its tasks from O*NET's split codes (the combine rule). */
export const isCombinedSoc = (soc: string): boolean => soc in ONET_CODES_FOR_SOC;

/** "25-9042.00 (Teaching Assistants, …) and 25-9043.00 (…)": codes with their O*NET titles, in a list. */
export function describeOnetCodes(codes: readonly string[]): string {
    const parts = codes.map((c) => (ONET_SPLIT_CODE_TITLES[c] ? `${c} (${ONET_SPLIT_CODE_TITLES[c]})` : c));
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
