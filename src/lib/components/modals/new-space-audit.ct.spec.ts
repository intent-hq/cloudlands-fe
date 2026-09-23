import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import NewSpaceModal from './NewSpaceModal.svelte';
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
    await mount(selected ? SelectedHarness : NewSpaceModal, {
      props: { open: true },
      hooksConfig: {
        mockBackend: { 'drafts.get': null, 'drafts.set': null },
        mockIpc: {
          'system:check-git': { success: true, data: { available: true, version: '2.50.0' } },
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
    await expect(page.getByText(/Git availability could not be verified/)).toHaveCount(0);
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
