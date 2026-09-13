import type { Component } from 'svelte';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import BasicCatalogPreview from './renderers/BasicCatalogPreview.svelte';
import ChoiceCatalogPreview from './renderers/ChoiceCatalogPreview.svelte';
import ContentFieldCatalogPreview from './renderers/ContentFieldCatalogPreview.svelte';
import NavigationHelpCatalogPreview from './renderers/NavigationHelpCatalogPreview.svelte';
import OverlayCatalogPreview from './renderers/OverlayCatalogPreview.svelte';
import SettingsCatalogPreview from './renderers/SettingsCatalogPreview.svelte';
import SubscriptionRowsCatalogPreview from './renderers/SubscriptionRowsCatalogPreview.svelte';

export const catalogRendererIds = [
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'card',
  'checkbox',
  'combobox',
  'dialog',
  'file-input',
  'input',
  'label',
  'list',
  'menu',
  'scroll-area',
  'select',
  'separator',
  'settings-field-row',
  'settings-page-shell',
  'settings-section',
  'sheet',
  'sidebar',
  'skeleton',
  'slider',
  'spinner',
  'switch',
  'textarea',
  'toggle',
  'toggle-group',
  'tooltip',
  'subscription-rows',
] as const;

export type CatalogRendererId = (typeof catalogRendererIds)[number];

export interface CatalogRendererProps {
  componentId: CatalogRendererId;
  fixture: UiComponentFixture;
}

type CatalogRenderer<K extends CatalogRendererId> = Component<{
  componentId: K;
  fixture: UiComponentFixture;
}>;

type CatalogRendererRegistry = {
  [K in CatalogRendererId]: CatalogRenderer<K>;
};

export const catalogRenderers = {
  badge: BasicCatalogPreview,
  breadcrumb: NavigationHelpCatalogPreview,
  button: BasicCatalogPreview,
  'button-group': BasicCatalogPreview,
  card: ContentFieldCatalogPreview,
  checkbox: BasicCatalogPreview,
  combobox: ChoiceCatalogPreview,
  dialog: OverlayCatalogPreview,
  'file-input': SettingsCatalogPreview,
  input: ContentFieldCatalogPreview,
  label: ContentFieldCatalogPreview,
  list: ContentFieldCatalogPreview,
  menu: OverlayCatalogPreview,
  'scroll-area': NavigationHelpCatalogPreview,
  select: ChoiceCatalogPreview,
  separator: ContentFieldCatalogPreview,
  'settings-field-row': SettingsCatalogPreview,
  'settings-page-shell': SettingsCatalogPreview,
  'settings-section': SettingsCatalogPreview,
  sheet: OverlayCatalogPreview,
  sidebar: NavigationHelpCatalogPreview,
  skeleton: ContentFieldCatalogPreview,
  slider: SettingsCatalogPreview,
  spinner: ContentFieldCatalogPreview,
  switch: BasicCatalogPreview,
  textarea: ContentFieldCatalogPreview,
  toggle: BasicCatalogPreview,
  'toggle-group': BasicCatalogPreview,
  tooltip: NavigationHelpCatalogPreview,
  'subscription-rows': SubscriptionRowsCatalogPreview,
} satisfies CatalogRendererRegistry;

export function getCatalogRenderer(
  id: string,
): { id: CatalogRendererId; component: Component<CatalogRendererProps> } | undefined {
  if (!catalogRendererIds.includes(id as CatalogRendererId)) return undefined;
  const rendererId = id as CatalogRendererId;
  return {
    id: rendererId,
    component: catalogRenderers[rendererId] as unknown as Component<CatalogRendererProps>,
  };
}
