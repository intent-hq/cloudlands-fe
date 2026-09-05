import { parseUiComponentMetadata } from '../component-metadata';
import { groupedComboboxFixtures } from './grouped-combobox.fixtures';

export const groupedComboboxMetadata = parseUiComponentMetadata({
  id: 'grouped-combobox',
  source: 'src/lib/components/ui/grouped-combobox/grouped-combobox.svelte',
  publicImport: '$lib/components/ui/grouped-combobox',
  legacyImports: [],
  exports: ['GroupedCombobox', 'GroupedOption', 'OptionGroup'],
  category: 'deprecated-wrapper',
  owner: '007-B6',
  callers: [
    'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    'src/lib/components/ui/combobox/legacy-wrappers.test-harness.svelte',
  ],
  replacement: '$lib/components/ui/combobox',
  characterizationTest: 'src/lib/components/ui/combobox/legacy-wrappers.test.ts',
  removalGate: 'All static and dynamic callers migrate and replacement behavior tests pass.',
  dynamicImports: [],
  fixtures: groupedComboboxFixtures,
});
