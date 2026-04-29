import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// ⚠️  PRODUCTION DEPLOYMENT NOTE:
// The dev-server proxy below only works during local development (`npm run dev`).
// For production, you MUST set up a proper server-side proxy (e.g. Cloudflare Worker,
// Vercel serverless function, or an Express backend) to forward BLS/Claude requests.
// The built static files will NOT have any proxy available.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const hasDefaultClaudeKey = Boolean(env.ANTHROPIC_API_KEY)
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_HAS_DEFAULT_CLAUDE_KEY': JSON.stringify(hasDefaultClaudeKey),
    },
    optimizeDeps: {
      include: ['react-simple-maps', 'd3-scale'],
    },
    server: {
      proxy: {
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/claude/, '/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const userProvidedKey = req.headers['x-user-api-key'];
              const keyFromHeader = Array.isArray(userProvidedKey) ? userProvidedKey[0] : userProvidedKey;
              const keySource = req.headers['x-foj-key-source'];
              const keySourceStr = Array.isArray(keySource) ? keySource[0] : keySource;
              // Explicit "Use my key" uses browser key first; otherwise prefer .env so stale keys in
              // localStorage cannot override a valid ANTHROPIC_API_KEY.
              const apiKey =
                keySourceStr === 'user' && keyFromHeader
                  ? keyFromHeader || env.ANTHROPIC_API_KEY
                  : env.ANTHROPIC_API_KEY || keyFromHeader;

              if (apiKey) {
                proxyReq.setHeader('x-api-key', apiKey);
              }
              proxyReq.setHeader('anthropic-version', '2023-06-01');
              proxyReq.setHeader('content-type', 'application/json');
              // Ensure upstream sees a server-to-server request, not browser CORS headers.
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');

              // Prevent accidentally forwarding the raw user key header upstream.
              proxyReq.removeHeader('x-user-api-key');
              proxyReq.removeHeader('x-foj-key-source');
            });
          }
        },
        '/api/bls': {
          target: 'https://api.bls.gov/publicAPI/v2/timeseries/data',
          changeOrigin: true,
          rewrite: (path) => {
            const cleanPath = path.replace(/^\/api\/bls/, '');
            const apiKey = env.VITE_BLS_API_KEY;
            return apiKey ? `${cleanPath}?registrationkey=${apiKey}` : cleanPath;
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
              proxyReq.setHeader('Origin', 'https://api.bls.gov');
              proxyReq.setHeader('Referer', 'https://api.bls.gov/');
            });
          }
        }
      }
    }
  }
})
