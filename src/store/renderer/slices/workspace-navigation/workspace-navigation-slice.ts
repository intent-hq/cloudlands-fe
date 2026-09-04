import type { ReviewStatus } from '$lib/components/code-review/types';
import type { WorkspaceEvent } from '$features/events/types';
import type { TrackedChange } from '$features/file-tracking/types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { m } from '$shared/paraglide/messages.js';

const STORAGE_VERSION = 2;
const DEFAULT_NOTE_ID = 'spec';
const MAX_NAVIGATION_HISTORY = 50;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type WorkspaceNavigationDrawerType = 'agent' | 'terminal' | 'overview' | null;
type WorkspaceNavigationHistoryType =
  | 'note'
  | 'file'
  | 'diff'
  | 'accept-changes'
  | 'chat-changes'
  | 'dashboard'
  | 'change-set'
  | 'agent-turn-changes'
  | 'activity-changes'
  | 'local-changes'
  | 'browser'
  | 'activity'
  | 'staged'
  | 'unstaged'
  | 'commit'
  | 'agent-aggregate-changes'
  | 'commit-changeset'
  | 'code-review';

export type WorkspaceNavigationMainPanelType =
  | 'empty'
  | 'notes'
  | 'file'
  | 'file-tracking-diff'
  | 'accept-changes'
  | 'chat-changes'
  | 'dashboard'
  | 'change-set'
  | 'agent-turn-changes'
  | 'activity-changes'
  | 'local-changes'
  | 'browser'
  | 'activity'
  | 'staged'
  | 'unstaged'
  | 'commit'
  | 'agent-aggregate-changes'
  | 'commit-changeset'
  | 'code-review';

type WorkspaceNavigationAgentTurn = {
  agentId: string;
  sessionId?: string;
  turnNumber?: number;
};

type WorkspaceNavigationCommit = {
  hash: string;
  message?: string;
};

interface WorkspaceNavigationHistoryEntry {
  type: WorkspaceNavigationHistoryType;
  id?: string;
  label?: string;
  timestamp?: number;
  scrollPosition?: number;
  filePath?: string;
  trackedChange?: TrackedChange;
  branchBaseRef?: string;
  branchBaseCommitSha?: string;
  selectedCommit?: WorkspaceNavigationCommit;
  agentTurnData?: WorkspaceNavigationAgentTurn;
  activityEventData?: WorkspaceEvent;
  chatChanges?: JsonValue[];
  chatChangesTitle?: string;
  chatChangesMessageId?: string;
  chatChangesAgentId?: string;
  chatChangesTurnNumber?: number;
  chatChangesIsAggregate?: boolean;
  commitHash?: string;
  commitMessage?: string;
  /** Secondary git root scoping the commit changeset (multi git root tracking, v6.15). */
  gitRootId?: string;
  result?: string | null;
  agentId?: string | null;
  stagedFiles?: string[];
  status?: ReviewStatus;
  streamingText?: string;
  error?: string;
}

export interface WorkspaceNavigationMainPanelState {
  type: WorkspaceNavigationMainPanelType;
  selectedFile?: string;
  selectedNoteId?: string;
  selectedChangeId?: string;
  selectedBrowserUrl?: string;
  selectedTrackedChange?: TrackedChange;
  selectedActivityEvent?: WorkspaceEvent;
  selectedAgentTurn?: WorkspaceNavigationAgentTurn;
  selectedCommit?: WorkspaceNavigationCommit;
  chatChanges?: JsonValue[];
  chatChangesTitle?: string;
  chatChangesMessageId?: string;
  chatChangesAgentId?: string;
  chatChangesTurnNumber?: number;
  chatChangesIsAggregate?: boolean;
  scrollToLine?: number;
  commitHash?: string;
  commitMessage?: string;
  /** Secondary git root scoping the commit changeset (multi git root tracking, v6.15). */
  gitRootId?: string;
  branchBaseRef?: string;
  branchBaseCommitSha?: string;
  result?: string | null;
  agentId?: string | null;
  stagedFiles?: string[];
  status?: ReviewStatus;
  streamingText?: string;
  error?: string;
}

