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

type Panel = Awaited<ReturnType<typeof openStatusPanel>>;

const rowFor = (panel: Panel, label: string) =>
  panel.getByText(label, { exact: true }).locator('..');

async function expectNoLinkRows(panel: Panel) {
  await expect(panel.getByText('Running agents for', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Running agents on', { exact: true })).toHaveCount(0);
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
  await expect(rowFor(panel, 'Running agents for')).toContainText('2 backends');
  await expect(rowFor(panel, 'Running agents on')).toContainText('1 machine');
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

test('Hosted agents show their name and workspace; local rows show the workspace title', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('remote-agents-labeled'));
  await openStatusPanel(page);
  const dialog = await openBreakdown(page);
  // A hosted row with labels: agent name as the label, workspace after the backend.
  await expect(dialog.getByText('Write release notes', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('for Studio MacBook Pro · Docs refresh', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', {
      name: /^Write release notes for Studio MacBook Pro · Docs refresh (Claude Code|claude-code) · claude-sonnet-4 /,
    }),
  ).toBeVisible();
  // A hosted row without labels keeps the provider label and the bare backend tag.
  await expect(dialog.getByRole('button', { name: /^(Codex|codex) for a92e04d7 / })).toBeVisible();
  await expect(dialog.getByText('for a92e04d7', { exact: true })).toBeVisible();
  // Backend workspace ids never show.
  await expect(dialog.getByText(/ws-remote-/)).toHaveCount(0);
  // A local row with a title shows it instead of the raw id; one without keeps the id.
  await expect(dialog.getByText(/^Workspace Dark mode toggle( · |$)/)).toBeVisible();
  await expect(dialog.getByText(/^Workspace ws-dark-mode/)).toHaveCount(0);
  await expect(dialog.getByText(/^Workspace ws-flaky-ct( · |$)/)).toBeVisible();
  await attach(testInfo, 'agent-memory-hosted-labels.png', await dialog.screenshot());
});

test('The links row hides when both counts are zero', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('remote-agents-no-links'));
  const panel = await openStatusPanel(page);
  await expectNoLinkRows(panel);
  await attach(testInfo, 'status-panel-no-links.png', await panel.screenshot());
});

test('Links without remote agents show singular counts', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('connected-daemons'));
  const panel = await openStatusPanel(page);
  await expect(panel.getByText('Running agents for', { exact: true })).toHaveCount(0);
  await expect(rowFor(panel, 'Running agents on')).toContainText('1 machine');
  await expect(rowFor(panel, 'Running agents on')).not.toContainText('machines');
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
  await expectNoLinkRows(panel);
  await attach(testInfo, 'status-panel-old-daemon.png', await panel.screenshot());
  const dialog = await openBreakdown(page);
  await expect(dialog.getByText('Implement dark mode', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Fix flaky CT spec', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^for /)).toHaveCount(0);
  await attach(testInfo, 'agent-memory-old-daemon.png', await dialog.screenshot());
});

test('Only the backends row shows when there are no machine links', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('links-backends-only'));
  const panel = await openStatusPanel(page);
  await expect(rowFor(panel, 'Running agents for')).toContainText('1 backend');
  await expect(rowFor(panel, 'Running agents for')).not.toContainText('backends');
  await expect(panel.getByText('Running agents on', { exact: true })).toHaveCount(0);
  await attach(testInfo, 'status-panel-backends-only.png', await panel.screenshot());
});

test('Both rows show plural counts', async ({ mount, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('links-both'));
  const panel = await openStatusPanel(page);
  await expect(rowFor(panel, 'Running agents for')).toContainText('2 backends');
  await expect(rowFor(panel, 'Running agents on')).toContainText('3 machines');
  await attach(testInfo, 'status-panel-links-both.png', await panel.screenshot());
});

test('Paused sandboxes keep the machines row and trail the live count', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('links-live-and-paused'));
  const panel = await openStatusPanel(page);
  await expect(rowFor(panel, 'Running agents on')).toContainText('2 machines (1 paused)');
  await attach(testInfo, 'status-panel-live-and-paused.png', await panel.screenshot());
});

test('Only paused sandboxes still show the machines row', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(DaemonStatusIndicator, scene('links-paused-only'));
  const panel = await openStatusPanel(page);
  await expect(rowFor(panel, 'Running agents on')).toContainText('0 machines (1 paused)');
  await expect(panel.getByText('Running agents for', { exact: true })).toHaveCount(0);
});
