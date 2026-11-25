import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const frontendRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve(frontendRoot, 'node_modules/react'),
      'react-dom': resolve(frontendRoot, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(frontendRoot, 'component-tests/setup.ts')],
    include: ['component-tests/tests/**/*.test.tsx'],
    restoreMocks: true,
  },
})
