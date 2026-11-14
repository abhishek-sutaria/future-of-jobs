import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { blsScoresPlugin } from './scripts/lib/blsScoresPlugin'
import { devApiPlugin } from './scripts/lib/devApiPlugin'

// https://vite.dev/config/
//
// Claude: under `npm run dev`, devApiPlugin serves /api/claude/messages with the
// same gateway the Vercel function runs (api/_lib/gateway.ts → api.anthropic.com),
// so dev follows production's rules. FOJ_MOCK_CLAUDE=1 runs it against an
// in-memory mock of Claude and Supabase instead (no key, no real call).
// BLS: the dev proxy below only works during local development; production
// uses api/bls.ts.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const hasDefaultClaudeKey = Boolean(env.ANTHROPIC_API_KEY) || env.FOJ_MOCK_CLAUDE === '1'
  return {
    plugins: [react(), blsScoresPlugin(), devApiPlugin(env)],
    define: {
      'import.meta.env.VITE_HAS_DEFAULT_CLAUDE_KEY': JSON.stringify(hasDefaultClaudeKey),
    },
    optimizeDeps: {
      include: ['react-simple-maps', 'd3-scale'],
    },
    server: {
      proxy: {
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
