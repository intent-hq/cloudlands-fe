import type { UiComponentMetadata } from '../component-metadata';
import { radioGroupFixtures } from './radio-group.fixtures';

export const radioGroupMetadata = {
  id: 'radio-group',
  source: 'src/lib/components/ui/radio-group/index.ts',
  publicImport: '$lib/components/ui/radio-group',
  legacyImports: [],
  exports: ['Item', 'RadioGroup', 'RadioGroupItem', 'Root'],
  category: 'primitive',
  owner: '007-B2',
  callers: ['src/lib/component-catalog/renderers/FieldPreviewCell.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/radio-group/radio-group.test.ts',
  removalGate: 'Retain while exported; selection, form, and keyboard-roving tests must pass.',
  dynamicImports: [],
  fixtures: radioGroupFixtures,
} satisfies UiComponentMetadata;
