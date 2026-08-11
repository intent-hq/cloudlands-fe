import { parseUiComponentMetadata } from '../component-metadata';
import { fileInputFixtures } from './file-input.fixtures';

export const fileInputMetadata = parseUiComponentMetadata({
  id: 'file-input',
  source: 'src/lib/components/ui/file-input/file-input.svelte',
  publicImport: '$lib/components/ui/file-input',
  legacyImports: [],
  exports: ['FileInput', 'Root', 'fileInputFixtures', 'fileInputMetadata'],
  category: 'primitive',
  owner: '008-B',
  callers: ['src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/file-input/file-input.test.ts',
  removalGate: 'Retain while exported and file activation, feedback, and fixture tests pass.',
  dynamicImports: [],
  fixtures: fileInputFixtures,
});
