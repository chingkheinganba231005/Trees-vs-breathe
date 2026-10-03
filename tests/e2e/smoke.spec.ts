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
