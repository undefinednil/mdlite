import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = Number(process.env.PORT ?? 4747)

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
