import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ChatChangesPanelHarness from './ChatChangesPanelHarness.svelte';
import type { LocalFileChange } from './types';
import { store as appStore } from '$store/renderer/store';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';

function setupCommitRepository() {
  const id = WorkspaceId('preview-chat-changes');
  const previous = selectWorkspaceById.select(appStore.state, id);
  appStore.dispatch(
    setWorkspaceEntity({
      id,
      title: 'Changes preview',
      branch: 'preview',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      repositoryOwner: 'intent-hq',
      repositoryName: 'cloudlands-fe',
    }),
  );
  return () =>
    appStore.dispatch(previous ? setWorkspaceEntity(previous) : removeWorkspaceEntity(id));
}

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
    'populated-linked': {
      props: {
        changes,
        commitInfo: {
          message: 'Align catalog surfaces',
          author: 'Preview author',
          hash: '1234567890abcdef1234567890abcdef12345678',
        },
      },
      setup: setupCommitRepository,
    },
    populated: {
      props: {
        changes,
        commitInfo: { message: 'Align catalog surfaces', author: 'Preview author' },
      },
    },
  },
});

export default ChatChangesPanelHarness;
