import { parseUiComponentMetadata } from '../component-metadata';
import { buttonGroupFixtures } from './button-group.fixtures';

export const buttonGroupMetadata = parseUiComponentMetadata({
  id: 'button-group',
  source: 'src/lib/components/ui/button-group/button-group.svelte',
  publicImport: '$lib/components/ui/button-group',
  legacyImports: [],
  exports: ['ButtonGroup'],
  category: 'primitive',
  owner: '007-B1',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/button-group/button-group.test.ts',
  removalGate: 'Retain while exported and group semantics and fixtures pass.',
  dynamicImports: [],
  fixtures: buttonGroupFixtures,
});