interface WorkspaceNavigationDrawerState {
  open: boolean;
  type: WorkspaceNavigationDrawerType;
  itemId: string | null;
}

export interface WorkspaceNavigationNavigationState {
  history: WorkspaceNavigationHistoryEntry[];
  currentIndex: number;
}

interface WorkspaceNavigationUIState {
  hasInitialized: boolean;
  jumpToLine?: number;
}

export interface WorkspaceNavigationWorkspaceState {
  version: number;
  workspace: {
    id: string;
  };
  mainPanel: WorkspaceNavigationMainPanelState;
  drawer: WorkspaceNavigationDrawerState;
  navigation: WorkspaceNavigationNavigationState;
  ui: WorkspaceNavigationUIState;
}

export interface WorkspaceNavigationState {
  byWorkspaceId: Record<string, WorkspaceNavigationWorkspaceState>;
}

const emptyWorkspaceNavigationState: WorkspaceNavigationWorkspaceState = {
  version: STORAGE_VERSION,
  workspace: {
    id: '',
  },
  mainPanel: {
    type: 'notes',
    selectedNoteId: DEFAULT_NOTE_ID,
  },
  drawer: {
    open: false,
    type: null,
    itemId: null,
  },
  navigation: {
    history: [],
    currentIndex: -1,
  },
  ui: {
    hasInitialized: false,
  },
};

const initialState: WorkspaceNavigationState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceNavigationState,
);

export function createWorkspaceNavigationState(
  wsId: string,
  overrides?: Partial<WorkspaceNavigationWorkspaceState>,
): WorkspaceNavigationWorkspaceState {
  return {
    version: STORAGE_VERSION,
    workspace: {
      id: wsId,
    },
    mainPanel: {
      ...emptyWorkspaceNavigationState.mainPanel,
      ...overrides?.mainPanel,
    },
    drawer: {
      ...emptyWorkspaceNavigationState.drawer,
      ...overrides?.drawer,
    },
    navigation: {
      history: overrides?.navigation?.history ?? [
        ...emptyWorkspaceNavigationState.navigation.history,
      ],
      currentIndex:
        overrides?.navigation?.currentIndex ??
        emptyWorkspaceNavigationState.navigation.currentIndex,
    },
    ui: {
      ...emptyWorkspaceNavigationState.ui,
      ...overrides?.ui,
    },
  };
}

function ensureWorkspaceNavigationState(
  state: WorkspaceNavigationState,
  wsId: string,
): WorkspaceNavigationWorkspaceState {
  const workspaceState = getWorkspaceState(state, wsId);
  return workspaceState.workspace.id === wsId
    ? workspaceState
    : createWorkspaceNavigationState(wsId, workspaceState);
}

function withWorkspaceNavigationState(
  state: WorkspaceNavigationState,
  wsId: string,
  updater: (workspaceState: WorkspaceNavigationWorkspaceState) => WorkspaceNavigationWorkspaceState,
): WorkspaceNavigationState {
  return setWorkspaceState(state, wsId, updater(ensureWorkspaceNavigationState(state, wsId)));
}

function mergeWorkspaceNavigationState(
  workspaceState: WorkspaceNavigationWorkspaceState,
  overrides: Partial<WorkspaceNavigationWorkspaceState>,
): WorkspaceNavigationWorkspaceState {
  return {
    ...workspaceState,
    ...overrides,
    ui: {
      ...workspaceState.ui,
      ...overrides.ui,
    },
  };
}

function createMainPanelState(
  type: WorkspaceNavigationMainPanelType,
  selection: Partial<WorkspaceNavigationMainPanelState> = {},
): WorkspaceNavigationMainPanelState {
  return {
    ...(type === 'notes' ? { selectedNoteId: DEFAULT_NOTE_ID } : {}),
    type,
    ...selection,
  };
}

function truncateLabel(label: string, maxLength = 50): string {
  return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
}

