import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAppStoreLifecycle, type AppStoreHmrData } from './app-store-lifecycle';
import { startRootStoreLifecycle } from './root-store-lifecycle';
import { store as appStore } from './store';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import { backendRequest } from '$lib/client/live/backend-transport';
import { rememberNoteWorkspace } from '$lib/client/live/live-support';
import { runAssignAgentTaskMenuAction } from '$lib/components/workspace/note-with-comments/task-menu-assign-agent-action';
import { clearPendingAgentDeletions } from '$features/agent/utils/pending-agent-deletions';
import { bulkUpsertSessions, updateSession } from './slices/agent-session/agent-session-slice';
import {
  agentMutationUiConsumed,
  agentMutationUiReleased,
  agentMutationUiRequested,
} from './slices/agent-mutation-ui/agent-mutation-ui-slice';
import { selectAgentMutationUi } from './slices/agent-mutation-ui/agent-mutation-ui-selectors';
import { selectAgentCreationOutcome } from './slices/workspace-agents/workspace-agents-selectors';
import { setWorkspaceEntity } from './slices/workspace/workspace-slice';
import {
  clearAgentCreationOutcome,
  createAgentFromConfigRequested,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  renameAgentSessionRequested,
  restoreRetiredAgentRequested,
  retireAgentRequested,
  setActiveAgentId,
  stopAgentSessionRequested,
  undoAgentDeletionRequested,
} from './slices/workspace-agents/workspace-agents-slice';

// Exercise the actual root registration, configured Store, reducers, workers and
// live AgentsClient. Unrelated startup reads remain pending at their transport
// boundaries; no live daemon, destructive operation or external auth is used.
vi.mock('$lib/client/live/backend-transport', async () => ({
  BackendError: (await import('../../test/mocks/backend-transport.mock')).BackendError,
  backendRequest: vi.fn(() => new Promise(() => {})),
  backendSubscribe: vi.fn(() => new Promise(() => {})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
}));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: vi.fn(() => new Promise(() => {})),
}));
vi.mock('$shared/generated/ipc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$shared/generated/ipc-client')>()),
  invoke: vi.fn(() => new Promise(() => {})),
}));
vi.mock('$lib/components/patterns/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/components/patterns/notify')>()),
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const WS = 'lifecycle-origin';
const OTHER_WS = 'lifecycle-other';
const AGENT = 'agent-lifecycle-composition';
const OTHER_AGENT = 'agent-lifecycle-other';
const NOW = '2026-09-30T00:00:00Z';
const request = vi.mocked(backendRequest);
let stopRoot: (() => void) | undefined;
let stopApp: (() => void) | undefined;
let hmr: AppStoreHmrData;

function seed(agentId = AGENT, workspaceId = WS): void {
  appStore.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: workspaceId,
      path: '/test/lifecycle',
      myRole: 'owner',
      status: 'active',
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      createdAt: NOW,
      updatedAt: NOW,
    } as Workspace),
  );
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AgentId(agentId),
        workspaceId: WorkspaceId(workspaceId),
        backendSessionId: null,
        name: 'Original identity',
        nameExplicitlySet: false,
        status: AgentStatus.Idle,
        messages: [],
        createdAt: NOW,
        updatedAt: NOW,
      } satisfies AgentSession,
    ]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingAgentDeletions();
  request.mockImplementation(() => new Promise(() => {}));
  vi.spyOn(window.electronAPI!, 'invoke').mockImplementation(() => new Promise(() => {}));
  hmr = {};
  stopRoot = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  stopApp = startAppStoreLifecycle(appStore, hmr);
  admitLegacyPrincipal();
  seed();
  seed(OTHER_AGENT, OTHER_WS);
});

afterEach(() => {
  stopApp?.();
  stopRoot?.();
  stopApp = stopRoot = undefined;
  clearPendingAgentDeletions();
  vi.restoreAllMocks();
});

