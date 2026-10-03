import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Every screen, in both languages for the start screen, with a screenshot to look at.
const screens = [
  { path: '/', name: 'start', heading: 'Plant a tree — cooler street or dirtier air?' },
  { path: '/street', name: 'street', heading: 'Street' },
  { path: '/design', name: 'design', heading: 'Design' },
  { path: '/trade-off', name: 'trade-off', heading: 'Trade-off' },
  { path: '/compare', name: 'compare', heading: 'Compare' },
  { path: '/how-we-know', name: 'how-we-know', heading: 'How we know' },
  { path: '/hong-kong', name: 'hong-kong', heading: 'Hong Kong' },
  { path: '/report', name: 'report', heading: 'Report' },
  { path: '/present', name: 'present', heading: 'Presentation mode' },
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tvb-lang', 'en'));
});

for (const screen of screens) {
  test(`${screen.name} renders without errors`, async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.goto(`./?engine=cpu#${screen.path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(screen.heading);
    await page.screenshot({
      path: `test-results/screens/${testInfo.project.name}-${screen.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('the Design screen runs the live street on the CPU worker', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('./?engine=cpu#/design');
  const readouts = page.getByRole('region', { name: 'Model settings' });
  await expect(readouts).toContainText('CPU worker', { timeout: 20_000 });
  await expect(readouts).toContainText('20,000');
  await expect(readouts).toContainText('of normal');
  await expect(readouts).toContainText('Lattice steps per second');
  // The H/W slider rebuilds the street.
  const slider = page.getByLabel('Street shape: building height ÷ street width (H/W)');
  await slider.fill('2');
  await slider.dispatchEvent('pointerup');
  await expect(page.getByText('Deep street')).toBeVisible();
  await page.waitForTimeout(4000);
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}-design-live.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('trees change the fumes on the pavements against the bare street', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  // A short averaging window (a quarter of a vortex turnover) so the test finishes in time.
  await page.goto('./?engine=cpu&averaging=0.25#/design');
  // The bare street settles first and becomes the baseline.
  await expect(page.getByText('This is the street without greenery')).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('radio', { name: 'Avenue of trees' }).check();
  await expect(page.getByText('Crown density')).toBeVisible();
  await expect(page.getByText('against the same street without greenery').first()).toBeVisible({
    timeout: 90_000,
  });
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}-design-trees.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('Design shows heat on the pavements and the sun moves with the hour', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto('./?engine=cpu&averaging=0.25&speed=4#/design');
  const heat = page.locator('section[aria-labelledby="heat"]');
  await expect(heat).toBeVisible();
  // UTCI needs the pavement wind, which appears once its running mean has settled.
  await expect(heat.getByText(/heat stress|thermal stress|cold stress/).first()).toBeVisible({
    timeout: 120_000,
  });
  await expect(heat.getByText(/°C/).first()).toBeVisible();
  // At 19:00 the sun has set on the very hot day (22 August).
  await page.locator('#hour').fill('19');
  await expect(heat.getByText('The sun is down.')).toBeVisible();
  await heat.scrollIntoViewIfNeeded();
  await heat.screenshot({ path: `test-results/screens/${testInfo.project.name}-design-heat.png` });
  expect(errors).toEqual([]);
});

test('the fumes picture does not blank while a tree is dragged', async ({ page }) => {
  test.setTimeout(60_000);
  // The CPU engine draws to a 2D canvas, so its pixels can be counted.
  await page.goto('./?engine=cpu&speed=4#/design');
  await page.getByRole('radio', { name: 'Avenue of trees' }).check();
  await page.waitForTimeout(8000);
  const counts = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const canvas = document.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;
        const slider = document.getElementById('green-shift') as HTMLInputElement;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        const lo = Number(slider.min);
        const hi = Number(slider.max);
        const out: number[] = [];
        const frame = () => {
          // Move the tree a little on every frame, as a drag does, then count violet pixels.
          setValue.call(slider, String(lo + (hi - lo) * (0.5 + 0.3 * Math.sin(out.length / 10))));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => {
            const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let n = 0;
            for (let j = 0; j < d.length; j += 4)
              if (d[j + 2]! - d[j + 1]! > 12 && d[j]! > d[j + 1]!) n++;
            out.push(n);
            if (out.length < 60) requestAnimationFrame(frame);
            else resolve(out);
          }, 30);
        };
        requestAnimationFrame(frame);
      }),
  );
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  expect(median).toBeGreaterThan(0);
  // Before the display mean was split from the exposure mean, every change blanked a frame.
  expect(sorted[0]).toBeGreaterThan(0.5 * median);
});

test('a measured street opens in Design with its shape', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?engine=cpu#/street');
  await expect(page.getByRole('heading', { name: 'Nathan Road, Mong Kok' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wing Lok Street, Sheung Wan' })).toBeVisible();
  await expect(page.getByText('Deeper than the live model has been checked for')).toBeVisible();
  await page
    .getByRole('article', { name: 'Nathan Road, Mong Kok' })
    .getByRole('link', { name: 'Open in Design' })
    .click();
  await expect(page.getByText('Street shape from Nathan Road, Mong Kok')).toBeVisible();
  await expect(page.locator('output[for="aspect"]')).toHaveText(/^1\.\d$/);
  expect(errors).toEqual([]);
});

test('the solver engine follows ?engine=cpu', async ({ page }) => {
  await page.goto('./?engine=cpu#/');
  await expect(page.getByText('Solver engine: CPU worker')).toBeVisible();
});

test('language switch shows Traditional Chinese', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('./?engine=cpu#/');
  await page.getByRole('button', { name: 'Switch language to Traditional Chinese' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    '種一棵樹：街道更涼，還是空氣更髒？',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant-HK');
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}-start-zh-Hant.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('dark theme applies before first paint', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?engine=cpu#/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe('rgb(14, 14, 14)');
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}-start-dark.png`,
    fullPage: true,
  });
});

test('unknown routes show a way back', async ({ page }) => {
  await page.goto('./?engine=cpu#/no-such-screen');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await page.getByRole('link', { name: 'Back to start' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('every screen is reachable from the navigation', async ({ page, isMobile }) => {
  await page.goto('./?engine=cpu#/');
  for (const screen of screens.filter((s) => s.path !== '/' && s.path !== '/present')) {
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('link', { name: screen.heading, exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(screen.heading);
  }
});

test('Trade-off sweeps designs and checks one with physics, or says the models are missing', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('./?engine=cpu&ai=wasm&checkSteps=800#/trade-off');
  const missing = page.getByText(/AI models are not trained yet/);
  const scored = page.getByText(/designs scored/);
  await expect(missing.or(scored)).toBeVisible({ timeout: 120_000 });
  if (await scored.isVisible()) {
    await page.getByRole('button', { name: 'Balanced', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Selected design/ })).toBeVisible();
    await page.getByRole('button', { name: 'Check with physics' }).click();
    await expect(page.getByText('AI against the solver')).toBeVisible({ timeout: 90_000 });
  }
  await page.screenshot({
    path: `test-results/screens/${testInfo.project.name}-trade-off-sweep.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
