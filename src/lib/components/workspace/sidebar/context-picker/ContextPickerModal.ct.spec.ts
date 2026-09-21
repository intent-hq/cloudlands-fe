import { expect, test } from '../../../../../test/ct-test';
import ContextPickerModal from './ContextPickerModal.svelte';

test('context picker preserves a translucent full-screen backdrop', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(ContextPickerModal, {
    props: {
      provider: 'github',
      workspaceId: 'context-picker-test',
      isOpen: true,
      onClose: () => {},
      onSelect: () => {},
    },
  });
  const backdrop = component.getByRole('button', { name: 'Close modal', exact: true });
  await expect(backdrop).toHaveCSS(
    'background-color',
    /^(rgba\(0, 0, 0, 0\.5\)|oklab\(0 0 0 \/ 0\.5\))$/,
  );
  await expect(backdrop).not.toHaveCSS('backdrop-filter', 'none');
  await expect(backdrop.locator('[data-slot="button-surface"]')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  const bounds = await backdrop.boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await page.screenshot({ path: testInfo.outputPath('context-picker.png') });
});
