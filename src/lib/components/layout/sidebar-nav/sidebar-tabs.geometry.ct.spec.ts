import { fileURLToPath } from 'node:url';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import SidebarTabsPreview from './sidebar-tabs.preview.svelte';

defineGeometrySnapshotSuite({
  scene: 'sidebar-tabs',
  component: SidebarTabsPreview,
  states: ['workspaces', 'intent', 'narrow'],
  widths: [420],
  selector: '[data-sidebar-tabs-preview], [role="tablist"], [role="tab"], [role="tabpanel"]',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/sidebar-tabs.geometry.json', import.meta.url),
  ),
});
