import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { cspPlugin, notFoundPagePlugin } from './vite.plugins.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  return {
    base: '/buildingManagement/',
    plugins: [react(), cspPlugin(env.VITE_SUPABASE_URL ?? ''), notFoundPagePlugin()],
    test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] },
  }
})
