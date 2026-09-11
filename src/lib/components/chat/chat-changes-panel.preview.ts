import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ChatChangesPanelHarness from './ChatChangesPanelHarness.svelte';
import type { LocalFileChange } from './types';

const changes: LocalFileChange[] = [
  'packages/cloudlands-fe/src/sidebar.ts',
  'packages/cloudlands-fe/src/models.ts',
  'packages/intentd/src/catalog.rs',
].map((filePath, index) => ({
  filePath,
  action: 'modify',
  additions: 1,
  deletions: 1,
  toolName: 'edit_file',
  toolCallId: `preview-edit-${index}`,
  oldContent: 'const spacing = 4;\n',
  newContent: 'const spacing = 8;\n',
}));

export const preview = definePreview<ComponentProps<typeof ChatChangesPanelHarness>>({
  id: 'chat-changes-panel',
  title: 'Chat changes panel',
  defaultState: 'populated',
  states: {
    populated: {
      props: {
        changes,
        commitInfo: { message: 'Align catalog surfaces', author: 'Preview author' },
      },
    },
  },
});

export default ChatChangesPanelHarness;
