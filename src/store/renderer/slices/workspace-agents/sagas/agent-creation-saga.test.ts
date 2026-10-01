import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { SPECIALISTS, GITHUB_DEPENDENT_SPECIALIST_IDS } from '$lib/constants/specialists';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  backendRequest: vi.fn(),
  // When true, `agentFactory.createAgent` is the REAL UnifiedAgentFactory
  // (→ real LiveAgentsClient → mocked transport) instead of `mocks.createAgent`.
  useRealFactory: false,
}));
vi.mock('$features/agent/services/agent-factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$features/agent/services/agent-factory')>();
  return {
    agentFactory: {
      createAgent: (...args: Parameters<typeof actual.agentFactory.createAgent>) =>
        mocks.useRealFactory
          ? actual.agentFactory.createAgent(...args)
          : mocks.createAgent(...args),
    },
  };
});
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));

import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import { store as appStore } from '../../../store';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession, Note, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';
import { agentSessionLaunchAgentRequested } from '../../agent-session/agent-session-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  connectionsListReceived,
  connectionsReducer,
  initialState as connectionsInitialState,
} from '../../connections/connections-slice';
import {
  guestSessionsListReceived,
  guestSessionsReducer,
  initialState as guestSessionsInitialState,
} from '../../guest-sessions/guest-sessions-slice';
import type { GuestSessionRecord } from '../../guest-sessions/guest-sessions-types';
import {
  initialState as specialistsInitialState,
  type FileSpecialist,
} from '../../specialists/specialists-slice';
import {
  createAgentFromConfigRequested,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  delegateExistingTaskRequested,
  runAgentForNoteRequested,
} from '../workspace-agents-slice';
import { agentCreationSaga } from './agent-creation-saga';
import {
  workspaceAgentsReducer,
  clearAgentCreationOutcome,
  emptyWorkspaceAgentState,
} from '../workspace-agents-slice';
import { selectAgentCreationOutcome } from '../workspace-agents-selectors';
import type { StoreState } from '../../../types';

const WS = 'ws-create-saga';
const AGENT = 'agent-created';
const NOTE = 'note-task-1';
const settle = async () => {
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(): AgentSession {
  return {
    id: AGENT,
    backendSessionId: `backend-${AGENT}`,
    workspaceId: WS,
    name: 'Created Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as AgentSession;
}

const GUEST_SESSION: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.5',
  hosts: ['10.0.0.5'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'prin-guest',
  login: 'octocat',
  tokenEncrypted: true,
  updatedAt: 1,
};

// A settled owner window: the guest session list hydrated with no joined host.
function ownerWindowIdentity() {
  return withLegacyPrincipal({
    connections: connectionsInitialState,
    guestSessions: guestSessionsReducer(
      guestSessionsInitialState,
      guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }),
    ),
  });
}

// A settled guest window: the window's backend id is a joined host.
function guestWindowIdentity() {
  return {
    connections: connectionsReducer(
      connectionsInitialState,
      connectionsListReceived({
        connections: [],
        activeId: GUEST_SESSION.id,
        windowBackendId: GUEST_SESSION.id,
      }),
    ),
    guestSessions: guestSessionsReducer(
      guestSessionsInitialState,
      guestSessionsListReceived({ sessions: [GUEST_SESSION], openIds: [], connectedIds: [] }),
    ),
  };
}

function state(
  defaultSpecialistId = '',
  fileSpecialists: FileSpecialist[] = [],
  activeProviderId = 'augment',
  providerModels: Record<string, string> = { augment: 'sonnet' },
  identity: ReturnType<typeof ownerWindowIdentity> = ownerWindowIdentity(),
) {
  const workspace = { id: WS, title: 'Workspace', repositoryPath: '/tmp/repo' } as Workspace;
  const note = { id: NOTE, title: 'Task note', content: 'Do the thing' } as Note;
  return {
    ...identity,
    workspace: { workspaces: { ids: [WS], map: { [WS]: workspace } } },
    workspaceAgents: { byWorkspaceId: { [WS]: { agentIds: [] } } },
    agentSessions: { byAgentId: {} },
    model: { providerModels, defaultProviderId: activeProviderId },
    providerCatalog: {
      providers: createCollection<{ id: string }, 'id'>('id'),
      loaded: true,
      byWorkspaceId: {
        [WS]: {
          catalog: { providers: [] },
          settings: [
            { path: 'model.defaultProvider', value: activeProviderId },
            { path: 'model.providerDefaults', value: providerModels },
            { path: 'specialists.default', value: defaultSpecialistId },
          ],
          readiness: { [activeProviderId]: { available: true } },
          specialists: [
            ...fileSpecialists,
            ...SPECIALISTS.filter(
              (s) =>
                !fileSpecialists.some((f) => f.id === s.id) &&
                !GITHUB_DEPENDENT_SPECIALIST_IDS.has(s.id),
            ).map((s) => ({
              ...s,
              source: 'bundled',
              model: s.defaultModel,
              behaviorPrompt: s.defaultBehaviorPrompt,
            })),
          ],
        },
      },
    },
    providerSettings: {},
    specialists: {
      ...specialistsInitialState,
      defaultSpecialistId,
      fileSpecialists: createCollection<FileSpecialist, 'id'>('id', fileSpecialists),
    },
    workspaceNotes: {
      byWorkspaceId: { [WS]: { notes: createCollection<Note, 'id'>('id', [note]) } },
    },
    githubAuth: { isAuthenticated: false },
  };
}