function pushHistoryEntry(
  workspaceState: WorkspaceNavigationWorkspaceState,
  entry: WorkspaceNavigationHistoryEntry,
): WorkspaceNavigationWorkspaceState {
  const currentEntry =
    workspaceState.navigation.history[workspaceState.navigation.currentIndex] ?? undefined;

  if (currentEntry?.type === entry.type && currentEntry?.id === entry.id) {
    return workspaceState;
  }

  let history = workspaceState.navigation.history;
  if (workspaceState.navigation.currentIndex < history.length - 1) {
    history = history.slice(0, workspaceState.navigation.currentIndex + 1);
  }

  history = [...history, entry];
  let currentIndex = history.length - 1;

  if (history.length > MAX_NAVIGATION_HISTORY) {
    const toRemove = history.length - MAX_NAVIGATION_HISTORY;
    history = history.slice(toRemove);
    currentIndex = Math.max(0, currentIndex - toRemove);
  }

  return mergeWorkspaceNavigationState(workspaceState, {
    navigation: {
      history,
      currentIndex,
    },
  });
}

function updateCurrentHistoryEntry(
  workspaceState: WorkspaceNavigationWorkspaceState,
  updater: (entry: WorkspaceNavigationHistoryEntry) => WorkspaceNavigationHistoryEntry,
): WorkspaceNavigationWorkspaceState {
  const currentIndex = workspaceState.navigation.currentIndex;
  if (currentIndex < 0 || currentIndex >= workspaceState.navigation.history.length) {
    return workspaceState;
  }

  const history = [...workspaceState.navigation.history];
  const currentEntry = history[currentIndex];
  if (!currentEntry) {
    return workspaceState;
  }
  history[currentIndex] = updater(currentEntry);
  return mergeWorkspaceNavigationState(workspaceState, {
    navigation: {
      ...workspaceState.navigation,
      history,
    },
  });
}

export const hydrateWorkspaceNavigation = createAction<
  [wsId: string, workspaceState: WorkspaceNavigationWorkspaceState]
>('workspaceNavigation/hydrateWorkspaceNavigation');

export const markWorkspaceNavigationInitialized = createAction<[wsId: string]>(
  'workspaceNavigation/markWorkspaceNavigationInitialized',
);

export const setWorkspaceMainPanel = createAction<
  [
    wsId: string,
    type: WorkspaceNavigationMainPanelType,
    selection?: Partial<WorkspaceNavigationMainPanelState>,
  ]
>('workspaceNavigation/setWorkspaceMainPanel');

export const openWorkspaceFile = createAction<
  [
    wsId: string,
    filePath: string,
    options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
  ]
>('workspaceNavigation/openWorkspaceFile');

export const openWorkspaceNote = createAction<
  [
    wsId: string,
    noteId: string,
    options?: {
      openInAdjacentPanel?: boolean;
      /** Force a fresh adjacent column even when an equivalent tab is already open elsewhere. */
      openInNewAdjacentPanel?: boolean;
      sourcePanelId?: string;
    },
  ]
>('workspaceNavigation/openWorkspaceNote');

/**
 * Resolve an attachment-registry row by UUID (`file.getAttachmentInfo`,
 * PROTOCOL §5.9) and open its stored workspace-relative path in a file tab.
 * The lookup runs in the workspace-navigation tab saga; a missing file or a
 * failed lookup surfaces a toast (`fileName` labels the failure toast).
 */
export const openWorkspaceAttachment = createAction<
  [wsId: string, attachmentId: string, fileName: string]
>('workspaceNavigation/openWorkspaceAttachment');

export const openWorkspaceBrowser = createAction<[wsId: string, url: string]>(
  'workspaceNavigation/openWorkspaceBrowser',
);

export const openWorkspaceAcceptChanges = createAction<[wsId: string]>(
  'workspaceNavigation/openWorkspaceAcceptChanges',
);

export const openWorkspaceDiff = createAction<
  [
    wsId: string,
    change: TrackedChange,
    options?: {
      changeId?: string;
      filePath?: string;
      scrollToLine?: number;
      forceUpdate?: boolean;
      openInAdjacentPanel?: boolean;
      sourcePanelId?: string;
      branchBaseRef?: string;
      branchBaseCommitSha?: string;
      gitRootId?: string;
      gitRootPath?: string;
    },
  ]
