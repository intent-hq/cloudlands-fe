import type { UiComponentMetadata } from '../component-metadata';

export const smartCornerTabsProductMetadata = {
  id: 'smart-corner-tabs',
  source: 'src/lib/components/ui/smart-corner-tabs/SmartCornerTabs.svelte',
  publicImport: '$lib/components/ui/smart-corner-tabs/SmartCornerTabs.svelte',
  legacyImports: [],
  exports: ['default', 'SmartCornerTab'],
  category: 'product',
  owner: 'design-system',
  callers: ['src/routes/(app)/test-smart-corner-tabs/+page.svelte'],
  replacement: '$lib/components/ui/tabs',
  characterizationTest: 'src/lib/components/ui/smart-corner-tabs/SmartCornerTabs.test.ts',
  removalGate: 'Move the merged panel geometry to its owning surface after it adopts Tabs.',
  dynamicImports: [],
  fixtures: [],
} satisfies UiComponentMetadata;
