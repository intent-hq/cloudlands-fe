import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Home board shows live pin state and preserves pin-first ordering', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const component = await mount(Preview, { props: { scenario: 'board-pinned', height: 980 } });
  const board = component.locator('[data-home-board]');
  const inactive = board.getByRole('region', { name: 'Done & idle', exact: true });
  const card = inactive.getByRole('button', { name: 'Polish settings accessibility', exact: true });
  const marker = card.locator('[data-home-workspace-pin]');
  const order = () =>
    inactive
      .locator('[data-home-workspace]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-home-workspace')));
  await expect(marker).toBeVisible();
  await expect(card).toHaveAccessibleDescription('Pinned');
  await expect(card.getByRole('img', { name: /^Done\./ })).toBeVisible();
  await expect(board.locator('[data-home-workspace-pin]')).toHaveCount(1);
  await expect
    .poll(order)
    .toEqual(['home-complete', 'home-unread', 'home-waiting', 'home-unknown-time']);
  await testInfo.attach('home-pinned-light', {
    body: await inactive.screenshot(),
    contentType: 'image/png',
  });

  await card.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click();
  await expect(marker).toHaveCount(0);
  await expect(card).not.toHaveAccessibleDescription('Pinned');
  await expect(card).toBeFocused();
  await expect
    .poll(order)
    .toEqual(['home-unread', 'home-waiting', 'home-complete', 'home-unknown-time']);
  await testInfo.attach('home-unpinned-light', {
    body: await inactive.screenshot(),
    contentType: 'image/png',
  });

  await card.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(marker).toBeVisible();
  await expect(card).toBeFocused();
  await expect
    .poll(order)
    .toEqual(['home-complete', 'home-unread', 'home-waiting', 'home-unknown-time']);
  await marker.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();

  const running = board.getByRole('button', {
    name: 'Improve search across workspaces',
    exact: true,
  });
  await running.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(running.locator('[data-home-workspace-pin]')).toBeVisible();
  await expect(running.getByRole('img', { name: /^Running\./ })).toBeVisible();

  for (const name of ['Repository', 'None', 'Activity']) {
    await component.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('combobox', { name: 'Group by', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(board.locator('[data-home-workspace-pin]')).toHaveCount(2);
  }

  await page.evaluate(() =>
    window.__homeWorkspacePreview!.setTitle(
      'home-complete',
      'Keep the pinned workspace visible when its title wraps onto multiple lines in a narrow board column',
    ),
  );
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
  });
  const pinned = inactive.locator('[data-home-workspace="home-complete"]');
  await expect(pinned).toHaveAccessibleDescription('Pinned');
  await expect(pinned.locator('[data-home-workspace-pin]')).toBeVisible();
  await expect(pinned.getByRole('img', { name: /^Done\./ })).toBeVisible();
  await testInfo.attach('home-pinned-narrow-dark', {
    body: await inactive.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.__homeWorkspacePreview!.setTitle('home-complete', ''));
  await expect(
    inactive.getByRole('button', { name: 'Untitled', exact: true }),
  ).toHaveAccessibleDescription('Pinned');
});
