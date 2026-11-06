import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockNativeMenuHarness.svelte';

test.use({ video: 'on', trace: 'on', viewport: { width: 1280, height: 800 } });

test('header activation and native menu hold, cancel, and device selection', async ({
  mount,
  page,
}, info) => {
  const harness = await mount(Harness, { hooksConfig: { mockBackend: {} } });
  const shell = page.getByTestId('dock-shell');
  const header = page.locator('.companion-header');
  const activationCount = () => harness.getAttribute('data-activations');
  await header.dispatchEvent('dblclick', { button: 0 });
  await expect.poll(activationCount).toBe('1');
  await page.getByTestId('dock-drag-handle').click();
  await expect.poll(activationCount).toBe('2');
  await header.dispatchEvent('contextmenu', { button: 2 });
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  const request = JSON.parse((await harness.getAttribute('data-request'))!);
  expect(request.currentId).toBe('local');
  expect(request.machines.map((item: { id: string }) => item.id)).toContain('remote-build');
  await page.mouse.move(1200, 740);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  // Deliberate quiet interval: prove the normal close grace cannot close a native menu hold.
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- observe a quiet interval beyond the close grace while native IPC is held
  await page.waitForTimeout(1200);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await page.screenshot({ path: info.outputPath('native-menu-held.png') });
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await header.dispatchEvent('contextmenu', { button: 2 });
  await page.getByRole('button', { name: 'Choose build server' }).click();
  await expect(page.locator('[data-dock-rail-preview][data-preview-actions]')).toHaveAttribute(
    'data-preview-actions',
    /machine:remote-build/,
  );
  await page.screenshot({ path: info.outputPath('native-device-selected.png') });
});
