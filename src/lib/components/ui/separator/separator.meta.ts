import { parseUiComponentMetadata } from '../component-metadata';
import { separatorFixtures } from './separator.fixtures';

export const separatorMetadata = parseUiComponentMetadata({
  id: 'separator',
  source: 'src/lib/components/ui/separator/separator.svelte',
  publicImport: '$lib/components/ui/separator',
  legacyImports: ['$lib/components/ui/separator/index.js'],
  exports: ['Root', 'Separator', 'separatorFixtures', 'separatorMetadata'],
  category: 'primitive',
  owner: 'design-system',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/components/file-explorer/file-explorer-layout.svelte',
    'src/lib/components/ui/sidebar/sidebar-separator.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/separator/separator.test.ts',
  removalGate: 'Retain while exported and orientation, semantic, and fixture tests pass.',
  dynamicImports: [],
  fixtures: separatorFixtures,
});
