import { expect, test } from '@playwright/experimental-ct-svelte';
import Preview from './aurora-performance.preview.svelte';

for (const pixelRatio of ['native', 0.5] as const) {
  test(`records real WebGL draws at ${pixelRatio} resolution`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.bringToFront();
    const component = await mount(Preview, { props: { pixelRatio, durationMs: 1000 } });
    await component.getByRole('button', { name: 'Record', exact: false }).click();
    const result = component.getByTestId('aura-benchmark-result');
    await expect(result).toBeVisible();
    const report = JSON.parse((await result.textContent())!);
    const canvas = await component.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      dpr: window.devicePixelRatio,
    }));
    const ratio = pixelRatio === 'native' ? canvas.dpr : Math.min(canvas.dpr, 0.5);
    expect(report.valid).toBe(true);
    expect(report.draws).toBeGreaterThan(0);
    expect(report.backingWidth).toBe(Math.round(canvas.cssWidth * ratio));
    expect(report.backingHeight).toBe(Math.round(canvas.cssHeight * ratio));
    expect(report.intervalP95Ms).toBeGreaterThan(0);
  });
}

test('Off removes the WebGL canvas and records a zero-draw baseline', async ({ mount }) => {
  const component = await mount(Preview, { props: { durationMs: 200 } });
  await component.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(component.locator('canvas')).toHaveCount(0);
  await component.getByRole('button', { name: 'Record', exact: false }).click();
  const result = component.getByTestId('aura-benchmark-result');
  await expect(result).toBeVisible();
  expect(JSON.parse((await result.textContent())!).draws).toBe(0);
});

test('flags a run interrupted by the app focus signal', async ({ mount, page }) => {
  const component = await mount(Preview, { props: { durationMs: 500 } });
  await component.getByRole('button', { name: 'Record', exact: false }).click();
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  const result = component.getByTestId('aura-benchmark-result');
  await expect(result).toBeVisible();
  expect(JSON.parse((await result.textContent())!)).toMatchObject({
    valid: false,
    interrupted: true,
  });
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
});