function start(getState: () => unknown = state) {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    {
      channel,
      getState,
      dispatch: (action) => {
        dispatched.push(action);
        channel.put(action);
        return action;
      },
    },
    agentCreationSaga,
  );
  return { channel, dispatched, task };
}

describe('agentCreationSaga', () => {
  function startConsumer() {
    let current = {
      ...state(),
      workspaceAgents: { byWorkspaceId: { [WS]: emptyWorkspaceAgentState } },
    } as unknown as StoreState;
    const channel = stdChannel();
    const dispatched: any[] = [];
    const dispatch = (action: any) => {
      current = {
        ...current,
        workspaceAgents: workspaceAgentsReducer(current.workspaceAgents, action),
      };
      dispatched.push(action);
      channel.put(action);
    };
    const task = runSaga({ channel, getState: () => current, dispatch }, agentCreationSaga);
    return {
      task,
      dispatch,
      dispatched,
      changeConnection: () => {
        current = { ...current, ...guestWindowIdentity() } as StoreState;
      },
      outcome: (id = 'card') => selectAgentCreationOutcome.select(current, id, WS, 'primitive'),
    };
  }

  it('settles coalesced creation outcomes without a placement interruption', async () => {
    let resolve!: (value: unknown) => void;
    mocks.createAgent.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const owner = startConsumer();
    const config = { workspaceId: WorkspaceId(WS), source: 'agent-action-block' };
    const first = createAgentFromConfigRequested(WS, config, {
      consumer: { id: 'card', resourceId: 'primitive' },
    });
    const second = createAgentFromConfigRequested(WS, config, {
      consumer: { id: 'other-card', resourceId: 'primitive' },
    });
    owner.dispatch(first);
    owner.dispatch(second);
    await settle();
    expect(mocks.createAgent).toHaveBeenCalledTimes(1);
    expect(owner.outcome()).toMatchObject({ status: 'pending', seq: first.seq });
    expect(
      owner.dispatched.some((action) => action.type === 'workspaceAgents/placementChoiceShown'),
    ).toBe(false);
    resolve({ success: true, agent: session() });
    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual([
      session(),
      session(),
    ]);
    expect(owner.outcome()).toMatchObject({ status: 'success', seq: first.seq, agentId: AGENT });
    expect(owner.outcome('other-card')).toMatchObject({
      status: 'success',
      seq: second.seq,
      agentId: AGENT,
    });
    expect(
      owner.dispatched
        .filter((a) => a.type === createAgentFromConfigRequested.success.type)
        .map((a) => a.payload.seq),
    ).toEqual([first.seq, second.seq]);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    owner.task.cancel();
  });

  it('does not navigate, notify or publish a late result after its consumer is released', async () => {
    let resolve!: (value: unknown) => void;
    mocks.createAgent.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const owner = startConsumer();
    const action = createAgentFromConfigRequested(
      WS,
      { workspaceId: WorkspaceId(WS), source: 'agent-action-block' },
      { openAgent: true, consumer: { id: 'card', resourceId: 'primitive' } },
    );
    owner.dispatch(action);
    owner.dispatch(clearAgentCreationOutcome('card'));
    resolve({ success: true, agent: session() });
    await expect(action.promise).resolves.toEqual(session());
    expect(owner.outcome()).toBeUndefined();
    expect(owner.dispatched).not.toContainEqual(
      expect.objectContaining({ type: openAgentTabRequested.type }),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    owner.task.cancel();
  });

  it('settles a cancelled consumer and its compatible promise without accepting a late completion', async () => {
    let resolve!: (value: unknown) => void;
    mocks.createAgent.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const owner = startConsumer();
    const action = createAgentFromConfigRequested(
      WS,
      { workspaceId: WorkspaceId(WS) },
      { consumer: { id: 'card', resourceId: 'primitive' } },
    );
    owner.dispatch(action);
    owner.task.cancel();
    await expect(action.promise).rejects.toThrow();
    expect(owner.outcome()).toMatchObject({ status: 'cancelled' });
    resolve({ success: true, agent: session() });
    await settle();
    expect(owner.outcome()).toMatchObject({ status: 'cancelled' });
  });

  it.each([true, false])(
    'suppresses late UI results after connection change (success=%s)',
    async (success) => {
      let resolve!: (value: unknown) => void;
      mocks.createAgent.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const owner = startConsumer();
      const action = createAgentFromConfigRequested(
        WS,
        { workspaceId: WorkspaceId(WS), source: 'agent-action-block' },
        { openAgent: true, consumer: { id: 'card', resourceId: 'primitive' } },
      );
      owner.dispatch(action);
      const duplicate = createAgentFromConfigRequested(WS, action.payload[1], {
        openAgent: true,
        consumer: { id: 'other-card', resourceId: 'primitive' },
      });
      owner.dispatch(duplicate);
      expect(mocks.createAgent).toHaveBeenCalledTimes(1);
      const settlement = Promise.allSettled([action.promise, duplicate.promise]);
      owner.changeConnection();
      resolve(success ? { success: true, agent: session() } : { success: false, error: 'refused' });
      expect((await settlement).map((result) => result.status)).toEqual(['rejected', 'rejected']);
      expect(owner.outcome()).toMatchObject({ status: 'cancelled' });
      expect(owner.outcome('other-card')).toMatchObject({ status: 'cancelled' });
      expect(owner.outcome()?.agentId).toBeUndefined();
      expect(owner.dispatched).not.toContainEqual(
        expect.objectContaining({ type: openAgentTabRequested.type }),
      );
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      owner.task.cancel();
    },
  );
  afterEach(() => {
    mocks.useRealFactory = false;
    vi.clearAllMocks();
  });

  it.each(['chief-card', 'agent-action-block'])(
    'preserves %s failure feedback in the owner',
    async (source) => {
      mocks.createAgent.mockResolvedValue({ success: false, error: 'host unavailable' });
      const owner = startConsumer();
      const action = createAgentFromConfigRequested(
        WS,
        { workspaceId: WorkspaceId(WS), source },
        { consumer: { id: 'card', resourceId: 'primitive' } },
      );
      owner.dispatch(action);
      await expect(action.promise).rejects.toThrow('host unavailable');
      expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
        source === 'chief-card'
          ? m.layout_chiefCard_startFailed_error({ message: 'host unavailable' })
          : 'host unavailable',
        { description: m.agent_creation_failed_description() },
      );
      owner.task.cancel();
    },
  );

  for (const source of ['chief-card', 'agent-action-block']) {
    it.each(['provider-model', 'forbidden'] as const)(
      `keeps actionable %s guidance in the single ${source} failure toast`,
      async (kind) => {
        const error =
          kind === 'provider-model'
            ? new Error('agent.create: model fable-5 does not belong to provider claude-code')
            : Object.assign(new Error('Forbidden'), { rpcCode: -32003 });
        mocks.createAgent.mockResolvedValue({ success: false, error: error.message, cause: error });
        const owner = startConsumer();
        const action = createAgentFromConfigRequested(
          WS,
          { workspaceId: WorkspaceId(WS), source },
          { consumer: { id: 'card', resourceId: 'primitive' } },
        );
        owner.dispatch(action);
        await expect(action.promise).rejects.toThrow();
        expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
          kind === 'provider-model'
            ? m.agent_creation_createFailed_error()
            : m.agent_creation_notPermitted_error(),
          {
            description:
              kind === 'provider-model'
                ? m.agent_creation_providerModelMismatch_description()
                : m.agent_creation_notPermitted_description(),
          },
        );
        owner.task.cancel();
      },
    );

    it(`cleans transport wrappers before showing the single ${source} failure toast`, async () => {
      mocks.createAgent.mockResolvedValue({
        success: false,
        error:
          "Error invoking remote method 'agent.create': Error: host unavailable\n    at invoke (transport.ts:12:3)",
      });
      const owner = startConsumer();
      const action = createAgentFromConfigRequested(
        WS,
        { workspaceId: WorkspaceId(WS), source },
        { consumer: { id: 'card', resourceId: 'primitive' } },
      );
      owner.dispatch(action);
      await expect(action.promise).rejects.toThrow('host unavailable');
      expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
        source === 'chief-card'
          ? m.layout_chiefCard_startFailed_error({ message: 'host unavailable' })
          : 'host unavailable',
        { description: m.agent_creation_failed_description() },
      );
      owner.task.cancel();
    });
  }

  it('reports a missing widget workspace without sending creation or requesting a selection', async () => {
    const { channel, dispatched, task } = start();
    const action = createAgentFromConfigRequested('', {
      workspaceId: WorkspaceId(''),
      source: 'agent-action-block',
    });
    channel.put(action);
    await expect(action.promise).rejects.toThrow(m.notes_agentActionBlock_noWorkspace_error());
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      m.notes_agentActionBlock_noWorkspace_error(),
      { description: m.agent_creation_failed_description() },
    );
    expect(dispatched).not.toContainEqual(
      expect.objectContaining({ type: openAgentTabRequested.type }),
    );
    task.cancel();
  });

  it('uses the widget unknown-error fallback when creation returns no failure detail', async () => {
    mocks.createAgent.mockResolvedValue({ success: false });
    const owner = startConsumer();
    const action = createAgentFromConfigRequested(
      WS,
      { workspaceId: WorkspaceId(WS), source: 'agent-action-block' },
      { consumer: { id: 'card', resourceId: 'primitive' } },
    );
    owner.dispatch(action);
    await expect(action.promise).rejects.toThrow(m.notes_agentActionBlock_unknown_error());
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      m.notes_agentActionBlock_unknown_error(),
      { description: m.agent_creation_failed_description() },
    );
    owner.task.cancel();
  });

  it('routes the fire-and-forget create trigger through agentFactory with server-minted identity', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start();
    channel.put(createAgentRequested(WS));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: WS, repositoryPath: '/tmp/repo' }),
      expect.objectContaining({
        workspaceId: WS,
        source: 'keyboard-shortcut',
        agentType: 'chat',
        nameExplicitlySet: false,
      }),
    );
    expect(mocks.createAgent.mock.calls[0][1]).not.toHaveProperty('agentId');
    task.cancel();
    await task.toPromise();
  });

  it('pairs a blank agent model with its selected Claude provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() =>
      state('', [], 'claude-code', { 'claude-code': 'opus-4-1' }),
    );
    channel.put(createAgentRequested(WS));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: 'opus-4-1',
        provider: 'claude-code',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('pairs General specialist-picker creation with the selected Claude provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() =>
      state('', [], 'claude-code', { 'claude-code': 'opus-4-1' }),
    );
    channel.put(createAgentWithSpecialistRequested(WS, null));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: 'opus-4-1',
        provider: 'claude-code',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('omits an inherited specialist preview while preserving its pinned provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const inherited: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude with an inherited model',
      codingAgent: 'claude-code',
      model: '',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
      resolvedModel: 'fable-5',
      resolvedProvider: 'auggie',
    };
    const { channel, task } = start(() => state('', [inherited]));
    channel.put(createAgentWithSpecialistRequested(WS, 'claude-reviewer'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'claude-code', model: undefined }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('splits a legacy compound specialist model into a bare model + owning provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude Opus',
      codingAgent: 'claude-code',
      model: 'claude-code:opus-4-1',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
    };
    const { channel, task } = start(() => state('', [pinned]));
    channel.put(createAgentWithSpecialistRequested(WS, 'claude-reviewer'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'claude-code',
        model: 'opus-4-1',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('passes a bare specialist frontmatter model through with its coding agent', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude Opus',
      codingAgent: 'claude-code',
      model: 'opus-4-1',
      reasoningEffort: 'high',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
    };
    const { channel, task } = start(() => state('', [pinned]));
    channel.put(createAgentWithSpecialistRequested(WS, 'claude-reviewer'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'claude-code',
        model: 'opus-4-1',
        reasoningEffort: 'high',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('opens created agents in the panel captured by the creation trigger', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    channel.put(
      createAgentRequested(WS, undefined, {
        panelLayoutId: 'layout-1',
        panelId: 'working-panel',
      }),
    );
    await settle();

    expect(dispatched).toContainEqual(
      openAgentTabRequested(WS, {
        agentId: AGENT,
        panelLayoutId: 'layout-1',
        targetPanelId: 'working-panel',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('opens specialist agents in the panel captured by the creation trigger', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    channel.put(
      createAgentWithSpecialistRequested(WS, null, {
        panelLayoutId: 'layout-1',
        panelId: 'working-panel',
      }),
    );
    await settle();

    expect(dispatched).toContainEqual(
      openAgentTabRequested(WS, {
        agentId: AGENT,
        panelLayoutId: 'layout-1',
        targetPanelId: 'working-panel',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('surfaces a safe localized error when fire-and-forget creation fails', async () => {
    mocks.createAgent.mockResolvedValue({
      success: false,
      error: 'backend rejected request with secret details',
    });
    const { channel, task } = start();
    channel.put(createAgentRequested(WS));
    await settle();

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to create agent', {
      description: 'Check your provider setup and selected model in Settings, then try again.',
    });
    expect(JSON.stringify(mocks.toastError.mock.calls)).not.toContain('secret details');
    task.cancel();
    await task.toPromise();
  });

  it('gives provider and model guidance for a confirmed mismatch', async () => {
    mocks.createAgent.mockResolvedValue({
      success: false,
      error: 'agent.create: model fable-5 does not belong to provider claude-code',
    });
    const { channel, task } = start();
    channel.put(createAgentWithSpecialistRequested(WS, null));
    await settle();

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to create agent', {
      description:
        'The selected model does not belong to this provider. Choose a model for this provider in Settings, then try again.',
    });
    task.cancel();
    await task.toPromise();
  });

  it('settles create-from-config success and preserves launch options', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    const action = createAgentFromConfigRequested(
      WS,
      {
        name: 'Configured',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      },
      { openAgent: true, panelId: 'panel-1' },
    );
    channel.put(action);

    await expect(action.promise).resolves.toEqual(session());
    expect(dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: action.success(session()).type }),
        expect.objectContaining({ type: 'panelLayout/openTab' }),
      ]),
    );
    task.cancel();
    await task.toPromise();
  });

  it('routes adjacent created agents through the rightmost configured column', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    const action = createAgentFromConfigRequested(
      WS,
      {
        name: 'Configured',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      },
      { openAgent: true, openInAdjacentPanel: true },
    );
    channel.put(action);

    await expect(action.promise).resolves.toEqual(session());
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: expect.objectContaining({
          wsId: WS,
          tab: expect.objectContaining({ type: 'agent', agentId: AGENT }),
        }),
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('chains launch through create-from-config and settles both actions', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start();
    const action = agentSessionLaunchAgentRequested(
      WS,
      { name: 'Launch', agentType: createAgentTypeId('chat'), source: 'test' },
      { openAgent: false },
    );
    channel.put(action);

    await expect(action.promise).resolves.toEqual(session());
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'sonnet', provider: 'augment' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('surfaces create-from-config failures and still rejects its promise', async () => {
    mocks.createAgent.mockResolvedValue({ success: false, error: 'request failed' });
    const { channel, task } = start();
    const action = createAgentFromConfigRequested(WS, {
      name: 'Configured',
      workspaceId: WorkspaceId(WS),
      agentType: createAgentTypeId('chat'),
      source: 'test',
    });
    channel.put(action);

    await expect(action.promise).rejects.toThrow('request failed');
    expect(mocks.toastError).toHaveBeenCalledOnce();
    task.cancel();
    await task.toPromise();
  });

  it('runs a task note with the daemon specialists.default setting when set', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() => state('verifier'));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: WS }),
      expect.objectContaining({
        agentType: 'task-loop',
        source: 'task-metadata-bar-run',
        provider: 'augment',
        model: undefined,
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'verifier' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('passes a pinned specialist reasoning effort through the task-run path', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude with an effort level',
      codingAgent: 'claude-code',
      model: 'opus-4-1',
      reasoningEffort: 'low',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
    };
    const { channel, task } = start(() => state('claude-reviewer', [pinned]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: 'opus-4-1',
        reasoningEffort: 'low',
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'claude-reviewer' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('falls back to implementor when specialists.default is unset', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start();
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'implementor' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('builds the initial message from cached content without fetching for a full row', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const get = vi.spyOn(appClient.notes, 'get');
    const { channel, task } = start();
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(get).not.toHaveBeenCalled();
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialMessage: expect.stringContaining('Do the thing') }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('fetches the full note before building the initial message for a stale slim row', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const slimState = state();
    const slimNote = {
      id: NOTE,
      workspaceId: WS,
      title: 'Task note',
      content: '',
      contentPreview: 'Do the',
      contentLength: 12,
    } as Note;
    slimState.workspaceNotes = {
      byWorkspaceId: { [WS]: { notes: createCollection<Note, 'id'>('id', [slimNote]) } },
    };
    const get = vi
      .spyOn(appClient.notes, 'get')
      .mockResolvedValue({ ...slimNote, content: 'Do the thing' } as Note);
    const { channel, task } = start(() => slimState);
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(get).toHaveBeenCalledWith(NOTE, WS);
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialMessage: expect.stringContaining('Do the thing') }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('keeps the cached slim row when the full-note fetch fails (fail-soft)', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const slimState = state();
    const slimNote = {
      id: NOTE,
      workspaceId: WS,
      title: 'Task note',
      content: '',
      contentPreview: 'Do the',
      contentLength: 12,
    } as Note;
    slimState.workspaceNotes = {
      byWorkspaceId: { [WS]: { notes: createCollection<Note, 'id'>('id', [slimNote]) } },
    };
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(null);
    const { channel, task } = start(() => slimState);
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(get).toHaveBeenCalledWith(NOTE, WS);
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialMessage: expect.stringContaining('(no content)') }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('runs on the default specialist\u2019s pinned coding agent when one is set', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'codex-runner',
      name: 'Codex Runner',
      description: 'Pinned to codex',
      codingAgent: 'codex',
      model: 'gpt-5',
      behaviorPrompt: 'Run tasks on codex.',
      filePath: '/tmp/codex-runner.md',
      source: 'user',
      resolvedModel: 'fable-5',
      resolvedProvider: 'auggie',
    };
    const { channel, task } = start(() => state('codex-runner', [pinned]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'codex',
        model: 'gpt-5',
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'codex-runner' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('omits an inherited task-run preview so the daemon resolves the pinned provider default', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'codex-runner',
      name: 'Codex Runner',
      description: 'Pinned to codex, no model',
      codingAgent: 'codex',
      model: '',
      behaviorPrompt: 'Run tasks on codex.',
      filePath: '/tmp/codex-runner.md',
      source: 'user',
      resolvedModel: 'fable-5',
      resolvedProvider: 'auggie',
    };
    const { channel, task } = start(() => state('codex-runner', [pinned]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'codex', model: undefined }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('falls back to implementor when specialists.default is a hidden specialist', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const hidden: FileSpecialist = {
      id: 'chief-of-staff',
      name: 'Chief of Staff',
      description: 'Hidden from pickers',
      model: '',
      behaviorPrompt: 'Coordinate.',
      filePath: '/tmp/chief-of-staff.md',
      source: 'user',
      hidden: true,
    };
    const { channel, task } = start(() => state('chief-of-staff', [hidden]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'implementor' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('falls back to implementor when specialists.default is gated invisible (pr-reviewer without GitHub auth)', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() => state('pr-reviewer'));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'implementor' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('rejects an in-flight promise action when the saga is cancelled', async () => {
    mocks.createAgent.mockReturnValue(new Promise(() => {}));
    const { channel, task } = start();
    const action = createAgentFromConfigRequested(WS, {
      name: 'Cancelled',
      workspaceId: WorkspaceId(WS),
      agentType: createAgentTypeId('chat'),
      source: 'test',
    });
    channel.put(action);
    await settle();
    task.cancel();

    await expect(action.promise).rejects.toThrow('Failed to create agent');
    await task.toPromise();
  });

  it('routes existing-task delegation to the daemon agent.delegate RPC', async () => {
    mocks.backendRequest.mockResolvedValue({ ok: true, agentId: AGENT, name: 'Task note' });
    const { channel, dispatched, task } = start();
    channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', false));
    await settle();

    expect(mocks.backendRequest).toHaveBeenCalledWith('agent.delegate', {
      workspaceId: WS,
      taskNoteId: NOTE,
    });
    expect(dispatched).not.toContainEqual(
      expect.objectContaining({ type: 'appLayout/openAgentTabRequested' }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('opens the delegated agent when the trigger asks for it', async () => {
    mocks.backendRequest.mockResolvedValue({ ok: true, agentId: AGENT, name: 'Task note' });
    const { channel, dispatched, task } = start();
    channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', true));
    await settle();

    expect(dispatched).toContainEqual(openAgentTabRequested(WS, { agentId: AGENT }));
    task.cancel();
    await task.toPromise();
  });

  it('surfaces a toast when agent.delegate rejects (e.g. occupancy guard)', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('task already has a live assigned agent'));
    const { channel, dispatched, task } = start();
    channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', true));
    await settle();

    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(dispatched).not.toContainEqual(
      expect.objectContaining({ type: 'appLayout/openAgentTabRequested' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('does not call the daemon when the workspace is unknown', async () => {
    const { channel, task } = start();
    channel.put(delegateExistingTaskRequested('ws-missing', NOTE, 'Task note', false));
    await settle();

    expect(mocks.backendRequest).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  describe('collaborator connection (guest window)', () => {
    const guestState = () => state('', [], 'augment', { augment: 'sonnet' }, guestWindowIdentity());

    it.each([
      ['createAgentRequested', () => createAgentRequested(WS)],
      ['createAgentWithSpecialistRequested', () => createAgentWithSpecialistRequested(WS, null)],
      ['runAgentForNoteRequested', () => runAgentForNoteRequested(WS, NOTE, 'Task note')],
      [
        'delegateExistingTaskRequested',
        () => delegateExistingTaskRequested(WS, NOTE, 'Task note', true),
      ],
    ])(
      'refuses %s before sending anything and renders the not-permitted sentence',
      async (_name, trigger) => {
        mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
        mocks.backendRequest.mockResolvedValue({ ok: true, agentId: AGENT });
        const { channel, dispatched, task } = start(guestState);
        channel.put(trigger());
        await settle();

        expect(mocks.createAgent).not.toHaveBeenCalled();
        expect(mocks.backendRequest).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledOnce();
        expect(mocks.toastError.mock.calls[0][0]).toBe("You can't create agents in this workspace");
        expect(dispatched).not.toContainEqual(
          expect.objectContaining({ type: 'appLayout/openAgentTabRequested' }),
        );
        task.cancel();
        await task.toPromise();
      },
    );

    it('rejects the promise-bearing create with the not-permitted sentence', async () => {
      const { channel, task } = start(guestState);
      const action = createAgentFromConfigRequested(WS, {
        name: 'Refused',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      });
      channel.put(action);

      await expect(action.promise).rejects.toThrow("You can't create agents in this workspace");
      expect(mocks.createAgent).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('rejects the launch trigger through the same refusal', async () => {
      const { channel, task } = start(guestState);
      const action = agentSessionLaunchAgentRequested(WS, {
        name: 'Refused',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      });
      channel.put(action);

      await expect(action.promise).rejects.toThrow("You can't create agents in this workspace");
      expect(mocks.createAgent).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('renders the not-permitted sentence when the daemon itself answers -32003', async () => {
      mocks.backendRequest.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { rpcCode: -32003 }),
      );
      const { channel, task } = start();
      channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', false));
      await settle();

      expect(mocks.toastError).toHaveBeenCalledOnce();
      expect(mocks.toastError.mock.calls[0][0]).toBe("You can't create agents in this workspace");
      task.cancel();
      await task.toPromise();
    });

    const forbiddenFactoryResult = () => ({
      success: false,
      error: 'forbidden: agent.create',
      cause: Object.assign(new Error('forbidden: agent.create'), { rpcCode: -32003 }),
    });

    it.each([
      ['createAgentRequested', () => createAgentRequested(WS)],
      ['createAgentWithSpecialistRequested', () => createAgentWithSpecialistRequested(WS, null)],
      ['runAgentForNoteRequested', () => runAgentForNoteRequested(WS, NOTE, 'Task note')],
    ])(
      'renders the not-permitted sentence when agent.create answers -32003 through the factory (%s)',
      async (_name, trigger) => {
        mocks.createAgent.mockResolvedValue(forbiddenFactoryResult());
        const { channel, task } = start();
        channel.put(trigger());
        await settle();

        expect(mocks.createAgent).toHaveBeenCalledOnce();
        expect(mocks.toastError).toHaveBeenCalledOnce();
        expect(mocks.toastError.mock.calls[0][0]).toBe("You can't create agents in this workspace");
        task.cancel();
        await task.toPromise();
      },
    );

    it('renders the not-permitted sentence end to end: real factory, real agents client, transport answers -32003', async () => {
      appStore.init();
      // Only the wire is faked: the real UnifiedAgentFactory calls the real
      // LiveAgentsClient, whose `agent.create` request the transport refuses
      // exactly as the daemon does for a collaborator connection.
      mocks.useRealFactory = true;
      mocks.backendRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.create') {
          throw Object.assign(new Error('Forbidden'), { rpcCode: -32003 });
        }
        return {};
      });
      const { channel, task } = start();
      channel.put(createAgentRequested(WS));
      await settle();
      await settle();

      expect(mocks.createAgent).not.toHaveBeenCalled();
      expect(mocks.backendRequest).toHaveBeenCalledWith(
        'agent.create',
        expect.objectContaining({ workspaceId: WS }),
      );
      expect(mocks.toastError).toHaveBeenCalledOnce();
      expect(mocks.toastError.mock.calls[0][0]).toBe("You can't create agents in this workspace");
      task.cancel();
      await task.toPromise();
    });

    it('rejects the promise-bearing create with the not-permitted sentence when agent.create answers -32003', async () => {
      mocks.createAgent.mockResolvedValue(forbiddenFactoryResult());
      const { channel, task } = start();
      const action = createAgentFromConfigRequested(WS, {
        name: 'Refused',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      });
      channel.put(action);

      await expect(action.promise).rejects.toThrow("You can't create agents in this workspace");
      expect(mocks.toastError).toHaveBeenCalledOnce();
      expect(mocks.toastError.mock.calls[0][0]).toBe("You can't create agents in this workspace");
      task.cancel();
      await task.toPromise();
    });
  });
});

it('workspace routing regression: existing-workspace creation uses that workspace defaults', async () => {
  mocks.useRealFactory = false;
  mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
  const scoped = state('', [], 'codex', { codex: 'direct-model' }) as any;
  scoped.providerCatalog = {
    loaded: true,
    providers: createCollection('id', []),
    byWorkspaceId: {
      [WS]: {
        catalog: { providers: [] },
        settings: [
          { path: 'model.defaultProvider', value: 'auggie' },
          { path: 'model.providerDefaults', value: { auggie: 'workspace-model' } },
        ],
        readiness: {},
        specialists: [],
      },
    },
  };
  const run = start(() => scoped);
  try {
    run.channel.put(createAgentRequested(WS));
    await settle();
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, provider: 'auggie', model: 'workspace-model' }),
    );
  } finally {
    run.task.cancel();
    await run.task.toPromise();
  }
});

it.each([false, true])(
  'uses divergent workspace catalogs for creation (specialist=%s)',
  async (useSpecialist) => {
    mocks.useRealFactory = false;
    mocks.createAgent.mockReset();
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const scoped = state('', [], 'direct', { direct: 'direct-model' });
    const snapshot = (id: string) => ({
      catalog: { providers: [] },
      settings: [
        { path: 'model.defaultProvider', value: `provider-${id}` },
        { path: 'model.providerDefaults', value: { [`provider-${id}`]: `model-${id}` } },
      ],
      readiness: {},
      specialists: [
        {
          id: 'same-specialist',
          name: `Specialist ${id}`,
          description: '',
          source: 'project',
          codingAgent: `provider-${id}`,
          model: `specialist-model-${id}`,
          behaviorPrompt: `prompt-${id}`,
          reasoningEffort: id === 'A' ? 'low' : 'high',
        },
      ],
    });
    const initial = {
      ...scoped,
      workspace: {
        workspaces: createCollection(
          'id',
          ['A', 'B'].map((id) => ({ id, title: id, repositoryPath: `/repo/${id}` })),
        ),
      },
      providerCatalog: {
        ...scoped.providerCatalog,
        byWorkspaceId: { A: snapshot('A'), B: snapshot('B') },
      },
    };
    const run = start(() => initial);
    try {
      for (const id of ['A', 'B']) {
        run.channel.put(
          useSpecialist
            ? createAgentWithSpecialistRequested(id, 'same-specialist')
            : createAgentRequested(id),
        );
        await settle();
        expect(mocks.createAgent).toHaveBeenLastCalledWith(
          expect.objectContaining({ id }),
          expect.objectContaining({
            workspaceId: id,
            provider: `provider-${id}`,
            model: useSpecialist ? `specialist-model-${id}` : `model-${id}`,
            ...(useSpecialist
              ? { behaviorPrompt: `prompt-${id}`, reasoningEffort: id === 'A' ? 'low' : 'high' }
              : {}),
          }),
        );
      }
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  },
);
