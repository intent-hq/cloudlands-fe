import { parseUiComponentMetadata } from '../component-metadata';
import { textareaFixtures } from './textarea.fixtures';

export const textareaMetadata = parseUiComponentMetadata({
  id: 'textarea',
  source: 'src/lib/components/ui/textarea/textarea.svelte',
  publicImport: '$lib/components/ui/textarea',
  legacyImports: ['$lib/components/ui/textarea/textarea.svelte'],
  exports: ['Root', 'Textarea', 'textareaFixtures', 'textareaMetadata'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/components/chat/proposals/ProposalCard.svelte',
    'src/lib/components/file-tracking/accept-changes/ChangeTimeline.svelte',
    'src/lib/components/settings/AgentRulesEditor.svelte',
    'src/lib/components/settings/AutoSaveTextarea.svelte',
    'src/lib/components/workspace/PullRequestCreator.svelte',
    'src/lib/components/workspace/sidebar/CommitDrawer.svelte',
    'src/lib/components/workspace/sidebar/MergePanel.svelte',
    'src/lib/components/workspace/sidebar/PRSection.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/textarea/textarea.test.ts',
  removalGate: 'Retain while exported and binding, resize, validation, and fixture tests pass.',
  dynamicImports: [],
  fixtures: textareaFixtures,
});
