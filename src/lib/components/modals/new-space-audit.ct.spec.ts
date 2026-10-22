import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import GitVerificationHarness from './__tests__/GitVerificationAuditHarness.svelte';
import SelectedHarness from './NewSpaceSelectedAuditHarness.svelte';

for (const selected of [false, true]) {
  test(`workspace initializer ${selected ? 'selected repository' : 'empty'} fits a narrow dialog and Escape dismisses it`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const providers = Object.fromEntries(
      [
        'auggie',
        'claudeCode',
        'codex',
        'mock',
        'opencode',
        'cortex',
        'pi',
        'droid',
        'grok',
        'unsloth',
      ].map((id) => [id, { available: id === 'codex', authenticated: id === 'codex' }]),
    );
    await mount(selected ? SelectedHarness : GitVerificationHarness, {
      props: { open: true },
      hooksConfig: {
        mockBackend: {
          'drafts.get': null,
          'drafts.set': null,
          'host.toolAvailability': { tools: { git: { available: true } } },
        },
        mockIpc: {
          ...(selected
            ? {
                'system:check-git': { success: true, data: { available: true, version: '2.50.0' } },
              }
            : {}),
          'providers:get-availability': {
            success: true,
            data: { hasAnyProvider: true, providers },
          },
        },
      },
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (selected)
      await expect(dialog.getByText('design-system', { exact: true }).first()).toBeVisible();
    if (!selected) await expect(page.locator('[data-git-probe-result]')).toHaveText('true');
    await expect(
      page.getByText('Unable to verify Git (connection issue)', { exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: /Close/, exact: false }).first().focus();
    if (process.env.MODAL_AUDIT_CAPTURE_DIR) {
      const directory = resolve(process.env.MODAL_AUDIT_CAPTURE_DIR);
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(directory, `new-space-${selected ? 'selected' : 'ready'}-light-360.png`),
      });
    }
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}
