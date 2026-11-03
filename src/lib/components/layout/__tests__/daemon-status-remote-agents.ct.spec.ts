import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import DaemonStatusIndicator from '../DaemonStatusIndicator.svelte';

const scene = (state: string) => ({
  hooksConfig: { previewScene: { scene: 'daemon-status-indicator', state } },
});

async function openStatusPanel(page: Page) {
  await page.getByRole('button').click();
  await page.getByRole('menuitem', { name: /^Status -/ }).press('ArrowRight');
  const panel = page.getByRole('region', { name: 'Daemon Status', exact: true });
  await expect(panel).toBeVisible();
  await panel.evaluate((element) => window.__INTENT_PREVIEW_CT__.waitForCaptureStability(element));
  return panel;
}

async function openBreakdown(page: Page) {
  await page.getByRole('menuitem', { name: /^Agent memory/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent memory' });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => window.__INTENT_PREVIEW_CT__.waitForCaptureStability(element));
  return dialog;
}

async function attach(testInfo: TestInfo, name: string, body: Buffer) {
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

test('Remote agents are tagged with their backend and links are counted', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('remote-agents'));
  const panel = await openStatusPanel(page);
  const linksRow = panel.getByText('Connected daemons', { exact: true }).locator('..');
  await expect(linksRow).toContainText('2 backends · 1 machine');
  await attach(testInfo, 'status-panel-remote-agents.png', await panel.screenshot());

  const dialog = await openBreakdown(page);
  // Named backend, and a short-id fallback for a backend without a name.
  await expect(dialog.getByText('for Studio MacBook Pro', { exact: true })).toBeVisible();
  await expect(dialog.getByText('for a92e04d7', { exact: true })).toBeVisible();
  // Remote agents carry no name and a backend workspace id: label them by
  // provider and model, never by a short id or a workspace line.
  await expect(dialog.getByText(/^(Claude Code|claude-code) · claude-sonnet-4$/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^(Codex|codex) for a92e04d7 / })).toBeVisible();
  await expect(dialog.getByText(/^Agent [0-9a-f]{8}$/)).toHaveCount(0);
  await expect(dialog.getByText(/ws-remote-/)).toHaveCount(0);
  // Local rows keep their name and no tag.
  await expect(dialog.getByText('Implement dark mode', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^for /)).toHaveCount(2);
  await attach(testInfo, 'agent-memory-remote-agents.png', await dialog.screenshot());
});

test('The links row hides when both counts are zero', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('remote-agents-no-links'));
  const panel = await openStatusPanel(page);
  await expect(panel.getByText('Connected daemons', { exact: true })).toHaveCount(0);
  await attach(testInfo, 'status-panel-no-links.png', await panel.screenshot());
});

test('Links without remote agents show singular counts', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('connected-daemons'));
  const panel = await openStatusPanel(page);
  const linksRow = panel.getByText('Connected daemons', { exact: true }).locator('..');
  await expect(linksRow).toContainText('0 backends · 1 machine');
  await attach(testInfo, 'status-panel-links-only.png', await panel.screenshot());
  const dialog = await openBreakdown(page);
  await expect(dialog.getByText(/^for /)).toHaveCount(0);
});

test('An older daemon renders as before: no links row, no tags', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('agent-memory'));
  const panel = await openStatusPanel(page);
  await expect(panel.getByText('Connected daemons', { exact: true })).toHaveCount(0);
  await attach(testInfo, 'status-panel-old-daemon.png', await panel.screenshot());
  const dialog = await openBreakdown(page);
  await expect(dialog.getByText('Implement dark mode', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Fix flaky CT spec', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^for /)).toHaveCount(0);
  await attach(testInfo, 'agent-memory-old-daemon.png', await dialog.screenshot());
});
