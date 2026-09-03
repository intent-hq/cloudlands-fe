import type { UiComponentMetadata } from '../component-metadata';
import { switchFixtures } from './switch.fixtures';

export const switchMetadata = {
  id: 'switch',
  source: 'src/lib/components/ui/switch/index.ts',
  publicImport: '$lib/components/ui/switch',
  legacyImports: [],
  exports: ['Switch'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/CatalogControls.svelte',
    'src/lib/component-catalog/ChatPolishGeometryControls.svelte',
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/switch/switch.test.ts',
  removalGate:
    'Retain for catalog characterization only; product binary controls use Toggle and product callers remain zero.',
  dynamicImports: [],
  fixtures: switchFixtures,
} satisfies UiComponentMetadata;
