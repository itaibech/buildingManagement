import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { cspPlugin, notFoundPagePlugin } from './vite.plugins.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  return {
    base: '/buildingManagement/',
    plugins: [react(), cspPlugin(env.VITE_SUPABASE_URL ?? ''), notFoundPagePlugin()],
    // Agent worktrees live under .claude/; their copies of the tests are not this checkout's.
    test: { environment: 'node', setupFiles: ['./src/test/setup.ts'], exclude: [...configDefaults.exclude, '.claude/**', 'node_modules/**'] },
  }
})
