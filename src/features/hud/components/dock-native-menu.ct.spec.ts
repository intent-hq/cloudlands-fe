import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockNativeMenuHarness.svelte';

test.use({ trace: 'retain-on-failure', viewport: { width: 1280, height: 800 } });

test('logo, header, pointer and keyboard share the same native menu IPC payload', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, { hooksConfig: { mockBackend: {} } });
  const logo = page.getByTestId('dock-drag-handle');
  const header = page.locator('.companion-header');
  const expected = {
    machines: [
      { id: 'local', label: 'This Mac' },
      { id: 'remote-build', label: 'Build server' },
      { id: 'remote-long', label: 'Design workstation with a deliberately long machine name' },
    ],
    currentId: 'local',
    pending: null,
    error: false,
    canTurnOff: true,
  };
  const opens = [
    () => logo.click(),
    () => logo.click({ button: 'right' }),
    () => header.dispatchEvent('contextmenu', { button: 2 }),
    () => logo.press('ArrowDown'),
    () => logo.press('ContextMenu'),
    () => logo.press('Shift+F10'),
    () => logo.press('Enter'),
    () => logo.press('Space'),
  ];
  for (const [index, open] of opens.entries()) {
    await open();
    await expect(harness).toHaveAttribute('data-request', JSON.stringify(expected));
    await expect(logo).toHaveAttribute('aria-expanded', 'true');
    // Further entry points must not queue another native menu while it is held.
    await header.dispatchEvent('contextmenu', { button: 2 });
    await expect
      .poll(async () => JSON.parse((await harness.getAttribute('data-requests'))!).length)
      .toBe(index + 1);
    await page.getByRole('button', { name: 'Cancel native menu' }).click();
    await expect(logo).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(harness).toHaveAttribute('data-activations', '0');
  await page.getByRole('button', { name: 'Open menu with reactive devices' }).click();
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).machines)
    .toEqual(expected.machines.slice(0, 2));
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
});

test('native menu hold survives blur and keyboard cancel restores logo focus and can reopen', async ({
  mount,
  page,
}, info) => {
  const harness = await mount(Harness, { hooksConfig: { mockBackend: {} } });
  const shell = page.getByTestId('dock-shell');
  const logo = page.getByTestId('dock-drag-handle');
  await logo.press('ArrowDown');
  await expect(logo).toHaveAttribute('aria-expanded', 'true');
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await page.mouse.move(1200, 740);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- Observe the native IPC hold beyond the ordinary collapse grace period.
  await page.waitForTimeout(1200);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  const path = info.outputPath('native-menu-ipc-stand-in.png');
  await page.screenshot({ path });
  await info.attach('Native menu IPC stand-in — not OS menu', { path, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await expect(logo).toBeFocused();
  await expect(logo).toHaveAttribute('aria-expanded', 'false');
  await logo.press('ArrowDown');
  await expect(logo).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await expect(logo).toBeFocused();
  await expect(harness).toHaveAttribute('data-activations', '0');
  await expect(page.locator('[data-dock-rail-preview]')).not.toHaveAttribute(
    'data-preview-actions',
    /placement:dismiss/,
  );
});

test('Open Intent native result activates the app while cancellation does not', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, { hooksConfig: { mockBackend: {} } });
  const logo = page.getByTestId('dock-drag-handle');
  await logo.click();
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await expect(harness).toHaveAttribute('data-activations', '0');
  await logo.press('ArrowDown');
  await page.getByRole('button', { name: 'Return Open Intent' }).click();
  await expect(harness).toHaveAttribute('data-activations', '1');
  await expect(logo).toHaveAttribute('aria-expanded', 'false');
});

test('conversation header shares native IPC while body and editor keep their edit menu', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, {
    props: { conversationFixture: true },
    hooksConfig: { mockBackend: {} },
  });
  await page.getByTestId('dock-drag-handle').hover();
  await page.locator('[data-dock-row]').first().click();
  const surface = page.getByTestId('dock-conversation-surface');
  await expect(surface).toBeVisible();
  const header = surface.locator('[data-dock-chrome]');
  await header.dispatchEvent('dblclick', { button: 0 });
  await expect(harness).toHaveAttribute('data-activations', '1');
  await header.dispatchEvent('contextmenu', { button: 2 });
  await expect(harness).not.toHaveAttribute('data-request', 'null');
  await page.getByRole('button', { name: 'Cancel native menu' }).click();
  await surface.locator('[data-dock-conversation]').dispatchEvent('contextmenu', { button: 2 });
  const editor = surface.getByRole('textbox').first();
  await editor.dispatchEvent('contextmenu', { button: 2 });
  await expect(harness).toHaveAttribute('data-request', 'null');
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-requests'))!).length)
    .toBe(1);
});

test('active recording forbids Turn off through the shared native request', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, {
    props: { recording: true },
    hooksConfig: { mockBackend: {} },
  });
  await page.getByTestId('dock-drag-handle').click();
  await expect
    .poll(async () => JSON.parse((await harness.getAttribute('data-request'))!).canTurnOff)
    .toBe(false);
  await page.getByRole('button', { name: 'Return Open Intent' }).click();
  await expect(harness).toHaveAttribute('data-activations', '1');
});
