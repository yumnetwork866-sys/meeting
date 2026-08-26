import { createLogger, defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const apiPort = env.VITE_API_PORT || env.PORT || '3001'
  const apiOrigin = env.VITE_API_ORIGIN || `http://localhost:${apiPort}`
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || 'meeting.n8nfmc.io.vn,meeting.yumnetwork.vn')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  const logger = createLogger()
  const originalLoggerError = logger.error

  logger.error = (message, options) => {
    if (typeof message === 'string' && message.includes('http proxy error: /api/')) {
      return
    }

    originalLoggerError(message, options)
  }

  return {
    customLogger: logger,
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('error', (_err, _req, res) => {
              if (!res || !('writeHead' in res) || res.headersSent) {
                return
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                ok: false,
                error: `API server unavailable at ${apiOrigin}. Start the backend with npm start or npm run start:prod.`,
              }))
            })
          },
        },
        '/ws': {
          target: apiOrigin.replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
      allowedHosts,
    },
  }
})
