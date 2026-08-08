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

    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status);
    res.setHeader('content-type', contentType);
    // Long generations (e.g. Startup Ideas, ~55s) stream over SSE. Buffering the
    // whole body used to hold the request until finished with no bytes flowing,
    // which trips idle/proxy timeouts. Pipe chunks straight through instead so
    // the connection stays alive and the browser receives tokens as they arrive.
    res.setHeader('cache-control', 'no-cache, no-transform');

    if (!upstream.body) {
      const text = await upstream.text();
      return res.send(text);
    }

    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    return res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    return res.status(502).json({ error: { message } });
  }
}