>('workspaceNavigation/openWorkspaceDiff');

const openWorkspaceChangeSet = createAction<[wsId: string]>(
  'workspaceNavigation/openWorkspaceChangeSet',
);

const openWorkspaceAgentTurnChanges = createAction<
  [wsId: string, turn: WorkspaceNavigationAgentTurn, aggregate?: boolean]
>('workspaceNavigation/openWorkspaceAgentTurnChanges');

export const openWorkspaceActivityChanges = createAction<[wsId: string, event: WorkspaceEvent]>(
  'workspaceNavigation/openWorkspaceActivityChanges',
);

export const openWorkspaceChatChanges = createAction<
  [
    wsId: string,
    changes: JsonValue[],
    title: string,
    options?: {
      messageId?: string;
      isAggregate?: boolean;
      agentId?: string;
      scopeId?: string;
      turnNumber?: number;
      sourcePanelId?: string;
    },
  ]
>('workspaceNavigation/openWorkspaceChatChanges');

/** Stable dedup id for message, agent, note, or workspace aggregate change summaries. */
export function chatChangesDedupId(options?: {
  messageId?: string;
  agentId?: string;
  scopeId?: string;
}): string {
  if (options?.messageId) return options.messageId;
  if (options?.agentId) return `aggregate:${options.agentId}`;
  if (options?.scopeId) return `aggregate:note:${options.scopeId}`;
  return 'aggregate';
}

export const openWorkspaceLocalChanges = createAction<
  [wsId: string, options?: { gitRootId?: string }]
>('workspaceNavigation/openWorkspaceLocalChanges');

export const openWorkspaceCommitChangeset = createAction<
  [
    wsId: string,
    commitHash?: string,
    commitMessage?: string,
    options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string; gitRootId?: string },
  ]
>('workspaceNavigation/openWorkspaceCommitChangeset');

export const openWorkspaceCodeReview = createAction<
  [
    wsId: string,
    review: {
      result?: string | null;
      agentId?: string | null;
      stagedFiles?: string[];
      status?: ReviewStatus;
      streamingText?: string;
      error?: string;
    },
  ]
>('workspaceNavigation/openWorkspaceCodeReview');

export const updateWorkspaceCodeReview = createAction<
  [
    wsId: string,
    update: {
      result?: string | null;
      agentId?: string | null;
      stagedFiles?: string[];
      status?: ReviewStatus;
      streamingText?: string;
      error?: string;
    },
  ]
>('workspaceNavigation/updateWorkspaceCodeReview');

export const openWorkspaceDrawer = createAction<
  [wsId: string, type: Exclude<WorkspaceNavigationDrawerType, null>, itemId?: string | null]
>('workspaceNavigation/openWorkspaceDrawer');

export const closeWorkspaceDrawer = createAction<[wsId: string]>(
  'workspaceNavigation/closeWorkspaceDrawer',
);

