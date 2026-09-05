import { parseUiComponentMetadata } from '../component-metadata';
import { kbdFixtures } from './kbd.fixtures';

export const kbdMetadata = parseUiComponentMetadata({
  id: 'kbd',
  source: 'src/lib/components/ui/kbd/index.ts',
  publicImport: '$lib/components/ui/kbd',
  legacyImports: [],
  exports: ['ShortcutChip'],
  category: 'primitive',
  owner: 'design-system',
  callers: [
    'src/lib/component-catalog/renderers/NavigationHelpCatalogPreview.svelte',
    'src/lib/components/ui/tooltip/TooltipShortcut.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/kbd/kbd.test.ts',
  removalGate: 'Retain while semantic keyboard hint rendering and catalog fixtures pass.',
  dynamicImports: [],
  fixtures: kbdFixtures,
});
