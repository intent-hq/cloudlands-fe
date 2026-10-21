import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../../../../test/ct-test';
import Harness from './ToastLifetimeHarness.svelte';

test.use({ viewport: { width: 900, height: 640 }, reducedMotion: 'reduce' });

test.beforeEach(async ({ mount, page }) => {
  await page.clock.install();
  await mount(Harness);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
});

async function evidence(page: Page, info: TestInfo) {
  await info.attach('toast-lifetime-result', {
    body: JSON.stringify(
      {
        test: info.title,
        remainingNotifications: await page.locator('[data-sonner-toast]').allTextContents(),
        autoClosed: await page
          .getByRole('status', { name: 'Automatically closed notifications' })
          .textContent(),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await info.attach('toast-lifetime-screen', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

for (const stacked of [false, true]) {
  test(`success expires after two seconds ${stacked ? 'under a persistent toast' : 'on its own'}`, async ({
    page,
  }, info) => {
    await page.getByRole('button', { name: 'Show success', exact: true }).click();
    const success = page.getByText('Workspace saved', { exact: true });
    await expect(success).toBeVisible();
    await page.clock.runFor(1000);
    if (stacked) {
      await page.getByRole('button', { name: 'Show persistent', exact: true }).click();
      await expect(page.getByText('Waiting for your decision', { exact: true })).toBeVisible();
    }
    await expect(success).toBeAttached();
    await page.clock.runFor(1300);
    await expect(success).toHaveCount(0);
    await expect(
      page.getByRole('status', { name: 'Automatically closed notifications' }),
    ).toHaveText('success');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(stacked ? 1 : 0);
    await evidence(page, info);
  });
}

test('hover pauses expiry and leaving resumes the remaining time', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Show success', exact: true }).click();
  const success = page.locator('[data-sonner-toast]').filter({ hasText: 'Workspace saved' });
  await expect(success).toBeVisible();
  await page.clock.runFor(500);
  await success.hover();
  await expect(success).toHaveAttribute('data-expanded', 'true');
  await page.clock.runFor(3000);
  await expect(success).toBeVisible();
  await page.mouse.move(880, 20);
  await expect(success).toHaveAttribute('data-expanded', 'false');
  await page.clock.runFor(1000);
  await expect(success).toBeVisible();
  await page.clock.runFor(800);
  await expect(success).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Automatically closed notifications' })).toHaveText(
    'success',
  );
  await evidence(page, info);
});

test('progress persists until completion then success expires', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Start upload', exact: true }).click();
  await expect(page.getByText('Uploading attachment', { exact: true })).toBeVisible();
  await page.clock.runFor(15000);
  await expect(page.getByText('Uploading attachment', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish upload', exact: true }).click();
  await expect(page.getByText('Upload finished', { exact: true })).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.getByText('Upload finished', { exact: true })).toBeVisible();
  await page.clock.runFor(1300);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Automatically closed notifications' })).toHaveText(
    'progress-success',
  );
  await evidence(page, info);
});
