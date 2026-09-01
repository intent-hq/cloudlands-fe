import type { UiComponentMetadata } from '../component-metadata';
import { checkboxFixtures } from './checkbox.fixtures';

export const checkboxMetadata = {
  id: 'checkbox',
  source: 'src/lib/components/ui/checkbox/index.ts',
  publicImport: '$lib/components/ui/checkbox',
  legacyImports: [],
  exports: ['Checkbox'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/ProposalCatalogPreview.svelte',
    'src/lib/components/tiptap/TaskItemNodeView.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/checkbox/checkbox.test.ts',
  removalGate:
    'Retain for catalog characterization and the documented TipTap task-checkbox exception; product binary controls use Toggle.',
  dynamicImports: [],
  fixtures: checkboxFixtures,
} satisfies UiComponentMetadata;