export const workspaceNavigationReducer = createReducer(initialState);
workspaceNavigationReducer.with(
  hydrateWorkspaceNavigation,
  (state, { payload: [wsId, workspaceState] }) =>
    setWorkspaceState(state, wsId, {
      ...workspaceState,
      version: STORAGE_VERSION,
      workspace: {
        id: wsId,
      },
    }),
);
workspaceNavigationReducer.with(markWorkspaceNavigationInitialized, (state, { payload: [wsId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) => {
    if (workspaceState.ui.hasInitialized) return workspaceState;

    let nextState = mergeWorkspaceNavigationState(workspaceState, {
      ui: {
        ...workspaceState.ui,
        hasInitialized: true,
      },
    });

    if (nextState.navigation.history.length === 0 && nextState.navigation.currentIndex === -1) {
      switch (nextState.mainPanel.type) {
        case 'notes':
          if (nextState.mainPanel.selectedNoteId) {
            nextState = pushHistoryEntry(nextState, {
              type: 'note',
              id: nextState.mainPanel.selectedNoteId,
              label: 'Note',
            });
          }
          break;
        case 'file':
          if (nextState.mainPanel.selectedFile) {
            nextState = pushHistoryEntry(nextState, {
              type: 'file',
              id: nextState.mainPanel.selectedFile,
              label: nextState.mainPanel.selectedFile.split('/').pop() || 'File',
            });
          }
          break;
        case 'dashboard':
          nextState = pushHistoryEntry(nextState, {
            type: 'dashboard',
            id: 'dashboard',
            label: 'Dashboard',
          });
          break;
      }
    }

    return nextState;
  }),
);
workspaceNavigationReducer.with(
  setWorkspaceMainPanel,
  (state, { payload: [wsId, type, selection] }) =>
    withWorkspaceNavigationState(state, wsId, (workspaceState) => {
      let nextState = mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState(type, selection),
      });

      switch (type) {
        case 'activity':
          nextState = pushHistoryEntry(nextState, {
            type: 'activity',
            id: 'activity',
            label: m.workspace_nav_activityLog_label(),
          });
          break;
        case 'dashboard':
          nextState = pushHistoryEntry(nextState, {
            type: 'dashboard',
            id: 'dashboard',
            label: m.workspace_nav_dashboard_label(),
          });
          break;
        case 'staged':
          nextState = pushHistoryEntry(nextState, {
            type: 'staged',
            id: 'staged',
            label: m.workspace_nav_staged_label(),
          });
          break;
        case 'unstaged':
          nextState = pushHistoryEntry(nextState, {
            type: 'unstaged',
            id: 'unstaged',
            label: m.workspace_nav_unstaged_label(),
          });
          break;
        case 'commit':
          if (selection?.selectedCommit?.hash) {
            nextState = pushHistoryEntry(nextState, {
              type: 'commit',
              id: selection.selectedCommit.hash,
              label: selection.selectedCommit.message?.slice(0, 50) || 'Commit',
              selectedCommit: selection.selectedCommit,
            });
          }
          break;
        case 'agent-aggregate-changes':
          if (selection?.selectedAgentTurn) {
            nextState = pushHistoryEntry(nextState, {
              type: 'agent-aggregate-changes',
              id: `${selection.selectedAgentTurn.agentId}:aggregate`,
              label: m.workspace_nav_aggregate_label(),
              agentTurnData: selection.selectedAgentTurn,
            });
          }
          break;
      }

      return nextState;
    }),
);
workspaceNavigationReducer.with(
  openWorkspaceFile,
  (state, { payload: [wsId, filePath, options] }) =>
    withWorkspaceNavigationState(state, wsId, (workspaceState) =>
      pushHistoryEntry(
        mergeWorkspaceNavigationState(workspaceState, {
          mainPanel: createMainPanelState('file', { selectedFile: filePath }),
          ui: {
            ...workspaceState.ui,
            jumpToLine: options?.line,
          },
        }),
        {
          type: 'file',
          id: filePath,
          label: filePath.split('/').pop() || 'File',
        },
      ),
    ),
);
workspaceNavigationReducer.with(openWorkspaceNote, (state, { payload: [wsId, noteId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) => {
    if (
      workspaceState.mainPanel.type === 'notes' &&
      workspaceState.mainPanel.selectedNoteId === noteId
    ) {
      return workspaceState;
    }

    return pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('notes', { selectedNoteId: noteId }),
      }),
      {
        type: 'note',
        id: noteId,
        label: 'Note',
      },
    );
  }),
);
workspaceNavigationReducer.with(openWorkspaceBrowser, (state, { payload: [wsId, url] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('browser', { selectedBrowserUrl: url }),
      }),
      {
        type: 'browser',
        id: url,
        label: 'Browser',
      },
    ),
  ),
);
workspaceNavigationReducer.with(openWorkspaceAcceptChanges, (state, { payload: [wsId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('accept-changes'),
      }),
      {
        type: 'accept-changes',
        id: 'accept-changes',
        label: m.workspace_nav_acceptChanges_label(),
      },
    ),
  ),
);
workspaceNavigationReducer.with(openWorkspaceDiff, (state, { payload: [wsId, change, options] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) => {
    const filePath = options?.filePath || change.file || change.relativePath;
    const isSameFileAndStage =
      workspaceState.mainPanel.type === 'file-tracking-diff' &&
      workspaceState.mainPanel.selectedFile === filePath &&
      workspaceState.mainPanel.selectedTrackedChange?.stage === change.stage;

    if (isSameFileAndStage && !options?.scrollToLine && !options?.forceUpdate) {
      return mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('accept-changes'),
      });
    }

    return pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('file-tracking-diff', {
          selectedTrackedChange: change,
          selectedFile: filePath,
          selectedChangeId: options?.changeId || change.id,
          scrollToLine: options?.scrollToLine,
          branchBaseRef: options?.branchBaseRef,
          branchBaseCommitSha: options?.branchBaseCommitSha,
        }),
      }),
      {
        type: 'diff',
        id: options?.changeId || change.id,
        label: filePath?.split('/').pop() || 'Diff',
        trackedChange: change,
        filePath,
        branchBaseRef: options?.branchBaseRef,
        branchBaseCommitSha: options?.branchBaseCommitSha,
      },
    );
  }),
);
workspaceNavigationReducer.with(openWorkspaceChangeSet, (state, { payload: [wsId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('change-set'),
      }),
      {
        type: 'change-set',
        id: 'commit',
        label: m.workspace_nav_commitChanges_label(),
      },
    ),
  ),
);
workspaceNavigationReducer.with(
  openWorkspaceAgentTurnChanges,
  (state, { payload: [wsId, turn, aggregate] }) =>
    withWorkspaceNavigationState(state, wsId, (workspaceState) => {
      const historyType = aggregate ? 'agent-aggregate-changes' : 'agent-turn-changes';
      const historyId = aggregate
        ? `${turn.agentId}:aggregate`
        : `${turn.agentId}:${typeof turn.turnNumber === 'number' ? turn.turnNumber : ''}`;

      return pushHistoryEntry(
        mergeWorkspaceNavigationState(workspaceState, {
          mainPanel: createMainPanelState(
            aggregate ? 'agent-aggregate-changes' : 'agent-turn-changes',
            { selectedAgentTurn: turn },
          ),
        }),
        {
          type: historyType,
          id: historyId,
          label: aggregate ? m.workspace_nav_aggregate_label() : m.workspace_nav_agentTurn_label(),
          agentTurnData: turn,
        },
      );
    }),
);
workspaceNavigationReducer.with(openWorkspaceActivityChanges, (state, { payload: [wsId, event] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) => {
    const eventId =
      'id' in event && typeof event.id === 'string' ? event.id : `${event.type}:${event.timestamp}`;

    return pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('activity-changes', {
          selectedActivityEvent: event,
        }),
      }),
      {
        type: 'activity-changes',
        id: eventId,
        label: m.workspace_nav_activityChanges_label(),
        activityEventData: event,
      },
    );
  }),
);
workspaceNavigationReducer.with(
  openWorkspaceChatChanges,
  (state, { payload: [wsId, changes, title, options] }) =>
    withWorkspaceNavigationState(state, wsId, (workspaceState) =>
      pushHistoryEntry(
        mergeWorkspaceNavigationState(workspaceState, {
          mainPanel: createMainPanelState('chat-changes', {
            chatChanges: changes,
            chatChangesTitle: title,
            chatChangesMessageId: options?.messageId,
            chatChangesAgentId: options?.agentId,
            chatChangesTurnNumber: options?.turnNumber,
            chatChangesIsAggregate: options?.isAggregate,
          }),
        }),
        {
          type: 'chat-changes',
          id: chatChangesDedupId(options),
          label: title,
          chatChanges: changes,
          chatChangesTitle: title,
          chatChangesMessageId: options?.messageId,
          chatChangesAgentId: options?.agentId,
          chatChangesTurnNumber: options?.turnNumber,
          chatChangesIsAggregate: options?.isAggregate,
        },
      ),
    ),
);
workspaceNavigationReducer.with(openWorkspaceLocalChanges, (state, { payload: [wsId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('local-changes'),
      }),
      {
        type: 'local-changes',
        id: 'local',
        label: m.workspace_nav_localChanges_label(),
      },
    ),
  ),
);
workspaceNavigationReducer.with(
  openWorkspaceCommitChangeset,
  (state, { payload: [wsId, commitHash, commitMessage, options] }) =>
    withWorkspaceNavigationState(state, wsId, (workspaceState) => {
      const label = commitMessage
        ? `Commit: ${truncateLabel(commitMessage, 30)}`
        : `Commit ${commitHash?.slice(0, 7) || 'unknown'}`;

      return pushHistoryEntry(
        mergeWorkspaceNavigationState(workspaceState, {
          mainPanel: createMainPanelState('commit-changeset', {
            commitHash,
            commitMessage,
            ...(options?.gitRootId ? { gitRootId: options.gitRootId } : {}),
          }),
        }),
        {
          type: 'commit-changeset',
          id: commitHash || 'commit',
          label,
          commitHash,
          commitMessage,
          ...(options?.gitRootId ? { gitRootId: options.gitRootId } : {}),
        },
      );
    }),
);
workspaceNavigationReducer.with(openWorkspaceCodeReview, (state, { payload: [wsId, review] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    pushHistoryEntry(
      mergeWorkspaceNavigationState(workspaceState, {
        mainPanel: createMainPanelState('code-review', {
          result: review.result,
          agentId: review.agentId,
          stagedFiles: review.stagedFiles,
          status: review.status,
          streamingText: review.streamingText,
          error: review.error,
        }),
      }),
      {
        type: 'code-review',
        id: 'review',
        label: m.workspace_nav_codeReview_label(),
        result: review.result,
        agentId: review.agentId,
        stagedFiles: review.stagedFiles,
        status: review.status,
        streamingText: review.streamingText,
        error: review.error,
      },
    ),
  ),
);
workspaceNavigationReducer.with(updateWorkspaceCodeReview, (state, { payload: [wsId, update] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) => {
    if (workspaceState.mainPanel.type !== 'code-review') {
      return workspaceState;
    }

    let nextState = mergeWorkspaceNavigationState(workspaceState, {
      mainPanel: {
        ...workspaceState.mainPanel,
        result: update.result ?? workspaceState.mainPanel.result,
        agentId: update.agentId ?? workspaceState.mainPanel.agentId,
        stagedFiles: update.stagedFiles ?? workspaceState.mainPanel.stagedFiles,
        status: update.status ?? workspaceState.mainPanel.status,
        streamingText: update.streamingText ?? workspaceState.mainPanel.streamingText,
        error: update.error,
      },
    });

    nextState = updateCurrentHistoryEntry(nextState, (entry) => {
      if (entry.type !== 'code-review') return entry;
      return {
        ...entry,
        result: update.result ?? entry.result,
        agentId: update.agentId ?? entry.agentId,
        stagedFiles: update.stagedFiles ?? entry.stagedFiles,
        status: update.status ?? entry.status,
        streamingText: update.streamingText ?? entry.streamingText,
        error: update.error,
      };
    });

    return nextState;
  }),
);
workspaceNavigationReducer.with(openWorkspaceDrawer, (state, { payload: [wsId, type, itemId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    mergeWorkspaceNavigationState(workspaceState, {
      drawer: {
        open: true,
        type,
        itemId: itemId ?? null,
      },
    }),
  ),
);
workspaceNavigationReducer.with(closeWorkspaceDrawer, (state, { payload: [wsId] }) =>
  withWorkspaceNavigationState(state, wsId, (workspaceState) =>
    mergeWorkspaceNavigationState(workspaceState, {
      drawer: {
        open: false,
        type: null,
        itemId: null,
      },
    }),
  ),
);
workspaceNavigationReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
