const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function getHeader(req: any, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const userProvidedKey = getHeader(req, 'x-user-api-key').trim();
  const keySource = getHeader(req, 'x-foj-key-source').trim();
  const defaultServerKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  const apiKey =
    keySource === 'user' && userProvidedKey
      ? userProvidedKey || defaultServerKey
      : defaultServerKey || userProvidedKey;

  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'x-api-key header is required (no user key and no ANTHROPIC_API_KEY configured)',
      },
    });
  }

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    } else {
      res.setHeader('content-type', 'application/json');
    }

    return res.status(upstream.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    return res.status(502).json({ error: { message } });
  }
}
