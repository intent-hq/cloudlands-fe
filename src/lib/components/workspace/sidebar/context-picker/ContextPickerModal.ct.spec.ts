import { expect, test } from '../../../../../test/ct-test';
import ContextPickerModal from './ContextPickerModal.svelte';

test('context picker has one modal owner and a viewport-sized shared backdrop', async ({
  mount,
  page,
}, testInfo) => {
  let closed = 0;
  await mount(ContextPickerModal, {
    props: {
      provider: 'github',
      workspaceId: 'context-picker-test',
      isOpen: true,
      onClose: () => {
        closed++;
      },
      onSelect: () => {},
    },
  });
  const dialog = page.getByRole('dialog', { name: 'GitHub Issues' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const backdrop = page.locator('[data-slot="dialog-overlay"]');
  const bounds = await backdrop.boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await page.screenshot({ path: testInfo.outputPath('context-picker.png') });
  await page.keyboard.press('Escape');
  await expect.poll(() => closed).toBe(1);
  await expect(dialog).toHaveCount(0);
});
