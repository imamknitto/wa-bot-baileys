import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig(({ mode }) => {
  // Read the monorepo-root .env so the dev proxy follows the same PORT as the api.
  const env = loadEnv(mode, repoRoot, '')
  const apiOrigin = `http://127.0.0.1:${env.API_PORT || env.PORT || '8365'}`

  return {
    base: '/app/',
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // Same-origin paths the dashboard calls; `^/$` is the exact root only
        // (service info), so vite's own assets at `/app/...` are untouched.
        '^/$': apiOrigin,
        '/sessions': apiOrigin,
        '/stats': apiOrigin,
        '/messages': apiOrigin,
      },
    },
  }
})