import type { UiComponentMetadata } from '../component-metadata';
import { checkboxFixtures } from './checkbox.fixtures';

export const checkboxMetadata = {
  id: 'checkbox',
  source: 'src/lib/components/ui/checkbox/index.ts',
  publicImport: '$lib/components/ui/checkbox',
  legacyImports: ['$lib/components/ui/checkbox/checkbox.svelte'],
  exports: ['Checkbox'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/ProposalCatalogPreview.svelte',
    'src/lib/components/chat/input/ContextPickerButton.svelte',
    'src/lib/components/chat/proposals/BulkProposalItems.svelte',
    'src/lib/components/layout/ConnectBackendModal.svelte',
    'src/lib/components/modals/TransferWorkspaceModal.svelte',
    'src/lib/components/settings/HardwareConsoleSettings.svelte',
    'src/lib/components/tiptap/TaskItemNodeView.svelte',
    'src/lib/components/workspace/initializer/BranchSelector.svelte',
    'src/lib/components/workspace/initializer/RepoAndBranchPicker.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/checkbox/checkbox.test.ts',
  removalGate: 'Retain while exported; form and accessibility behavior tests must pass.',
  dynamicImports: [],
  fixtures: checkboxFixtures,
} satisfies UiComponentMetadata;
