import { parseUiComponentMetadata } from '../component-metadata';
import { selectFixtures } from './select.fixtures';

export const selectMetadata = parseUiComponentMetadata({
  id: 'select',
  source: 'src/lib/components/ui/select/select.svelte',
  publicImport: '$lib/components/ui/select',
  legacyImports: [],
  exports: [
    'Select',
    'SelectContent',
    'SelectItem',
    'SelectRoot',
    'SelectTrigger',
    'SelectValue',
    'selectMetadata',
  ],
  category: 'primitive',
  owner: '007-B6',
  callers: [
    'src/lib/components/settings/LinearAuthConnection.svelte',
    'src/lib/components/workspace/initializer/BranchSelector.svelte',
    'src/lib/components/workspace/initializer/RemoteSetupSelector.svelte',
    'src/lib/components/workspace/initializer/RepoSelector.svelte',
    'src/routes/(app)/settings/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/select/select.test.ts',
  removalGate: 'Retain while exported and behavior, accessibility, and fixtures pass.',
  dynamicImports: [],
  fixtures: selectFixtures,
});
