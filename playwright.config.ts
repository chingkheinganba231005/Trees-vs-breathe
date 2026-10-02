import { defineConfig, devices } from '@playwright/test';

const port = 4173;
// GitHub Pages serves the app from /<repo>/, so the smoke test serves it from the same subpath.
const base = '/Trees-vs-breathe/';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}${base}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  // Serves the production build, so the smoke test checks what GitHub Pages will serve.
  webServer: {
    command: `npm run preview -w apps/web -- --host 127.0.0.1 --port ${port} --base ${base}`,
    url: `http://127.0.0.1:${port}${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
