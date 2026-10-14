import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function open(page, theme = 'light') {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.goto(
    `${base}/sandbox/proposal-card?example=interactive&theme=${theme}&motion=reduced`,
  );
  const demo = page.getByTestId('proposal-header-demo');
  await expect(demo).toBeVisible();
  return { demo, errors, frame: demo.getByTestId('proposal-header-frame') };
}

test('proposal header updates caller text and restores its conditional summary', async ({
  page,
}, info) => {
  const { demo, errors, frame } = await open(page);
  const title = demo.getByRole('textbox', { name: 'Proposal title', exact: true });
  const summary = demo.getByRole('textbox', { name: 'Proposal summary', exact: true });
  const toggle = demo.getByRole('button', { name: 'Show summary', exact: true });
  const nextTitle = 'Review <em>literal</em> configuration';
  const nextSummary = 'Keep <strong>caller text</strong> available for review.';
  await title.fill(nextTitle);
  await summary.fill(nextSummary);
  await expect(frame.getByRole('heading', { level: 3 })).toHaveText(nextTitle);
  await expect(frame.locator('p')).toHaveText(nextSummary);
  await expect(frame.locator('em, strong')).toHaveCount(0);
  await expect(frame.getByRole('img')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(frame.locator('p')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(frame.locator('p')).toHaveText(nextSummary);
  await summary.fill('');
  await expect(frame.locator('p')).toHaveCount(0);
  await summary.fill(' ');
  await expect(frame.locator('p')).toHaveCount(1);
  expect(await frame.locator('p').textContent()).toBe(' ');
  await summary.fill(nextSummary);
  await stableLocatorScreenshot(page, demo, async ({ png, attempt }) => {
    if (png)
      await info.attach(`proposal-header-updates-${attempt}`, {
        body: png,
        contentType: 'image/png',
      });
  });
  expect(errors).toEqual([]);
});

for (const scenario of [
  { name: 'narrow wrapping', width: 240, zoom: 1 },
  { name: 'zoomed wrapping', width: 420, zoom: 2 },
]) {
  test(`proposal header keeps updated text readable during ${scenario.name}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    const { demo, errors, frame } = await open(page);
    await demo
      .getByRole('textbox', { name: 'Proposal title', exact: true })
      .fill('Review proposed workspace changes in a narrow conversation panel');
    await page.evaluate((zoom) => {
      document.body.style.zoom = String(zoom);
    }, scenario.zoom);
    await page.evaluate(() => document.fonts.ready);
    await frame.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const geometry = await frame.evaluate((node) => {
      const header = node.querySelector('header');
      const icon = header.querySelector('[data-proposal-header-icon]').getBoundingClientRect();
      return {
        header: header.getBoundingClientRect().toJSON(),
        icon: icon.toJSON(),
        text: [...header.querySelectorAll('h3, p')].map((element) => ({
          box: element.getBoundingClientRect().toJSON(),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
      };
    });
    for (const text of geometry.text) {
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
      expect(text.box.left).toBeGreaterThanOrEqual(geometry.icon.right);
      expect(text.box.right).toBeLessThanOrEqual(geometry.header.right + 1);
      expect(text.box.bottom).toBeLessThanOrEqual(geometry.header.bottom + 1);
    }
    await info.attach('containment.json', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await stableLocatorScreenshot(page, frame, async ({ png, attempt }) => {
      if (png)
        await info.attach(`proposal-header-${scenario.name}-${attempt}`, {
          body: png,
          contentType: 'image/png',
        });
    });
    expect(errors).toEqual([]);
  });
}
