import { parseUiComponentMetadata } from '../component-metadata';
import { scrollAreaFixtures } from './scroll-area.fixtures';

export const scrollAreaMetadata = parseUiComponentMetadata({
  id: 'scroll-area',
  source: 'src/lib/components/ui/scroll-area/index.ts',
  publicImport: '$lib/components/ui/scroll-area',
  legacyImports: [],
  exports: ['Root', 'ScrollArea', 'ScrollAreaScrollbar', 'Scrollbar', 'scrollAreaMetadata'],
  category: 'primitive',
  owner: '012-F2',
  callers: [
    'src/lib/component-catalog/renderers/NavigationHelpCatalogPreview.svelte',
    'src/lib/components/file-explorer/file-explorer-sidebar.svelte',
    'src/lib/components/file-explorer/file-tree-view.svelte',
    'src/lib/components/ui/ScrollableSection.svelte',
    'src/lib/components/ui/VSCodeScrollablePanel.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/scroll-area/scroll-area.test.ts',
  removalGate: 'Retain while viewport focus, orientation, long-content, and overflow tests pass.',
  dynamicImports: [],
  fixtures: scrollAreaFixtures,
});
