import { parseUiComponentMetadata } from '../component-metadata';
import { comboboxFixtures } from './combobox.fixtures';

export const comboboxMetadata = parseUiComponentMetadata({
  id: 'combobox',
  source: 'src/lib/components/ui/combobox/combobox.svelte',
  publicImport: '$lib/components/ui/combobox',
  legacyImports: [],
  exports: ['Combobox', 'ComboboxGroup', 'ComboboxOption', 'default'],
  category: 'pattern',
  owner: '007-B6',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/combobox/combobox.test.ts',
  removalGate: 'Retain while callers need the pattern and catalog coverage remains current.',
  dynamicImports: [],
  fixtures: comboboxFixtures,
});
