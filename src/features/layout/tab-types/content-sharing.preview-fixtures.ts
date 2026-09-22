import type { AgentMessage, Note, Workspace } from '$shared/types';
import { AgentStatus, ContentType, NoteVisibility, WorkspaceStatus } from '$shared/types';
import { AgentId, NoteId, WorkspaceId } from '$shared/types/branded-ids';
import type { WireAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  loadWorkspaceNotesSucceeded,
  clearWorkspaceNotesForWorkspaces,
  setWorkspaceNotesLoading,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  chatInitialized,
  chatTranscriptSnapshotApplied,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { setNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { backgroundHooksUpdated } from '$store/renderer/slices/background-hooks/background-hooks-slice';
import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';

export type SharingState =
  | 'ready'
  | 'note-raw'
  | 'note-unsaved'
  | 'note-empty'
  | 'note-loading'
  | 'note-stale'
  | 'chat-empty'
  | 'chat-streaming'
  | 'clipboard-failure'
  | 'narrow';
export const SHARING_WORKSPACE_ID = WorkspaceId('preview-content-sharing');
export const SHARING_NOTE_ID = NoteId('preview-sharing-note');
export const SHARING_AGENT_ID = AgentId('preview-sharing-agent');
const timestamp = '2026-09-21T12:00:00.000Z';

export const sharingNote: Note = {
  id: SHARING_NOTE_ID,
  workspaceId: SHARING_WORKSPACE_ID,
  title: 'Launch checklist',
  content:
    '# Launch checklist\n\nA small, clearly fictional note for trying the sharing controls.\n\n- Copy this complete Markdown note.\n- Share an Intent link inside this workspace.\n- Download a portable `.md` file.\n\n**Decision:** keep the review focused and readable.',
  contentType: ContentType.Markdown,
  tags: [],
  isPinned: false,
  isArchived: false,
  visibility: NoteVisibility.Private,
  createdAt: timestamp,
  updatedAt: timestamp,
  rev: 1,
};

export const sharingMessages: AgentMessage[] = [
  {
    id: 'preview-user',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'Please summarize the launch checklist for the team.' }],
    timestamp,
  },
  {
    id: 'preview-assistant',
    role: 'assistant',
    contentBlocks: [
      {
        type: 'text',
        text: '## Ready to share\n\nThe note, chat, and images now offer consistent ways to copy and save.\n\n- **Copy** keeps the readable Markdown.\n- **Copy link** stays inside Intent.\n- **Download Markdown** exports only the conversation currently loaded here.',
      },
    ],
    timestamp: '2026-09-21T12:00:04.000Z',
  },
];

export function seedSharingPreview(state: SharingState): void {
  const workspace: Workspace = {
    id: SHARING_WORKSPACE_ID,
    title: 'Content sharing · fictional workspace',
    branch: 'preview-only',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    attention: 'none',
    activity: 'idle',
    repositoryPath: '/preview/content-sharing',
    worktreePath: '/preview/content-sharing',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  appStore.dispatch(setWorkspaceEntity(workspace));
  appStore.dispatch(
    setSubscriptionSnapshot(SHARING_WORKSPACE_ID, SHARING_AGENT_ID, {
      subscriptions: [],
      delegationGroups: [],
      agentStatuses: {},
      waitingState: 'idle',
    }),
  );
  appStore.dispatch(backgroundHooksUpdated(SHARING_WORKSPACE_ID, []));
  appStore.dispatch(prMonitorsUpdated(SHARING_WORKSPACE_ID, []));
  appStore.dispatch(clearWorkspaceNotesForWorkspaces([SHARING_WORKSPACE_ID]));
  const note =
    state === 'note-empty' || state === 'note-stale'
      ? { ...sharingNote, content: '', contentLength: state === 'note-stale' ? 400 : 0 }
      : sharingNote;
  appStore.dispatch(
    loadWorkspaceNotesSucceeded([SHARING_WORKSPACE_ID], {
      [SHARING_WORKSPACE_ID]: state === 'note-loading' ? [] : [note],
    }),
  );
  appStore.dispatch(setWorkspaceNotesLoading([SHARING_WORKSPACE_ID], state === 'note-loading'));
  appStore.dispatch(
    setNoteViewMode(
      SHARING_WORKSPACE_ID,
      SHARING_NOTE_ID,
      state === 'note-raw' || state === 'note-unsaved' ? 'raw' : 'editor',
    ),
  );
  const session: WireAgentSession = {
    id: SHARING_AGENT_ID,
    backendSessionId: null,
    workspaceId: SHARING_WORKSPACE_ID,
    name: 'Review helper',
    status: state === 'chat-streaming' ? AgentStatus.Active : AgentStatus.RuntimeIdle,
    isStreaming: state === 'chat-streaming',
    isResponding: state === 'chat-streaming',
    messages: state === 'chat-empty' ? [] : sharingMessages,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  appStore.dispatch(removeSession(SHARING_AGENT_ID));
  appStore.dispatch(bulkUpsertSessions([session]));
  appStore.dispatch(
    chatInitialized(SHARING_AGENT_ID, {
      isStreaming: state === 'chat-streaming',
      lastAttemptedMessage: null,
    }),
  );
  appStore.dispatch(transcriptHydrationSettled(SHARING_AGENT_ID));
  // ChatPanel marks itself viewed on mount. A current snapshot prevents that
  // production action from waiting forever for a subscription in UI-only mode.
  appStore.dispatch(
    chatTranscriptSnapshotApplied(SHARING_AGENT_ID, {
      truncated: false,
      totalMessages: session.messages.length,
      oldestMessageId: session.messages[0]?.id,
    }),
  );
}
