import { expect, test } from '@playwright/experimental-ct-svelte';
import type { CDPSession } from '@playwright/test';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

const cases = [{ theme: 'dark', label: 'dark 200%', zoom: 2, width: 680 }] as const;

// The CT page is reused across tests and CDP emulation overrides are
// per-session, so clear the override on the SAME session and detach it to
// keep the metrics from leaking into later specs in this worker.
let activeCdp: CDPSession | null = null;

test.afterEach(async () => {
  if (!activeCdp) return;
  await activeCdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await activeCdp.detach().catch(() => {});
  activeCdp = null;
});

for (const state of cases) {
  test(`hides delivery notes through the real ChatPanel at ${state.label}`, async ({
    context,
    mount,
    page,
  }) => {
    const viewport = { width: state.width / state.zoom, height: 760 / state.zoom };
    const cdp = await context.newCDPSession(page);
    activeCdp = cdp;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      deviceScaleFactor: state.zoom,
      mobile: false,
      screenWidth: state.width,
      screenHeight: 760,
    });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: state.theme });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const component = await mount(ChatMessageNavigatorIntegrationHost, {
      props: { theme: state.theme },
    });

    const header = component.locator('[data-panel-content-header]');
    const trigger = header
      .locator('[data-panel-header-actions]')
      .getByTestId('chat-message-navigator-trigger');
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Browse user messages' });
    const search = dialog.getByRole('combobox', { name: 'Filter user messages' });
    const options = dialog.getByRole('option');

    await search.fill('Authored literal [SYSTEM NOTE]');
    await expect(
      dialog.getByRole('option', { name: 'Authored literal [SYSTEM NOTE] must stay visible' }),
    ).toHaveCount(1);
    await search.fill('queued before you completed');
    await expect(options).toHaveCount(0);
    await search.fill('queued at 2026');
    await expect(options).toHaveCount(0);
    await search.fill('Virtualized target six');
    await dialog.getByRole('option', { name: 'Virtualized target six', exact: true }).click();

    const target = page.locator('[data-message-id="user-6"]');
    await expect(target).toContainText('Virtualized target six');
    await expect(target).not.toContainText('[SYSTEM NOTE]');
    await expect(target.getByTestId('queued-message-notice-text')).toHaveText(
      'Waited in queue for 37s',
    );
    await expect(target.getByTestId('queued-message-notice')).toHaveAttribute('title', /2026/);
    expect(await target.ariaSnapshot()).not.toContain('[SYSTEM NOTE]');

    await target.hover();
    await target.getByRole('button', { name: 'Copy message' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Virtualized target six');

    await target.getByTestId('user-message-surface').dblclick();
    const editInput = target.getByTestId('message-input');
    await expect(editInput).toContainText('Virtualized target six');
    await expect(editInput).not.toContainText('[SYSTEM NOTE]');
  });
}
