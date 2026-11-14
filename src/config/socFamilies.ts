/**
 * The five BLS job families the 22 fields are grouped into on the map.
 *
 * Source: BLS, 2018 Standard Occupational Classification User Guide
 * (November 2017, update April 15, 2020), "Higher levels of aggregation",
 * Table 6 "High-level aggregation to 6 groups, 2018 SOC", page 17:
 *   1  11–29  Management, Business, Science, and Arts Occupations
 *   2  31–39  Service Occupations
 *   3  41–43  Sales and Office Occupations
 *   4  45–49  Natural Resources, Construction, and Maintenance Occupations
 *   5  51–53  Production, Transportation, and Material Moving Occupations
 *   6  55     Military Specific Occupations (not one of the 22 fields: OEWS and EP publish no 55 group)
 * https://www.bls.gov/soc/2018/soc_2018_user_guide.pdf, committed as
 * data/bls_soc_2018_user_guide.pdf (Wayback capture 20250101093349,
 * SHA-256 53729e652bd04f16a0d27648fed3d1f3008a4dfc3d6bae353804f50de577dc83).
 * socFamilies.test.ts reads Table 6 from that PDF and checks these ranges.
 *
 * `title` is the official BLS name; `shortName` is the UI label.
 */
export interface SocFamily {
    id: number;
    title: string;
    shortName: string;
    /** First and last two-digit SOC major code in the family, inclusive. */
    majors: readonly [string, string];
}

export const SOC_FAMILIES: readonly SocFamily[] = [
    { id: 1, title: 'Management, Business, Science, and Arts Occupations', shortName: 'Management, Business, Science & Arts', majors: ['11', '29'] },
    { id: 2, title: 'Service Occupations', shortName: 'Service', majors: ['31', '39'] },
    { id: 3, title: 'Sales and Office Occupations', shortName: 'Sales & Office', majors: ['41', '43'] },
    { id: 4, title: 'Natural Resources, Construction, and Maintenance Occupations', shortName: 'Natural Resources, Construction & Maintenance', majors: ['45', '49'] },
    { id: 5, title: 'Production, Transportation, and Material Moving Occupations', shortName: 'Production, Transportation & Moving', majors: ['51', '53'] },
];

/** The family a two-digit SOC major code belongs to. Throws for a code outside the five. */
export function familyOf(major: string): SocFamily {
    const n = Number(major);
    const f = SOC_FAMILIES.find((x) => n >= Number(x.majors[0]) && n <= Number(x.majors[1]));
    if (!f) throw new Error(`SOC major ${major} is in none of the five BLS families`);
    return f;
}
