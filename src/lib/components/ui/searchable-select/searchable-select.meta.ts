import { parseUiComponentMetadata } from '../component-metadata';
import { searchableSelectFixtures } from './searchable-select.fixtures';

export const searchableSelectMetadata = parseUiComponentMetadata({
  id: 'searchable-select',
  source: 'src/lib/components/ui/searchable-select/searchable-select.svelte',
  publicImport: '$lib/components/ui/searchable-select',
  legacyImports: [],
  exports: ['SearchableSelect'],
  category: 'deprecated-wrapper',
  owner: '007-B6',
  callers: [
    'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/FieldPreviewCell.svelte',
    'src/lib/component-catalog/renderers/PopoversCatalogPreview.svelte',
    'src/lib/components/ui/combobox/legacy-wrappers.test-harness.svelte',
  ],
  replacement: '$lib/components/ui/combobox',
  characterizationTest: 'src/lib/components/ui/combobox/legacy-wrappers.test.ts',
  removalGate: 'All static and dynamic callers migrate and replacement behavior tests pass.',
  dynamicImports: [],
  fixtures: searchableSelectFixtures,
});