describe('agent lifecycle production composition', () => {
  it.each(['acknowledged', 'failed'] as const)(
    'keeps task association behind %s creation through the production factory owner',
    async (outcome) => {
      rememberNoteWorkspace('parent-task-note', WS);
      const created = Promise.withResolvers<object>();
      request.mockImplementation((method) => {
        if (method === 'task.createPrerequisite')
          return Promise.resolve({ task: { id: 'new-task-note' } });
        if (method === 'agent.create') return created.promise;
        if (method === 'task.linkAgent')
          return Promise.resolve({
            link: {
              workspaceId: WS,
              noteId: 'parent-task-note',
              taskText: 'Ship feature',
              agentId: 'agent-task-created',
              taskKey: 'agent:agent-task-created',
              createdAt: NOW,
            },
          });
        return new Promise(() => {});
      });
      const actions: { type: string; payload: unknown[] }[] = [];
      appStore.dispatch(setActiveAgentId(WS, AGENT));
      const activeBefore = appStore.state.workspaceAgents.byWorkspaceId[WS]?.activeAgentId;
      const operation = runAssignAgentTaskMenuAction({
        editor: null,
        workspace: { id: WorkspaceId(WS), path: '/test/lifecycle' } as Workspace,
        noteId: 'parent-task-note',
        taskData: { text: 'Ship feature', position: '1' },
        parentNoteTitle: 'Plan',
        model: 'task-model',
        debounceUpdate: vi.fn(),
        storeDispatch: (action) => {
          actions.push(action);
          appStore.dispatch(action);
        },
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });
      await vi.waitFor(() =>
        expect(request.mock.calls.filter(([method]) => method === 'agent.create')).toHaveLength(1),
      );
      expect(request.mock.calls.filter(([method]) => method === 'task.createPrerequisite')).toEqual(
        [
          [
            'task.createPrerequisite',
            {
              workspaceId: WS,
              dependentNoteId: 'parent-task-note',
              title: 'Ship feature',
              content: expect.any(String),
              status: 'not_started',
              idempotencyKey: expect.any(String),
            },
          ],
        ],
      );
      expect(
        actions.filter((action) => action.type === 'taskAgentAssociations/addTaskAgentAssociation'),
      ).toEqual([]);
      expect(request.mock.calls.filter(([method]) => method === 'task.linkAgent')).toEqual([]);
      if (outcome === 'acknowledged')
        created.resolve({
          agent: {
            id: 'agent-task-created',
            workspaceId: WS,
            name: 'Ship feature',
            status: 'pending',
            provider: 'claude-code',
            model: 'task-model',
            metadata: { isBackground: true, taskNoteId: 'new-task-note' },
            createdAt: NOW,
            updatedAt: NOW,
          },
        });
      else created.reject(new Error('creation refused'));
      await operation;
      expect(appStore.state.workspaceAgents.byWorkspaceId[WS]?.activeAgentId).toBe(activeBefore);
      const links = actions.filter(
        (action) => action.type === 'taskAgentAssociations/addTaskAgentAssociation',
      );
      if (outcome === 'acknowledged') {
        expect(links).toHaveLength(1);
        expect(links[0].payload).toEqual([
          WS,
          'parent-task-note',
          {
            taskText: 'Ship feature',
            taskKey: 'agent:agent-task-created',
            agentId: 'agent-task-created',
            noteId: 'parent-task-note',
            createdAt: expect.any(Number),
          },
        ]);
        await vi.waitFor(() =>
          expect(request).toHaveBeenCalledWith('task.linkAgent', {
            workspaceId: WS,
            noteId: 'parent-task-note',
            taskText: 'Ship feature',
            agentId: 'agent-task-created',
            taskKey: 'agent:agent-task-created',
          }),
        );
      } else {
        expect(links).toEqual([]);
        expect(request.mock.calls.filter(([method]) => method === 'task.linkAgent')).toEqual([]);
      }
      expect(
        actions.filter((action) => action.type === 'workspaceNotes/addOptimisticNote').at(-1)
          ?.payload[1],
      ).toMatchObject({ id: 'new-task-note' });
      expect(request.mock.calls.filter(([method]) => method === 'agent.sendMessage')).toEqual([]);
    },
  );

  it('uses the real factory once for duplicate consumer creation and preserves acknowledged identity', async () => {
    const created = Promise.withResolvers<object>();
    request.mockImplementation((method) =>
      method === 'agent.create' ? created.promise : new Promise(() => {}),
    );
    const config = {
      workspaceId: WorkspaceId(WS),
      name: 'Created agent',
      nameExplicitlySet: false,
      provider: 'auggie',
      model: 'requested-model',
      source: 'workspace-initializer',
      metadata: { specialist: 'developer', chiefPromptVersion: 99 },
    };
    const a = createAgentFromConfigRequested(WS, config, {
      consumer: { id: 'create-card-a', resourceId: 'same-resource' },
    });
    const b = createAgentFromConfigRequested(WS, config, {
      consumer: { id: 'create-card-b', resourceId: 'same-resource' },
    });
    appStore.dispatch(a);
    appStore.dispatch(b);
    await vi.waitFor(() =>
      expect(request.mock.calls.filter(([method]) => method === 'agent.create')).toHaveLength(1),
    );
    expect(
      selectAgentCreationOutcome.select(appStore.state, 'create-card-a', WS, 'same-resource')
        ?.status,
    ).toBe('pending');
    expect(request.mock.calls.filter(([method]) => method === 'agent.create')).toEqual([
      [
        'agent.create',
        {
          workspaceId: WS,
          workspacePath: '/test/lifecycle',
          idempotencyKey: expect.any(String),
          name: 'Created agent',
          nameExplicitlySet: false,
          provider: 'auggie',
          model: 'requested-model',
          specialistId: 'developer',
          metadata: {
            specialist: 'developer',
            chiefPromptVersion: 99,
            source: 'workspace-initializer',
          },
        },
      ],
    ]);
    created.resolve({
      agent: {
        id: 'agent-daemon-created',
        workspaceId: WS,
        name: 'Created agent',
        status: 'pending',
        provider: 'claude-code',
        model: 'host-model',
        nameExplicitlySet: false,
        metadata: { specialist: 'developer', chiefPromptVersion: 2 },
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const [first, second] = await Promise.all([a.promise, b.promise]);
    expect(first.id).toBe('agent-daemon-created');
    expect(second.id).toBe(first.id);
    expect(appStore.state.agentSessions.byAgentId[first.id]).toMatchObject({
      workspaceId: WS,
      provider: 'claude-code',
      model: 'host-model',
      metadata: { chiefPromptVersion: 2 },
    });
    expect(
      selectAgentCreationOutcome.select(appStore.state, 'create-card-a', WS, 'same-resource'),
    ).toMatchObject({ seq: a.seq, status: 'success', agentId: first.id });
    expect(
      selectAgentCreationOutcome.select(appStore.state, 'create-card-b', WS, 'same-resource'),
    ).toMatchObject({ seq: b.seq, status: 'success', agentId: first.id });
    expect(
      selectAgentCreationOutcome.select(appStore.state, 'create-card-a', OTHER_WS, 'same-resource'),
    ).toBeUndefined();
    appStore.dispatch(clearAgentCreationOutcome('create-card-a', b.seq));
    expect(
      selectAgentCreationOutcome.select(appStore.state, 'create-card-a', WS, 'same-resource')?.seq,
    ).toBe(a.seq);
    appStore.dispatch(clearAgentCreationOutcome('create-card-a', a.seq));
    appStore.dispatch(clearAgentCreationOutcome('create-card-b', b.seq));
    expect(request.mock.calls.filter(([method]) => method === 'agent.create')).toHaveLength(1);
  });

  it('rolls back failed optimistic identity without changing remote node or checkpoint state', async () => {
    const rename = Promise.withResolvers<never>();
    request.mockImplementation((method) =>
      method === 'agent.rename' ? rename.promise : new Promise(() => {}),
    );
    appStore.dispatch(
      updateSession(AGENT, {
        status: AgentStatus.Halted,
        placement: { target: 'remote', checkout: 'isolated' },
        nodeState: 'offline',
        checkpoint: {
          id: 'checkpoint-1',
          assignmentEpoch: '1',
          captureRevision: '3',
          capturedAt: NOW,
          committedAt: NOW,
        },
      }),
    );
    const original = appStore.state.agentSessions.byAgentId[AGENT];
    appStore.dispatch(
      agentMutationUiRequested(WS, 'card', 'rename-1', AGENT, {
        kind: 'rename',
        name: 'Optimistic',
      }),
    );
    expect(selectAgentMutationUi.select(appStore.state, WS, 'card')?.status).toBe('pending');
    expect(appStore.state.agentSessions.byAgentId[AGENT]?.name).toBe('Optimistic');
    rename.reject(new Error('rename refused'));
    await vi.waitFor(() =>
      expect(selectAgentMutationUi.select(appStore.state, WS, 'card')?.status).toBe('failed'),
    );
    expect(appStore.state.agentSessions.byAgentId[AGENT]).toEqual(original);
    expect(request.mock.calls.filter(([method]) => method === 'agent.rename')).toEqual([
      ['agent.rename', { agentId: AGENT, name: 'Optimistic', workspaceId: WS }],
    ]);
  });

  it('rejects stale UI completions and keeps the newer successful identical name after older failure', async () => {
    const first = Promise.withResolvers<{ success: true; name: string }>();
    const second = Promise.withResolvers<{ success: true; name: string }>();
    let count = 0;
    request.mockImplementation((method) =>
      method === 'agent.rename'
        ? ++count === 1
          ? first.promise
          : second.promise
        : new Promise(() => {}),
    );
    appStore.dispatch(
      agentMutationUiRequested(WS, 'older-card', 'old', AGENT, {
        kind: 'rename',
        name: 'Same identity',
      }),
    );
    appStore.dispatch(
      agentMutationUiRequested(WS, 'card', 'new', AGENT, { kind: 'rename', name: 'Same identity' }),
    );
    second.resolve({ success: true, name: 'Same identity' });
    await vi.waitFor(() =>
      expect(selectAgentMutationUi.select(appStore.state, WS, 'card')?.status).toBe('succeeded'),
    );
    first.reject(new Error('old failed'));
    await vi.waitFor(() =>
      expect(selectAgentMutationUi.select(appStore.state, WS, 'older-card')?.status).toBe('failed'),
    );
    expect(appStore.state.agentSessions.byAgentId[AGENT]?.nameExplicitlySet).toBe(true);
    expect(appStore.state.agentSessions.byAgentId[AGENT]?.name).toBe('Same identity');
    expect(selectAgentMutationUi.select(appStore.state, WS, 'card')).toMatchObject({
      requestId: 'new',
      status: 'succeeded',
    });
    expect(selectAgentMutationUi.select(appStore.state, OTHER_WS, 'card')).toBeUndefined();
    appStore.dispatch(agentMutationUiConsumed(WS, 'card', 'old'));
    expect(selectAgentMutationUi.select(appStore.state, WS, 'card')?.requestId).toBe('new');
    appStore.dispatch(agentMutationUiConsumed(WS, 'card', 'new'));
    expect(selectAgentMutationUi.select(appStore.state, WS, 'card')).toBeUndefined();
  });

  it('does not publish a released consumer result into a remounted card', async () => {
    const stop = Promise.withResolvers<{ success: true }>();
    request.mockImplementation((method) =>
      method === 'agent.stop' ? stop.promise : new Promise(() => {}),
    );
    appStore.dispatch(agentMutationUiRequested(WS, 'old-card', 'stop-1', AGENT, { kind: 'stop' }));
    appStore.dispatch(agentMutationUiReleased(WS, 'old-card'));
    appStore.dispatch(
      agentMutationUiRequested(OTHER_WS, 'new-card', 'stop-2', OTHER_AGENT, { kind: 'stop' }),
    );
    stop.resolve({ success: true });
    await vi.waitFor(() =>
      expect(selectAgentMutationUi.select(appStore.state, OTHER_WS, 'new-card')?.status).toBe(
        'succeeded',
      ),
    );
    expect(selectAgentMutationUi.select(appStore.state, WS, 'old-card')).toBeUndefined();
    expect(request.mock.calls.filter(([method]) => method === 'agent.stop')).toEqual([
      ['agent.stop', { agentId: AGENT, workspaceId: WS }],
      ['agent.stop', { agentId: OTHER_AGENT, workspaceId: OTHER_WS }],
    ]);
  });

  it('settles identical legacy requests independently and retains explicit workspace routing', async () => {
    const first = Promise.withResolvers<{ success: true; name: string }>();
    const second = Promise.withResolvers<{ success: true; name: string }>();
    let renameCount = 0;
    request.mockImplementation((method) => {
      if (method === 'agent.rename') return ++renameCount === 1 ? first.promise : second.promise;
      if (method === 'agent.stop') return Promise.resolve({ success: true });
      return new Promise(() => {});
    });
    const a = renameAgentSessionRequested(WS, AGENT, 'Same identity');
    const b = renameAgentSessionRequested(WS, AGENT, 'Same identity');
    const bSettled = vi.fn();
    void b.promise.then(bSettled);
    appStore.dispatch(a);
    appStore.dispatch(b);
    await appStore.dispatch(stopAgentSessionRequested(OTHER_WS, OTHER_AGENT));
    expect(request.mock.calls.filter(([method]) => method === 'agent.stop')).toEqual([
      ['agent.stop', { agentId: OTHER_AGENT, workspaceId: OTHER_WS }],
    ]);
    first.resolve({ success: true, name: 'Same identity' });
    await expect(a.promise).resolves.toBeUndefined();
    expect(bSettled).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(renameCount).toBe(2));
    second.resolve({ success: true, name: 'Same identity' });
    await expect(b.promise).resolves.toBeUndefined();
    expect(request.mock.calls.filter(([method]) => method === 'agent.rename')).toEqual([
      ['agent.rename', { agentId: AGENT, name: 'Same identity', workspaceId: WS }],
      ['agent.rename', { agentId: AGENT, name: 'Same identity', workspaceId: WS }],
    ]);
  });

  it('keeps retirement separate from deletion and refuses resurrection after committed deletion', async () => {
    request.mockImplementation((method) => {
      if (method === 'client.hello')
        return Promise.resolve({ server: { capabilities: { agentRetire: 1 } } });
      if (method === 'agent.retire') return Promise.resolve({ success: true, retiredAt: NOW });
      if (method === 'agent.restore') return Promise.resolve({ success: true });
      if (method === 'agent.delete')
        return Promise.resolve({
          success: true,
          scheduled: true,
          deleteAt: '2026-09-30T00:00:15Z',
        });
      if (method === 'agent.cancelDelete') return Promise.resolve({ cancelled: false });
      return new Promise(() => {});
    });
    await appStore.dispatch(retireAgentRequested(WS, AGENT));
    expect(appStore.state.agentSessions.byAgentId[AGENT]?.retiredAt).toBe(NOW);
    expect(request.mock.calls.filter(([method]) => method === 'agent.delete')).toEqual([]);
    await appStore.dispatch(restoreRetiredAgentRequested(WS, AGENT));
    expect(appStore.state.agentSessions.byAgentId[AGENT]?.retiredAt).toBeUndefined();
    const deleted = await appStore.dispatch(deleteAgentWithUndoRequested(WS, AGENT));
    expect(deleted?.id).toBe(AGENT);
    expect(appStore.state.agentSessions.byAgentId[AGENT]).toBeUndefined();
    await expect(appStore.dispatch(undoAgentDeletionRequested(WS, AGENT))).resolves.toBe(false);
    expect(appStore.state.agentSessions.byAgentId[AGENT]).toBeUndefined();
    expect(appStore.state.agentSessions.byAgentId[OTHER_AGENT]?.workspaceId).toBe(OTHER_WS);
    expect(
      request.mock.calls.filter(([method]) =>
        ['agent.retire', 'agent.restore', 'agent.delete', 'agent.cancelDelete'].includes(method),
      ),
    ).toEqual([
      ['agent.retire', { agentId: AGENT, workspaceId: WS }],
      ['agent.restore', { agentId: AGENT, workspaceId: WS }],
      ['agent.delete', { agentId: AGENT, workspaceId: WS, undoDelayMs: 15_000 }],
      ['agent.cancelDelete', { agentId: AGENT, workspaceId: WS }],
    ]);
  });

  it('settles teardown without restoring a possibly committed delete and installs one owner on reload', async () => {
    const deleting = Promise.withResolvers<{ success: true }>();
    request.mockImplementation((method) => {
      if (method === 'agent.delete') return deleting.promise;
      if (method === 'agent.stop') return Promise.resolve({ success: true });
      return new Promise(() => {});
    });
    const deletion = deleteAgentSessionRequested(WS, AGENT);
    const rejected = expect(deletion.promise).rejects.toBeInstanceOf(Error);
    appStore.dispatch(deletion);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('agent.delete', {
        agentId: AGENT,
        workspaceId: WS,
      }),
    );
    stopApp?.();
    await rejected;
    deleting.resolve({ success: true });
    expect(appStore.state.agentSessions.byAgentId[AGENT]).toBeUndefined();
    stopApp = startAppStoreLifecycle(appStore, hmr);
    await appStore.dispatch(stopAgentSessionRequested(OTHER_WS, OTHER_AGENT));
    expect(request.mock.calls.filter(([method]) => method === 'agent.stop')).toEqual([
      ['agent.stop', { agentId: OTHER_AGENT, workspaceId: OTHER_WS }],
    ]);
    expect(appStore.state.agentSessions.byAgentId[AGENT]).toBeUndefined();
  });
});
