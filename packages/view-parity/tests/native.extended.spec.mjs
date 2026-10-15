import { test, expect, openExample, openFixture, openPreview } from '../lib/functional.mjs';

test('picker focus: programmatic focus preserves the popup; outside pointer dismisses it', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'combobox', 'combobox-state-matrix');
  const input = fixture.getByRole('combobox', { name: 'Catalog combobox', exact: true });
  const neighbour = fixture.getByRole('combobox', {
    name: 'Multi-select catalog combobox',
    exact: true,
  });
  await input.click();
  const listboxId = await input.getAttribute('aria-controls');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await neighbour.focus();
  await expect(neighbour).toBeFocused();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await neighbour.click();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[id="${listboxId}"]`)).toHaveCount(0);
});

test('notification undo: hover does not pause the actual operation deadline', async ({ page }) => {
  const example = await openExample(page, 'notify', 'notify');
  await example.getByRole('button', { name: 'Undoable', exact: true }).click();
  await page.getByText('Live undoable toast', { exact: true }).hover();
  await expect(example.getByTestId('notify-events')).toHaveText('expired');
  // Operation expiry is separate from the hovered toast's display lifetime.
  // The source callback does not dismiss the notification.
  await example.getByRole('button', { name: 'Clear live toasts' }).click();
  await expect(page.getByText('Live undoable toast', { exact: true })).toBeHidden();
  expect(
    (await example.getByTestId('notify-events').textContent())
      .split(',')
      .filter((event) => event === 'expired'),
  ).toHaveLength(1);
});

test('notification undo: removing the toast still lets the operation expire', async ({ page }) => {
  const example = await openExample(page, 'notify', 'notify');
  await example.getByRole('button', { name: 'Undoable', exact: true }).click();
  await example.getByRole('button', { name: 'Dismiss undo notification', exact: true }).click();
  await expect(page.getByText('Live undoable toast', { exact: true })).toBeHidden();
  await expect(example.getByTestId('notify-events')).toContainText('expired');
});

test('notification undo: rejected undo presents the real error notification', async ({ page }) => {
  const example = await openExample(page, 'notify', 'notify');
  await example.getByRole('button', { name: 'Failing undo', exact: true }).click();
  await page.locator('[data-sonner-toast]').getByRole('button', { name: /^Undo/ }).click();
  await expect(example.getByTestId('notify-events')).toContainText('undo-failed');
  await expect(page.getByText('Undo operation failed', { exact: true })).toBeVisible();
});

test('notification stack: hover exposes clear-all and dismissal removes both live messages', async ({
  page,
}) => {
  const example = await openExample(page, 'notify', 'notify');
  await example.getByRole('button', { name: 'Stack', exact: true }).click();
  await page.getByText('Live stack: second', { exact: true }).hover();
  const clear = page.getByRole('button', { name: 'Dismiss all 2 notifications', exact: true });
  await expect(clear).toBeVisible();
  await clear.focus();
  await clear.press('Enter');
  await expect(page.getByText('Live stack: first', { exact: true })).toBeHidden();
  await expect(page.getByText('Live stack: second', { exact: true })).toBeHidden();
});

test('toast cancellation: the plain toast cancel button invokes dismissal once', async ({
  page,
}) => {
  const preview = await openPreview(page, 'toast-header', 'plain');
  await preview.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(preview.getByTestId('toast-header-dismissals')).toHaveText('1');
  await expect(preview.getByRole('button', { name: 'Later', exact: true })).toBeHidden();
});

test('content header: native blur commits once while blank edits retain the previous title', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'content-header', 'interaction-example');
  await fixture.getByRole('button', { name: 'Preview implementation plan', exact: true }).click();
  await fixture.getByRole('textbox').fill('Saved on blur');
  await fixture.getByRole('button', { name: 'Header action', exact: true }).click();
  await expect(fixture.getByTestId('header-events')).toHaveText('title,action');
  await fixture.getByRole('button', { name: 'Saved on blur', exact: true }).click();
  await fixture.getByRole('textbox').fill('   ');
  await fixture.getByRole('textbox').press('Enter');
  await expect(fixture.getByTestId('header-title')).toHaveText('Saved on blur');
  await expect(fixture.getByTestId('header-events')).toHaveText('title,action');
});

test('zoom media: native wheel zoom changes image geometry without scrolling the page', async ({
  page,
}) => {
  const example = await openExample(page, 'zoom-pan-viewport', 'zoom-media');
  await example.getByRole('button', { name: 'Open zoom media', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Zoom media preview', exact: true });
  const image = dialog.getByRole('img', { name: 'Neutral geometry fixture', exact: true });
  const before = await image.boundingBox();
  const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  expect(before).not.toBeNull();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => Number(await example.getByLabel('Media zoom scale').textContent()))
    .toBeGreaterThan(1);
  await expect.poll(async () => (await image.boundingBox()).width).toBeGreaterThan(before.width);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(
    scrollBefore,
  );
  await dialog.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await expect(example.getByLabel('Media zoom scale')).toHaveText('1');
});
