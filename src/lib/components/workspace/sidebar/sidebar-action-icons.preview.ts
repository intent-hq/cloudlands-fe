import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import SidebarActionIconsHarness from './SidebarActionIconsHarness.svelte';

export const preview = definePreview<ComponentProps<typeof SidebarActionIconsHarness>>({
  id: 'sidebar-action-icons',
  title: 'Sidebar action icons',
  defaultState: 'default',
  states: { default: { props: {} } },
});

export default SidebarActionIconsHarness;
