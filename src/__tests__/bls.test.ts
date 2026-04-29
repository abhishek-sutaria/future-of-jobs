import { test, expect } from 'vitest';
import { BLSResponseSchema } from '../utils/bls';

test('BLS response validation', () => {
    // 1. Valid response
    const validResponse = {
        status: "REQUEST_SUCCEEDED",
        Results: {
            series: [
                {
                    seriesID: "LNU02032202",
                    data: [{ year: "2023", period: "M05", value: "100" }]
                }
            ]
        }
    };
    expect(() => BLSResponseSchema.parse(validResponse)).not.toThrow();

    // 2. Missing Results.series
    const missingSeries = {
        status: "REQUEST_SUCCEEDED",
        Results: {}
    };
    expect(() => BLSResponseSchema.parse(missingSeries)).toThrow();

    // 3. Empty data array
    const emptyData = {
        status: "REQUEST_SUCCEEDED",
        Results: {
            series: [
                {
                    seriesID: "LNU02032202",
                    data: []
                }
            ]
        }
    };
    expect(() => BLSResponseSchema.parse(emptyData)).toThrowError(/Data array cannot be empty/);

    // 4. Non-numeric value fields
    const nonNumericValue = {
        status: "REQUEST_SUCCEEDED",
        Results: {
            series: [
                {
                    seriesID: "LNU02032202",
                    data: [{ year: "2023", period: "M05", value: "abc" }]
                }
            ]
        }
    };
    expect(() => BLSResponseSchema.parse(nonNumericValue)).toThrowError(/Value must be numeric/);

    // 5. Malformed period strings (not matching Mxx)
    const malformedPeriod1 = {
        status: "REQUEST_SUCCEEDED",
        Results: {
            series: [
                {
                    seriesID: "LNU02032202",
                    data: [{ year: "2023", period: "Q01", value: "100" }]
                }
            ]
        }
    };
    expect(() => BLSResponseSchema.parse(malformedPeriod1)).toThrowError(/Period must match Mxx format/);

    const malformedPeriod2 = {
        status: "REQUEST_SUCCEEDED",
        Results: {
            series: [
                {
                    seriesID: "LNU02032202",
                    data: [{ year: "2023", period: "M5", value: "100" }]
                }
            ]
        }
    };
    expect(() => BLSResponseSchema.parse(malformedPeriod2)).toThrowError(/Period must match Mxx format/);
});
