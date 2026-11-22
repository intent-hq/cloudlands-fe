import { expect, installPausedClock, test } from '../../../test/ct-test';
import Harness from './__tests__/DockNativeMenuHarness.svelte';

test.use({ viewport: { width: 1280, height: 800 } });

for (const side of ['left', 'right'] as const) {
  test(`native menu device selection on the ${side} rail keeps the chosen machine`, async ({
    mount,
    page,
  }) => {
    const harness = await installPausedClock(page, () =>
      mount(Harness, { props: { placement: `side-${side}` }, hooksConfig: { mockBackend: {} } }),
    );
    const logo = page.getByTestId('dock-drag-handle');
    await logo.press('ArrowDown');
    await expect
      .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).currentId)
      .toBe('local');
    await page.getByRole('button', { name: 'Choose build server' }).click();
    await page.clock.runFor(600);
    await logo.press('ArrowDown');
    await expect
      .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).currentId)
      .toBe('remote-build');
    await page.getByRole('button', { name: 'Cancel native menu' }).click();
    await expect(logo).toBeFocused();
    await expect(page.locator('[data-dock-rail-preview]')).toHaveAttribute(
      'data-preview-actions',
      '["machine:remote-build"]',
    );
  });
}

test('failed native device selection preserves current machine and retries on the same menu IPC', async ({
  mount,
  page,
}, info) => {
  const harness = await installPausedClock(page, () =>
    mount(Harness, { props: { failMachineOnce: true }, hooksConfig: { mockBackend: {} } }),
  );
  const logo = page.getByTestId('dock-drag-handle');
  await logo.press('ArrowDown');
  await page.getByRole('button', { name: 'Choose build server' }).click();
  await page.clock.runFor(600);
  const feedback = page.locator('[data-dock-action-feedback]');
  await expect(feedback.getByRole('status')).toHaveText(
    'Could not connect. Select a host to retry.',
  );
  await expect(feedback).toBeVisible();
  await feedback.screenshot({ path: info.outputPath('machine-switch-error.png') });
  await feedback.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).error)
    .toBe(true);
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).currentId)
    .toBe('local');
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await feedback.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(feedback).toHaveCount(0);
  await logo.press('ArrowDown');
  await page.getByRole('button', { name: 'Choose build server' }).click();
  await page.clock.runFor(600);
  await expect(feedback).toHaveCount(0);
  await logo.press('ArrowDown');
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).currentId)
    .toBe('remote-build');
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).error)
    .toBe(false);
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await expect(logo).toBeFocused();
  await expect(page.locator('[data-dock-rail-preview]')).toHaveAttribute(
    'data-preview-actions',
    '["machine:remote-build","machine:remote-build"]',
  );
});

test('native menu remains available without machines', async ({ mount, page }) => {
  const harness = await mount(Harness, {
    props: { machines: false },
    hooksConfig: { mockBackend: {} },
  });
  const logo = page.getByTestId('dock-drag-handle');
  await logo.press('ArrowDown');
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).machines)
    .toBeUndefined();
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await expect(logo).toBeFocused();
  await expect(page.locator('[data-dock-rail-preview]')).toHaveAttribute(
    'data-preview-actions',
    '[]',
  );
});
