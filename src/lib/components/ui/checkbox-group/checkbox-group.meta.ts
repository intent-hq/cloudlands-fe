import type { UiComponentMetadata } from '../component-metadata';
import { checkboxGroupFixtures } from './checkbox-group.fixtures';

export const checkboxGroupMetadata = {
  id: 'checkbox-group',
  source: 'src/lib/components/ui/checkbox-group/index.ts',
  publicImport: '$lib/components/ui/checkbox-group',
  legacyImports: [],
  exports: ['CheckboxGroup', 'CheckboxGroupItem', 'Item', 'Root'],
  category: 'primitive',
  owner: '007-B2',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/checkbox-group/checkbox-group.test.ts',
  removalGate:
    'Retain while exported; multiple selection, form, and keyboard-roving tests must pass.',
  dynamicImports: [],
  fixtures: checkboxGroupFixtures,
} satisfies UiComponentMetadata;
