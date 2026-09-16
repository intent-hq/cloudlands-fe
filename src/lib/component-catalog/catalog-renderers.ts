import type { Component } from 'svelte';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
const loadBasic = () => import('./renderers/BasicCatalogPreview.svelte');
const loadChoice = () => import('./renderers/ChoiceCatalogPreview.svelte');
const loadContentField = () => import('./renderers/ContentFieldCatalogPreview.svelte');
const loadNavigationHelp = () => import('./renderers/NavigationHelpCatalogPreview.svelte');
const loadOverlay = () => import('./renderers/OverlayCatalogPreview.svelte');
const loadSubscriptionRows = () => import('./renderers/SubscriptionRowsCatalogPreview.svelte');
const loadSettings = () => import('./renderers/SettingsCatalogPreview.svelte');

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

type CatalogRenderer<K extends CatalogRendererId> = () => Promise<{
  default: Component<{
    componentId: K;
    fixture: UiComponentFixture;
  }>;
}>;

type CatalogRendererRegistry = {
  [K in CatalogRendererId]: CatalogRenderer<K>;
};

export const catalogRenderers = {
  'subscription-rows': loadSubscriptionRows,
  badge: loadBasic,
  breadcrumb: loadNavigationHelp,
  button: loadBasic,
  'button-group': loadBasic,
  card: loadContentField,
  checkbox: loadBasic,
  combobox: loadChoice,
  dialog: loadOverlay,
  'file-input': loadSettings,
  input: loadContentField,
  label: loadContentField,
  list: loadContentField,
  menu: loadOverlay,
  'scroll-area': loadNavigationHelp,
  select: loadChoice,
  separator: loadContentField,
  'settings-field-row': loadSettings,
  'settings-page-shell': loadSettings,
  'settings-section': loadSettings,
  sheet: loadOverlay,
  sidebar: loadNavigationHelp,
  skeleton: loadContentField,
  slider: loadSettings,
  spinner: loadContentField,
  switch: loadBasic,
  textarea: loadContentField,
  toggle: loadBasic,
  'toggle-group': loadBasic,
  tooltip: loadNavigationHelp,
} satisfies CatalogRendererRegistry;

export async function getCatalogRenderer(
  id: string,
): Promise<{ id: CatalogRendererId; component: Component<CatalogRendererProps> } | undefined> {
  if (!catalogRendererIds.includes(id as CatalogRendererId)) return undefined;
  const rendererId = id as CatalogRendererId;
  return {
    id: rendererId,
    component: (await catalogRenderers[rendererId]())
      .default as unknown as Component<CatalogRendererProps>,
  };
}
