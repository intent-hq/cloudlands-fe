import type { ComponentProps } from 'svelte';
import { setupChatChangesPreview } from '../../../test/chat-changes-preview';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ChatChangesPanelHarness from './ChatChangesPanelHarness.svelte';
import type { LocalFileChange } from './types';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentStatus, type AgentSession, WorkspaceStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
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
  // Reads settle before the async diff worker paints; wait for measured content too.
  captureReadiness: {
    selector: '[data-preview-diffs-ready="true"]',
  },
  states: {
    'remote-offline': {
      props: {
        changes: changes.map((change, index) =>
          index === 0 ? { ...change, oldContent: undefined, newContent: undefined } : change,
        ),
        agentId: 'preview-remote-diff',
        isAggregate: true,
      },
      setup: () => {
        const stop = setupChatChangesPreview();
        appStore.dispatch(
          bulkUpsertSessions([
            {
              id: AgentId('preview-remote-diff'),
              backendSessionId: null,
              workspaceId: WorkspaceId('preview-chat-changes'),
              name: 'Remote builder',
              status: AgentStatus.Halted,
              messages: [],
              createdAt: '2026-09-28T08:00:00Z',
              updatedAt: '2026-09-28T08:00:00Z',
              placement: { target: 'remote', checkout: 'isolated' },
              nodeState: 'offline',
              checkpoint: {
                id: 'preview-checkpoint',
                assignmentEpoch: '1',
                captureRevision: '4',
                capturedAt: '2026-09-28T08:45:00Z',
                committedAt: '2026-09-28T08:45:01Z',
              },
            } satisfies AgentSession,
          ]),
        );
        return () => {
          stop();
          appStore.dispatch(removeSession('preview-remote-diff'));
        };
      },
    },
    'populated-linked': {
      props: {
        changes,
        commitInfo: {
          message: 'Align catalog surfaces',
          author: 'Preview author',
          hash: '1234567890abcdef1234567890abcdef12345678',
        },
      },
      setup: () => {
        const restoreRepository = setupCommitRepository();
        const stop = setupChatChangesPreview();
        return () => {
          stop();
          restoreRepository();
        };
      },
    },
    populated: {
      setup: setupChatChangesPreview,
      props: {
        changes,
        commitInfo: { message: 'Align catalog surfaces', author: 'Preview author' },
      },
    },
  },
});

export default ChatChangesPanelHarness;
