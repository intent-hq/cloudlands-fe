import type { Component } from 'svelte';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import MessageComposerCatalogPreview from './renderers/MessageComposerCatalogPreview.svelte';
import AskUserQuestionsCatalogPreview from './renderers/AskUserQuestionsCatalogPreview.svelte';
import BasicCatalogPreview from './renderers/BasicCatalogPreview.svelte';
import ChoiceCatalogPreview from './renderers/ChoiceCatalogPreview.svelte';
import ChoiceGroupCatalogPreview from './renderers/ChoiceGroupCatalogPreview.svelte';
import ContentFieldCatalogPreview from './renderers/ContentFieldCatalogPreview.svelte';
import NavigationHelpCatalogPreview from './renderers/NavigationHelpCatalogPreview.svelte';
import NavigationPrimitivesCatalogPreview from './renderers/NavigationPrimitivesCatalogPreview.svelte';
import OverlayCatalogPreview from './renderers/OverlayCatalogPreview.svelte';
import ProximityHighlightCatalogPreview from './renderers/ProximityHighlightCatalogPreview.svelte';
import SettingsCatalogPreview from './renderers/SettingsCatalogPreview.svelte';
import ToastCatalogPreview from './renderers/ToastCatalogPreview.svelte';

export const catalogRendererIds = [
  'accordion',
  'ask-user-questions',
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'card',
  'checkbox',
  'checkbox-group',
  'combobox',
  'dropdown',
  'grouped-combobox',
  'copy-input',
  'dialog',
  'file-input',
  'input',
  'input-group',
  'input-message',
  'kbd',
  'label',
  'list',
  'menu',
  'message-composer',
  'proximity-highlight',
  'radio-group',
  'scroll-area',
  'searchable-select',
  'select',
  'separator',
  'settings-field-row',
  'settings-page-shell',
  'settings-section',
  'sheet',
  'sidebar',
  'skeleton',
  'slider',
  'loading-indicator',
  'switch',
  'table',
  'tabs',
  'textarea',
  'toast',
  'toggle',
  'toggle-group',
  'tooltip',
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
  accordion: NavigationPrimitivesCatalogPreview,
  'ask-user-questions': AskUserQuestionsCatalogPreview,
  badge: BasicCatalogPreview,
  breadcrumb: NavigationHelpCatalogPreview,
  button: BasicCatalogPreview,
  'button-group': BasicCatalogPreview,
  card: ContentFieldCatalogPreview,
  checkbox: BasicCatalogPreview,
  'checkbox-group': ChoiceGroupCatalogPreview,
  combobox: ChoiceCatalogPreview,
  dropdown: ChoiceCatalogPreview,
  'grouped-combobox': ChoiceCatalogPreview,
  'copy-input': ContentFieldCatalogPreview,
  dialog: OverlayCatalogPreview,
  'file-input': SettingsCatalogPreview,
  input: ContentFieldCatalogPreview,
  'input-group': ContentFieldCatalogPreview,
  'input-message': ContentFieldCatalogPreview,
  kbd: NavigationHelpCatalogPreview,
  label: ContentFieldCatalogPreview,
  list: ContentFieldCatalogPreview,
  menu: OverlayCatalogPreview,
  'message-composer': MessageComposerCatalogPreview,
  'proximity-highlight': ProximityHighlightCatalogPreview,
  'radio-group': ChoiceGroupCatalogPreview,
  'scroll-area': NavigationHelpCatalogPreview,
  'searchable-select': ChoiceCatalogPreview,
  select: ChoiceCatalogPreview,
  separator: ContentFieldCatalogPreview,
  'settings-field-row': SettingsCatalogPreview,
  'settings-page-shell': SettingsCatalogPreview,
  'settings-section': SettingsCatalogPreview,
  sheet: OverlayCatalogPreview,
  sidebar: NavigationHelpCatalogPreview,
  skeleton: ContentFieldCatalogPreview,
  slider: SettingsCatalogPreview,
  'loading-indicator': ContentFieldCatalogPreview,
  switch: BasicCatalogPreview,
  table: ContentFieldCatalogPreview,
  tabs: NavigationPrimitivesCatalogPreview,
  textarea: ContentFieldCatalogPreview,
  toast: ToastCatalogPreview,
  toggle: BasicCatalogPreview,
  'toggle-group': BasicCatalogPreview,
  tooltip: NavigationHelpCatalogPreview,
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
