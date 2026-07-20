const BLS_BASE_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data';

export default async function handler(req: any, res: any) {
  try {
    const apiKey = (process.env.VITE_BLS_API_KEY || '').trim();
    let upstream: Response;

    if (req.method === 'GET') {
      const rawSeriesId = req.query?.seriesId;
      const seriesId = Array.isArray(rawSeriesId) ? rawSeriesId[0] : rawSeriesId;
      if (!seriesId || typeof seriesId !== 'string') {
        return res.status(400).json({ message: 'Missing series id' });
      }
      const url = new URL(`${BLS_BASE_URL}/${encodeURIComponent(seriesId)}`);
      if (apiKey) {
        url.searchParams.set('registrationkey', apiKey);
      }
      upstream = await fetch(url.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Origin: 'https://api.bls.gov',
          Referer: 'https://api.bls.gov/',
        },
      });
    } else if (req.method === 'POST') {
      const upstreamBody = { ...(req.body || {}) };
      if (apiKey && !upstreamBody.registrationkey) {
        upstreamBody.registrationkey = apiKey;
      }
      upstream = await fetch(BLS_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Origin: 'https://api.bls.gov',
          Referer: 'https://api.bls.gov/',
        },
        body: JSON.stringify(upstreamBody),
      });
    } else {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    } else {
      res.setHeader('content-type', 'application/json');
    }

    // CDN-cache successful GETs for 24h (POST is never CDN-cached by Vercel).
    // BLS returns HTTP 200 with an error status when rate-limited, so gate on the body.
    if (req.method === 'GET' && upstream.ok && text.includes('"REQUEST_SUCCEEDED"')) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    }

    return res.status(upstream.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    return res.status(502).json({ message });
  }
}
