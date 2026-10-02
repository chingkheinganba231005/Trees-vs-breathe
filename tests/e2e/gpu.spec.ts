import { expect, test } from '@playwright/test';
import { writeResult } from './provenance';

declare global {
  interface Window {
    __selftest?: unknown;
  }
}

interface Row {
  name: string;
  cells: number;
  steps: number;
  cpuError: number;
  gpuError: number | null;
}

test('WGSL and CPU solvers reproduce the Python reference', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./selftest.html');
  await page.waitForFunction(() => window.__selftest !== undefined, null, { timeout: 200_000 });
  const result = (await page.evaluate(() => window.__selftest)) as {
    error?: string;
    adapter: string;
    rows: Row[];
    worst: number;
    threshold: number;
    passed: boolean;
  };
  expect(result.error).toBeUndefined();
  expect(result.adapter).not.toMatch(/^no WebGPU/);
  for (const r of result.rows) {
    expect(r.gpuError, r.name).not.toBeNull();
    expect(r.gpuError!, r.name).toBeLessThan(result.threshold);
    expect(r.cpuError, r.name).toBeLessThan(result.threshold);
  }
  expect(result.passed).toBe(true);
  await page.screenshot({ path: 'test-results/screens/selftest.png', fullPage: true });

  // Recorded on demand so routine runs do not rewrite the committed file.
  if (process.env.RECORD_RESULTS === '1') {
    writeResult(
      'benchmarks/browser_agreement.json',
      {
        name: 'Browser solvers (CPU worker and WGSL) against the Python reference',
        method:
          'Golden cases from python -m treesvb.golden run in headless Chromium; the GPU kernel runs on a SwiftShader WebGPU adapter. Fields compared after the stated number of steps.',
        metric: 'largest velocity difference as a fraction of the reference speed',
        threshold: { max_abs_diff_over_uref_below: result.threshold },
        adapter: result.adapter,
        rows: result.rows,
        worst: result.worst,
        passed: result.passed,
      },
      'npx playwright test --project=webgpu (RECORD_RESULTS=1)',
    );
  }
});

test('the Design screen runs the street on WebGPU without losing the device', async ({ page }) => {
  test.setTimeout(90_000);
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
  });
  await page.addInitScript(() => localStorage.setItem('tvb-lang', 'en'));
  await page.goto('./?engine=gpu#/design');
  await expect(page.getByText('Running on')).toBeVisible();
  await expect(page.locator('dl')).toContainText('WebGPU', { timeout: 30_000 });
  await page.waitForTimeout(8000);
  await expect(page.locator('dl')).toContainText('WebGPU');
  await expect(page.getByText('running on the CPU')).toHaveCount(0);
  expect(warnings.filter((w) => /device lost/i.test(w))).toEqual([]);
  await page.locator('canvas').screenshot({ path: 'test-results/screens/design-gpu-canvas.png' });
});
