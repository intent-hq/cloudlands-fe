import { parseUiComponentMetadata } from '../component-metadata';
import { copyInputFixtures } from './copy-input.fixtures';

export const copyInputMetadata = parseUiComponentMetadata({
  id: 'copy-input',
  source: 'src/lib/components/ui/copy-input/copy-input.svelte',
  publicImport: '$lib/components/ui/copy-input',
  legacyImports: [],
  exports: ['CopyInput', 'copyInputMetadata'],
  category: 'primitive',
  owner: 'design-system',
  callers: ['src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/copy-input/copy-input.test.ts',
  removalGate: 'Retain while value rendering, clipboard feedback, and size behavior tests pass.',
  dynamicImports: [],
  fixtures: copyInputFixtures,
});
