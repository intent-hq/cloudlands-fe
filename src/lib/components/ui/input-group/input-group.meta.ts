import { parseUiComponentMetadata } from '../component-metadata';
import { inputGroupFixtures } from './input-group.fixtures';

export const inputGroupMetadata = parseUiComponentMetadata({
  id: 'input-group',
  source: 'src/lib/components/ui/input-group/input-group.svelte',
  publicImport: '$lib/components/ui/input-group',
  legacyImports: [],
  exports: ['InputGroup', 'inputGroupMetadata'],
  category: 'primitive',
  owner: 'design-system',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/FieldPreviewCell.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/input-group/input-group.test.ts',
  removalGate: 'Retain while grouped focus, addon, validation, and size behavior tests pass.',
  dynamicImports: [],
  fixtures: inputGroupFixtures,
});
