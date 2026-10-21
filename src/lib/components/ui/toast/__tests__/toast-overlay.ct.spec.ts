import { expect, test } from '../../../../../test/ct-test';
import Harness from './ToastOverlayHarness.svelte';

test.use({ viewport: { width: 900, height: 640 }, reducedMotion: 'reduce' });

test('an overlapping dropdown receives the click instead of the toast', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness, { props: { overlap: true } });
  const front = page.locator('[data-sonner-toast][data-front="true"]');
  await expect(front).toHaveAttribute('data-mounted', 'true');
  await page.getByRole('button', { name: 'Repository menu' }).click();
  const item = page.getByRole('menuitem', { name: 'Create repository' });
  await expect(item).toBeVisible();
  const overlap = await item.evaluate((element) => {
    const item = element.getBoundingClientRect();
    const toast = document
      .querySelector('[data-sonner-toast][data-front="true"]')!
      .getBoundingClientRect();
    const left = Math.max(item.left, toast.left);
    const right = Math.min(item.right, toast.right);
    const top = Math.max(item.top, toast.top);
    const bottom = Math.min(item.bottom, toast.bottom);
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    };
  });
  expect(overlap.width).toBeGreaterThan(0);
  expect(overlap.height).toBeGreaterThan(0);
  await testInfo.attach('dropdown-above-toast', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.mouse.click(overlap.x, overlap.y);
  await expect(page.getByRole('status', { name: 'Selections' })).toHaveText('1');
  await expect(page.getByRole('status', { name: 'Undos' })).toHaveText('0');
});

test('exposed toast actions, dismissal, and Clear all work while a menu locks the page', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness);
  const openMenu = async () => {
    await page.getByRole('button', { name: 'Repository menu' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('pointer-events', 'none');
  };
  await openMenu();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Undos' })).toHaveText('1');
  await expect(page.locator('[data-sonner-toast]:not([data-removed="true"])')).toHaveCount(1);
  await openMenu();
  await page.locator('[data-sonner-toast]:not([data-removed="true"]) [data-close-button]').click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show notifications' }).click();
  await openMenu();
  await testInfo.attach('exposed-toast-controls', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Dismiss all 2 notifications' }).click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

test('the workspace modal shields background toasts and keeps its repository popup usable', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness);
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Choose repository', exact: true }).click();
  const action = page.getByRole('button', { name: 'Use example repository' });
  await action.click();
  await expect(page.getByRole('status', { name: 'Selections' })).toHaveText('1');
  const toastIsShielded = await page
    .getByRole('button', { name: 'Undo', exact: true })
    .evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return Boolean(hit?.closest('[data-slot="dialog-overlay"], [data-slot="dialog-content"]'));
    });
  expect(toastIsShielded).toBe(true);
  await testInfo.attach('modal-shields-background-toasts', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(action).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Undos' })).toHaveText('1');
});
