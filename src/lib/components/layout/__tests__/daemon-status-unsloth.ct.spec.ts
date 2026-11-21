import type { Page } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import DaemonStatusIndicator from '../DaemonStatusIndicator.svelte';

const scene = (state: string) => ({
  hooksConfig: { previewScene: { scene: 'daemon-status-indicator', state } },
});

async function openPanel(page: Page, trigger: RegExp, region: string) {
  await page.getByRole('menuitem', { name: trigger }).press('ArrowRight');
  const panel = page.getByRole('region', { name: region, exact: true });
  await expect(panel).toBeVisible();
  await panel.evaluate((element) => window.__INTENT_PREVIEW_CT__.waitForCaptureStability(element));
  return panel;
}

test('A running Unsloth server gets its own submenu named by its phase', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('unsloth-minting'));
  await page.getByRole('button').click();

  const daemonPanel = await openPanel(page, /^Status -/, 'Daemon Status');
  await expect(daemonPanel.getByRole('menuitem', { name: 'Stop server' })).toHaveCount(0);
  await expect(daemonPanel.getByText('Attached agents', { exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');

  const unslothPanel = await openPanel(page, /^Unsloth - Minting$/, 'Unsloth Server');
  await expect(
    unslothPanel.getByText('Attached agents', { exact: true }).locator('..'),
  ).toContainText('2');
  await testInfo.attach('unsloth-panel-minting.png', {
    body: await unslothPanel.screenshot(),
    contentType: 'image/png',
  });

  await unslothPanel.getByRole('menuitem', { name: 'Stop server' }).click();
  await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();
});

test('A ready Unsloth server reads as healthy', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('unsloth-ready'));
  await page.getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: /^Unsloth - Healthy$/ })).toBeVisible();
});

test('No Unsloth submenu appears when no server runs', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('healthy'));
  await page.getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: /^Status -/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Unsloth/ })).toHaveCount(0);
});

test('Each running model gets its own row, and its stop names only that model', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('unsloth-two-servers'));
  await page.getByRole('button').click();

  await expect(page.getByRole('menuitem', { name: /^Unsloth/ })).toHaveCount(2);
  await expect(
    page.getByRole('menuitem', { name: 'Unsloth: Qwen3.8-27B - Healthy' }),
  ).toBeVisible();

  const minting = await openPanel(page, /^Unsloth: Qwen3\.5-9B - Minting$/, 'Unsloth: Qwen3.5-9B');
  await expect(minting.getByText('Attached agents', { exact: true }).locator('..')).toContainText(
    '0',
  );
  await testInfo.attach('unsloth-panel-two-servers.png', {
    body: await minting.screenshot(),
    contentType: 'image/png',
  });
  await minting.getByRole('menuitem', { name: 'Stop server' }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText('unsloth/Qwen3.5-9B-GGUF');
  await expect(dialog).not.toContainText('Qwen3.8-27B');
});

test('A daemon that cannot stop one model says stop ends every server', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('unsloth-two-servers-stop-all'));
  await page.getByRole('button').click();

  const ready = await openPanel(page, /^Unsloth: Qwen3\.8-27B - Healthy$/, 'Unsloth: Qwen3.8-27B');
  await ready.getByRole('menuitem', { name: 'Stop all servers' }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText('all 2 managed Unsloth servers');
});
