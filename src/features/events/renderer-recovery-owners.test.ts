import { afterEach, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/store', () => ({
  store: { createSelector: (fn: any) => ({ select: fn }), state: {}, dispatch: vi.fn() },
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: { select: (s: any) => s.authority },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: (s: any) => (s.exists ? { id: 'ws' } : undefined) },
  selectWorkspaceParticipationContext: { select: (s: any) => (s.exists ? s.authority : null) },
  selectWorkspaceListLoadedForBackend: { select: () => true },
}));
vi.mock('$store/renderer/slices/chat-changes/chat-changes-selectors', () => ({
  selectChatChangesCanRead: { select: () => true },
}));
import {
  createCollection,
  getItem,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  chatChangesReducer,
  chatChangesInputChanged,
} from '$store/renderer/slices/chat-changes/chat-changes-slice';
import { installRendererRecoveryOwners } from './renderer-recovery-owners';
const cleanup: (() => void)[] = [];
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { type: 'Deletion', content: 'old' },
    { type: 'Addition', content: 'fresh' },
  ],
};
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (event: RecoveryNotification) => void;
  const request = vi.fn(async (method: string, params?: any): Promise<any> => {
    if (method === 'events.subscribe') return { subscriptionId: 'all', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'git.diffs')
      return params.staged ? [] : params.paths.map((path: string) => ({ path, hunks: [hunk] }));
    if (method === 'git.showFile') return { content: 'old' };
    if (method === 'file.read') return { content: 'fresh' };
    throw new Error(method);
  });
  const scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      request: async (m, p, observe) => {
        const value = await request(m, p);
        observe?.(value);
        return value;
      },
      onNotification: (fn) => {
        emit = fn;
        return () => {};
      },
      onRetired: () => () => {},
      dispose: () => {},
    }),
  );
  let state: any = {
    authority: 'a',
    exists: true,
    connections: { windowBackendId: 'local' },
    workspace: { deletionTokens: {} },
    gitRoots: { byWorkspaceId: { ws: { gitRoots: createCollection('id') } } },
    chatChanges: chatChangesReducer.initialState,
  };
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state,
    dispatch: (action: any) => {
      state = { ...state, chatChanges: chatChangesReducer(state.chatChanges, action) };
      for (const fn of listeners) fn();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  cleanup.push(installRendererRecoveryOwners(scope, store));
  await scope.subscribe({ eventTypes: ['*'] }, { recover: true });
  const input = {
    changes: [
      {
        filePath: 'a.ts',
        action: 'modify' as const,
        toolName: 'git',
        toolCallId: 'a',
        additions: 1,
        deletions: 1,
        category: 'unstaged' as const,
        oldContent: 'old',
        newContent: 'obsolete',
      },
    ],
    showStagingControls: true,
    isAggregate: false,
    groupByCommit: false,
    nodeOwnedPaths: false,
  };
  store.dispatch(chatChangesInputChanged('ws', 'live', 'r', input));
  const consumer = () => getItem(state.chatChanges.byWorkspaceId.ws.consumers, 'live')!;
  return {
    store,
    request,
    consumer,
    input,
    rows: () => getItems(consumer().changes).map((row) => row.change),
    event: () =>
      emit({
        method: 'events.event',
        params: {
          subscriptionId: 'all',
          event: { type: 'git:status', workspaceId: 'ws', data: {} },
        },
      }),
    loss: () =>
      emit({
        method: 'events.lost',
        params: { subscriptionId: 'all', generation: '1', scope: { workspaceId: null } },
      }),
    change: (patch: any) => {
      state = { ...state, ...patch };
      for (const fn of listeners) fn();
    },
  };
}
afterEach(() => {
  for (const off of cleanup.splice(0)) off();
  rendererEventRecovery.detach();
  vi.useRealTimers();
});
it('installs live chat cache recovery through production owner registration', async () => {
  const h = await setup();
  h.store.dispatch(
    chatChangesInputChanged('ws', 'transcript', 't', {
      ...h.input,
      showStagingControls: false,
      changes: h.input.changes.map((c) => ({ ...c, filePath: 'transcript.ts' })),
    }),
  );
  h.loss();
  h.loss();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(h.rows()).toMatchObject([{ filePath: 'a.ts', newContent: 'fresh', staged: false }]);
  expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toHaveLength(2);
  expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(2);
  expect(JSON.stringify(h.request.mock.calls)).not.toContain('transcript.ts');
});

vi.mock('./workspace-activity-recovery', () => ({
  installWorkspaceActivityRecovery: () => () => {},
}));
vi.mock('./task-list-recovery', () => ({ installTaskListRecovery: () => () => {} }));
vi.mock('$features/agent/agent-event-recovery', () => ({
  installAgentEventRecovery: () => () => {},
}));
vi.mock('$features/presence/collaboration-recovery', () => ({
  installCollaborationRecovery: () => () => {},
}));
vi.mock('$features/file/file-event-recovery', () => ({ installFileEventRecovery: () => () => {} }));
vi.mock('$features/scripts/scripts-event-recovery', () => ({
  installScriptsRecovery: () => () => {},
}));
vi.mock('$features/file-tracking/worktree-snapshots-recovery', () => ({
  installWorktreeSnapshotsRecovery: () => () => {},
}));
vi.mock('$features/file-tracking/git-content-recovery', () => ({
  installGitContentRecovery: () => () => {},
}));
vi.mock('$features/file-tracking/git-secondary-root-recovery', () => ({
  installSecondaryRootRecovery: () => () => {},
}));
vi.mock('./workspace-list-recovery', () => ({ installWorkspaceListRecovery: () => () => {} }));
vi.mock('./terminal-list-recovery', () => ({ installTerminalListRecovery: () => () => {} }));
vi.mock('./skills-recovery', () => ({ installSkillsRecovery: () => () => {} }));
vi.mock('./lifecycle-metadata-recovery', () => ({
  installLifecycleMetadataRecovery: () => () => {},
  beginLifecycleMetadataMutation: () => undefined,
}));
vi.mock('./daemon-events-bridge.client', () => ({ retireWorkspaceAfterRecovery: vi.fn() }));
