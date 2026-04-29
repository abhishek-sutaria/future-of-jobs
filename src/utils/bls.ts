import { BLS_API } from '../config/constants';


import { z } from 'zod';

export const BLSDataPointSchema = z.object({
    year: z.string(),
    period: z.string().regex(/^M\d{2}$/, "Period must match Mxx format"),
    periodName: z.string().optional(),
    value: z.string().refine((val) => !isNaN(parseFloat(val)), "Value must be numeric")
});

export const BLSSeriesSchema = z.object({
    seriesID: z.string(),
    data: z.array(BLSDataPointSchema).nonempty("Data array cannot be empty")
});

export const BLSResponseSchema = z.object({
    status: z.string(),
    responseTime: z.number().optional(),
    message: z.array(z.string()).optional(),
    Results: z.object({
        series: z.array(BLSSeriesSchema)
    })
}).passthrough();

export type BLSResponse = z.infer<typeof BLSResponseSchema>;

export async function fetchLaborStats(seriesIds: string[]): Promise<Map<string, number>> {
    const apiKey = import.meta.env.VITE_BLS_API_KEY;

    if (!apiKey) {
        console.warn('BLS API Key missing. Request may reach rate limits.');
    }

    try {
        const response = await fetch(BLS_API.PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                seriesid: seriesIds,
                startyear: BLS_API.START_YEAR,
                endyear: BLS_API.END_YEAR,
                registrationkey: apiKey,
            }),
        });

        if (!response.ok) {
            throw new Error(`BLS API Error: ${response.statusText}`);
        }

        const rawJson = await response.json();
        const json: BLSResponse = BLSResponseSchema.parse(rawJson);

        if (json.status !== 'REQUEST_SUCCEEDED') {
            console.error('BLS API Messages:', json.message);
            throw new Error('BLS API Request Failed');
        }

        const results = new Map<string, number>();
        json.Results.series.forEach(series => {
            if (series.data.length > 0) {
                results.set(series.seriesID, parseFloat(series.data[0].value));
            }
        });

        return results;
    } catch (error) {
        console.error('Failed to fetch BLS data:', error);
        throw error;
    }
}

// Map of Job Titles to BLS CPS Series IDs
// These are broad occupation-category series from CPS (Current Population Survey).
// For exact per-occupation data, OES series IDs vary by SOC code and area.
const MAP_TITLE_TO_SERIES: Record<string, string> = {
    // Management Occupations (LNU02032202)
    "Marketing Manager": "LNU02032202",
    "Financial Manager": "LNU02032202",
    "Sales Manager": "LNU02032202",
    "Supply Chain Manager": "LNU02032202",

    // Business & Financial Ops (LNU02032203)
    "Market Research Analyst": "LNU02032203",
    "Financial Analyst": "LNU02032203",
    "Management Consultant": "LNU02032203",
    "Logistics Analyst": "LNU02032203",
    "Accountant & Auditor": "LNU02032203",

    // Computer & Mathematical (LNU02032209)
    "Software Developer": "LNU02032209",
    "Business Intelligence Analyst": "LNU02032209",
    "Operations Research Analyst": "LNU02032209",

    // Sales & Office (LNU02032212)
    "Securities & Sales Agent": "LNU02032212"
};

export function getSeriesIdForJob(title: string, _datatype: '01' | '03' = '01'): string | null {
    return MAP_TITLE_TO_SERIES[title] || null;
}

export function getSeriesLabel(seriesId: string | null): string | null {
    if (!seriesId) return null;
    const base = seriesId.substring(0, 11);
    switch (base) {
        case 'LNU02032202': return 'Management occupations — broad category trend (CPS)';
        case 'LNU02032203': return 'Business & Financial Ops — broad category trend (CPS)';
        case 'LNU02032209': return 'Computer & Mathematical — broad category trend (CPS)';
        case 'LNU02032212': return 'Sales & Office — broad category trend (CPS)';
        default: return null;
    }
}
