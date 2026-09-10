import { parseUiComponentMetadata } from '../component-metadata';
import { inputMessageFixtures } from './input-message.fixtures';

export const inputMessageMetadata = parseUiComponentMetadata({
  id: 'input-message',
  source: 'src/lib/components/ui/input-message/input-message.svelte',
  publicImport: '$lib/components/ui/input-message',
  legacyImports: [],
  exports: ['InputMessage', 'inputMessageMetadata'],
  category: 'pattern',
  owner: 'design-system',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/FieldPreviewCell.svelte',
    'src/lib/component-catalog/renderers/ScreenStatesCatalogPreview.svelte',
    'src/lib/components/ui/file-input/file-input.svelte',
    'src/lib/components/ui/input-group/input-group.svelte',
    'src/lib/components/ui/input/input.svelte',
    'src/lib/components/ui/textarea/textarea.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/input-message/input-message.test.ts',
  removalGate: 'Retain while helper and error semantics use fast-tier motion.',
  dynamicImports: [],
  fixtures: inputMessageFixtures,
});
