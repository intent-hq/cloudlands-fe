import type { UiComponentMetadata } from './component-metadata';

export const collapsiblePanelProductMetadata = {
  id: 'collapsible-panel',
  source: 'src/lib/components/ui/CollapsiblePanel.svelte',
  publicImport: '$lib/components/ui/CollapsiblePanel.svelte',
  legacyImports: [],
  exports: ['default'],
  category: 'product',
  owner: 'design-system',
  callers: ['src/lib/components/ui/ScrollableSection.svelte'],
  replacement: '$lib/components/ui/accordion',
  characterizationTest: null,
  removalGate:
    'Move persisted collapse state to callers, then adopt Accordion and remove the wrapper.',
  dynamicImports: [],
  fixtures: [],
} satisfies UiComponentMetadata;
