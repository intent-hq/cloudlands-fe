import { expect, test } from '@playwright/experimental-ct-svelte';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import PanelTabStripPreview from './panel-tab-strip.preview.svelte';

const tabs: PanelTab[] = [
  {
    id: 'preview-note-primary',
    type: 'note',
    title: 'Preview implementation plan',
    closable: true,
    workspaceId: 'preview-workspace-primary',
    noteId: 'preview-note-primary',
  },
  {
    id: 'preview-message-primary',
    type: 'file',
    title: 'A very long panel title that must truncate before the actions',
    closable: true,
    workspaceId: 'preview-workspace-primary',
    filePath: '/repos/cloudlands-fe/src/lib/components/workspace/workspace-sidebar.preview.svelte',
  },
];

test('renders empty, single, many-tabs, long-content, and narrow panel states', async ({
  mount,
}) => {
  const component = await mount(PanelTabStripPreview, {
    props: { activeTabId: null, tabs: [], width: 560 },
  });

  await expect(component.locator('[data-panel-tab-bar]')).toBeVisible();
  await expect(component.locator('[data-tab-id]')).toHaveCount(0);

  await component.update({ props: { activeTabId: tabs[0].id, tabs: [tabs[0]], width: 560 } });
  await expect(component.locator('[data-tab-id]')).toHaveCount(1);
  await expect(
    component.locator('[data-tab-id]').getByText('Preview implementation plan'),
  ).toBeVisible();

  await component.update({ props: { activeTabId: tabs[1].id, tabs, width: 760 } });
  await expect(component.locator('[data-tab-id]')).toHaveCount(2);
  await expect(component.locator('[data-tab-id="preview-message-primary"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await component.update({ props: { activeTabId: tabs[1].id, tabs: [tabs[1]], width: 560 } });
  await expect(component.locator('[data-tab-id]').getByText(/very long panel title/)).toBeVisible();

  await component.update({ props: { activeTabId: tabs[1].id, tabs, width: 260 } });
  await expect(component).toHaveAttribute('data-preview-width', '260');
  await expect(component.locator('[data-tab-id]')).toHaveCount(2);
});
