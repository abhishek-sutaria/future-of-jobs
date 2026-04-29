
import fetch from 'node-fetch';

// Series ID format for OEWS is complex.
// Attempting to fetch National Employment for Marketing Managers (11-2021)
// OEWS Series ID structure is generally NOT fully supported in Public API v2 for all data slices.
// Common format: OE + U (National) + [search type]
// Checking if we can get data for a specific SOC.

async function testBlsApi() {
    const url = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
    const payload = {
        "seriesid": ["OEUN000000011202100000000000001"], // OE series for Marketing Manager
        "startyear": "2023",
        "endyear": "2024",
        "catalog": true,
        "calculations": true,
        "annualaverage": true
        // "registrationkey": "..." // Removed invalid key
    };

    console.log("Testing BLS API for Marketing Manager (11-2021)...");

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("Response Status:", data.status);
        console.log("Response Message:", data.message);

        if (data.Results && data.Results.series) {
            data.Results.series.forEach(s => {
                console.log(`\nSeries: ${s.seriesID}`);
                if (s.data && s.data.length > 0) {
                    console.log("Values:", s.data);
                } else {
                    console.log("No data found for this series.");
                }
            });
        }
    } catch (e) {
        console.error("API Error:", e);
    }
}

testBlsApi();
