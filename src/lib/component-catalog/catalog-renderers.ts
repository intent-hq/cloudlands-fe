const ModelPickerCatalogPreview = () => import('./renderers/ModelPickerCatalogPreview.svelte');
import type { Component } from 'svelte';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
const MessageComposerCatalogPreview = () =>
  import('./renderers/MessageComposerCatalogPreview.svelte');
const AskUserQuestionsCatalogPreview = () =>
  import('./renderers/AskUserQuestionsCatalogPreview.svelte');
const BasicCatalogPreview = () => import('./renderers/BasicCatalogPreview.svelte');
const ChoiceCatalogPreview = () => import('./renderers/ChoiceCatalogPreview.svelte');
const ChoiceGroupCatalogPreview = () => import('./renderers/ChoiceGroupCatalogPreview.svelte');
const ContentFieldCatalogPreview = () => import('./renderers/ContentFieldCatalogPreview.svelte');
const NavigationHelpCatalogPreview = () =>
  import('./renderers/NavigationHelpCatalogPreview.svelte');
const NavigationPrimitivesCatalogPreview = () =>
  import('./renderers/NavigationPrimitivesCatalogPreview.svelte');
const OverlayCatalogPreview = () => import('./renderers/OverlayCatalogPreview.svelte');
const ProximityHighlightCatalogPreview = () =>
  import('./renderers/ProximityHighlightCatalogPreview.svelte');
const SettingsCatalogPreview = () => import('./renderers/SettingsCatalogPreview.svelte');
const ToastCatalogPreview = () => import('./renderers/ToastCatalogPreview.svelte');
const ModalCatalogPreview = () => import('./renderers/ModalCatalogPreview.svelte');
const PopoversCatalogPreview = () => import('./renderers/PopoversCatalogPreview.svelte');
const RowsCatalogPreview = () => import('./renderers/RowsCatalogPreview.svelte');
const FieldsCatalogPreview = () => import('./renderers/FieldsCatalogPreview.svelte');
const ScreenStatesCatalogPreview = () => import('./renderers/ScreenStatesCatalogPreview.svelte');

const catalogRendererIds = [
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
  'fields',
  'input',
  'input-group',
  'input-message',
  'kbd',
  'label',
  'list',
  'menu',
  'message-composer',
  'modals',
  'model-picker',
  'proximity-highlight',
  'popovers',
  'rows',
  'screen-states',
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
  'model-picker': ModelPickerCatalogPreview,
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
  fields: FieldsCatalogPreview,
  input: ContentFieldCatalogPreview,
  'input-group': ContentFieldCatalogPreview,
  'input-message': ContentFieldCatalogPreview,
  kbd: NavigationHelpCatalogPreview,
  label: ContentFieldCatalogPreview,
  list: ContentFieldCatalogPreview,
  menu: OverlayCatalogPreview,
  'message-composer': MessageComposerCatalogPreview,
  modals: ModalCatalogPreview,
  popovers: PopoversCatalogPreview,
  rows: RowsCatalogPreview,
  'screen-states': ScreenStatesCatalogPreview,
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
