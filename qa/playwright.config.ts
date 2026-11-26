import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const qaRunId = `${process.pid}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/role-workflows.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python run.py --no-browser',
    cwd: '..',
    url: 'http://127.0.0.1:8000/health',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: `sqlite:///./qa_e2e_${qaRunId}.db`,
      LANGGRAPH_CHECKPOINT_DB: resolve(process.cwd(), '..', 'backend', `qa_e2e_${qaRunId}.checkpoints.sqlite`),
      ONBOARDIQ_MCP_DB_DIR: resolve(process.cwd(), '..', 'backend', `qa_e2e_mcp_${qaRunId}`),
      GEMINI_API_KEY: '',
      DEMO_MODE: 'true',
    },
  },
})
