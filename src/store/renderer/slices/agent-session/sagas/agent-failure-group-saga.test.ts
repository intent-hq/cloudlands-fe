/**
 * @vitest-environment jsdom
 */
import { runSaga } from 'redux-saga';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  setModel: vi.fn(),
  agentFailure: vi.fn(),
  agentFailureGroup: vi.fn(),
  dismiss: vi.fn(),
  eligible: vi.fn(),
  models: vi.fn(),
}));
vi.mock('$lib/utils/machine-toast-forward', () => ({ forwardToastWhenHidden: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { agents: { retry: mocks.retry } } }));
vi.mock('$features/agent/agent.client', () => ({ agentClient: { setModel: mocks.setModel } }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: {
    agentFailure: mocks.agentFailure,
    agentFailureGroup: mocks.agentFailureGroup,
    dismiss: mocks.dismiss,
  },
}));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: vi.fn(async () => {}) }));
vi.mock('$features/hardware-console/assignment/connected-key-slot', () => ({
  resolveConnectedWorkspaceKeySlot: () => null,
}));
vi.mock('../../model/model-utils', () => ({ getModelsForProvider: mocks.models }));
vi.mock('../../provider-catalog/workspace-catalog-selectors', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  selectContextQuotaRetryProviderIds: {
    select: mocks.eligible,
    *effect(exhausted: string, workspaceId?: string) {
      return mocks.eligible(undefined, exhausted, workspaceId);
    },
  },
  selectWorkspaceCatalog: {
    select: () => ({}),
    *effect() {
      return {};
    },
  },
}));

import {
  clearAgentFailureRegistry,
  getAgentFailureEntry,
  listDelegatedAgentFailures,
  recordAgentFailure,
  recordDelegatedAgentFailure,
  removeAgentFailure,
} from '$features/agent/agent-failure-registry';
import { providerSwitchDialog } from '$features/agent/provider-switch-dialog-state';
import { getRememberedProviderSwitch } from '$features/agent/provider-switch-targets';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../../provider-catalog/provider-catalog-slice';
import { chatErrorCleared } from '../../chat-state/chat-state-slice';
import { agentFailureToastSaga } from './agent-failure-toast-saga';

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const catalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded({
    providers: [
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        shortName: 'Claude',
        command: 'claude',
        canBeDisabled: true,
        loginCommandHint: 'claude /login',
        authErrorPatterns: ['not authenticated'],
        visible: true,
      },
      {
        id: 'codex',
        displayName: 'OpenAI Codex',
        shortName: 'Codex',
        command: 'codex',
        canBeDisabled: true,
        visible: true,
      },
    ],
  }),
);

function state(overrides: Record<string, unknown> = {}) {
  const session = (id: string, workspaceId: string, name: string) =>
    ({
      id,
      backendSessionId: `backend-${id}`,
      createdAt: '2026-11-25T00:00:00.000Z',
      updatedAt: '2026-11-25T00:00:00.000Z',
      workspaceId,
      name,
      status: AgentStatus.Error,
      messages: [],
      provider: 'claude-code',
      model: 'opus',
    }) as AgentSession;
  return {
    agentSessions: {
      byAgentId: {
        'agent-1': session('agent-1', 'ws-1', 'Implementor'),
        'agent-2': session('agent-2', 'ws-2', 'Verifier'),
      },
    },
    workspace: {
      workspaces: {
        ids: ['ws-1', 'ws-2', 'ws-3'],
        map: {
          'ws-1': { id: 'ws-1', title: 'Fix login' } as Workspace,
          'ws-2': { id: 'ws-2', title: 'Dark mode' } as Workspace,
          'ws-3': { id: 'ws-3', title: 'Never opened' } as Workspace,
        },
      },
    },
    providerCatalog: catalog,
    providerSettings: { enabledProviders: {}, activeProviderId: '' },
    model: { providerModels: {} },
    agentAvailability: { providerLoadingMap: {} },
    tabState: { currentTabId: null },
    machineRail: { enabled: false, selectedId: '' },
    connections: { windowBackendId: 'local' },
    ...overrides,
  };
}

function quota(agentId: string, workspaceId: string, at: number, extra: object = {}) {
  recordAgentFailure({
    agentId,
    workspaceId,
    error: 'You have hit your weekly limit',
    errorCode: 'quota-exceeded',
    eventProviderId: 'claude-code',
    provider: 'claude-code',
    model: 'opus',
    at,
    ...extra,
  });
}

const GROUP = 'agent-failure-group:quota:claude-code';

function lastGroupToast() {
  const call = mocks.agentFailureGroup.mock.calls.filter(([, o]) => o.id === GROUP).at(-1);
  return call?.[0];
}

function start(overrides: Record<string, unknown> = {}) {
  const dispatch = vi.fn();
  const task = runSaga({ dispatch, getState: () => state(overrides) }, agentFailureToastSaga);
  return { dispatch, task };
}

describe('agent failure group toasts', () => {
  beforeEach(() => {
    clearAgentFailureRegistry();
    window.localStorage.clear();
    mocks.retry.mockResolvedValue({ ok: true, redriven: true });
    mocks.setModel.mockResolvedValue({ ok: true, data: { success: true } });
    mocks.eligible.mockReturnValue(['codex']);
    mocks.models.mockResolvedValue([
      { value: 'sol', label: 'Sol 6.2', isDefault: true },
      { value: 'luna', label: 'Luna' },
    ]);
  });
  afterEach(() => {
    clearAgentFailureRegistry();
    vi.clearAllMocks();
  });

  it('replaces the first per-agent toast with one group toast, and reverts at one member', async () => {
    const { task } = start();
    quota('agent-1', 'ws-1', 1);
    await settle();
    expect(mocks.agentFailure.mock.calls.at(-1)?.[1].id).toBe('agent-failure:agent-1');
    expect(mocks.agentFailureGroup).not.toHaveBeenCalled();

    quota('agent-2', 'ws-2', 2);
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');
    expect(
      mocks.agentFailure.mock.calls.filter(([, o]) => o.id === 'agent-failure:agent-2'),
    ).toEqual([]);
    expect(lastGroupToast()).toEqual(
      expect.objectContaining({
        title: 'Claude Code usage or rate limit reached — 2 agents',
        members: ['Implementor / Fix login', 'Verifier / Dark mode'],
        moreCount: 0,
      }),
    );

    mocks.agentFailure.mockClear();
    removeAgentFailure('agent-1');
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith(GROUP);
    expect(mocks.agentFailure.mock.calls.at(-1)?.[1].id).toBe('agent-failure:agent-2');
    task.cancel();
    await task.toPromise();
  });

  it('keeps non-groupable failures on per-agent toasts', async () => {
    const { task } = start();
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      error: 'spawn failed',
      provider: 'claude-code',
    });
    recordAgentFailure({
      agentId: 'agent-2',
      workspaceId: 'ws-2',
      error: 'spawn failed',
      provider: 'claude-code',
    });
    await settle();
    expect(mocks.agentFailureGroup).not.toHaveBeenCalled();
    expect(new Set(mocks.agentFailure.mock.calls.map(([, o]) => o.id))).toEqual(
      new Set(['agent-failure:agent-1', 'agent-failure:agent-2']),
    );
    task.cancel();
    await task.toPromise();
  });

  it('groups sign-in failures with the login command', async () => {
    const { task } = start();
    for (const [agentId, workspaceId] of [
      ['agent-1', 'ws-1'],
      ['agent-2', 'ws-2'],
    ]) {
      recordAgentFailure({
        agentId,
        workspaceId,
        error: 'claude-code is not authenticated',
        provider: 'claude-code',
        model: 'opus',
      });
    }
    await settle();
    const call = mocks.agentFailureGroup.mock.calls.at(-1);
    expect(call?.[1].id).toBe('agent-failure-group:auth:claude-code');
    expect(call?.[0]).toEqual(
      expect.objectContaining({
        title: 'Claude Code sign-in required — 2 agents',
        loginCommandHint: 'claude /login',
        onRunLogin: expect.any(Function),
        onSwitchAll: expect.any(Function),
        onRetryAll: expect.any(Function),
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('re-shows a closed group toast only when a new agent joins', async () => {
    const { task } = start();
    quota('agent-1', 'ws-1', 1);
    quota('agent-2', 'ws-2', 2);
    await settle();
    lastGroupToast().onClose();
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith(GROUP);
    mocks.agentFailureGroup.mockClear();

    quota('agent-2', 'ws-2', 3);
    await settle();
    expect(mocks.agentFailureGroup).not.toHaveBeenCalled();

    quota('agent-3', 'ws-3', 4, { agentName: 'Planner' });
    await settle();
    expect(lastGroupToast()?.title).toBe('Claude Code usage or rate limit reached — 3 agents');
    task.cancel();
    await task.toPromise();
  });

  it('shows the group when one member is elsewhere, and hides it when all are current', async () => {
    const { task } = start({ tabState: { currentTabId: 'ws-1' } });
    quota('agent-1', 'ws-1', 1);
    quota('agent-x', 'ws-1', 2, { agentName: 'Scout' });
    await settle();
    expect(mocks.agentFailureGroup).not.toHaveBeenCalled();

    quota('agent-2', 'ws-2', 3);
    await settle();
    expect(lastGroupToast()?.title).toBe('Claude Code usage or rate limit reached — 3 agents');
    task.cancel();
    await task.toPromise();
  });

  it('Retry all retries every member without a provider change', async () => {
    const { task, dispatch } = start();
    quota('agent-1', 'ws-1', 1);
    quota('agent-2', 'ws-2', 2);
    await settle();
    lastGroupToast().onRetryAll();
    await settle();
    expect(mocks.setModel).not.toHaveBeenCalled();
    expect(mocks.retry).toHaveBeenCalledWith('agent-1', 'ws-1');
    expect(mocks.retry).toHaveBeenCalledWith('agent-2', 'ws-2');
    expect(getAgentFailureEntry('agent-1')).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith(chatErrorCleared('agent-1'));
    expect(mocks.agentFailure).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  it('Switch all moves coordinators, unhydrated agents and their workers; unavailable agents stay', async () => {
    const { task } = start();
    quota('agent-1', 'ws-1', 1);
    quota('agent-2', 'ws-2', 2, { model: 'fable' });
    // A workspace never opened this session: no session, identity from agent.get.
    quota('agent-x', 'ws-3', 3, { agentName: 'Planner' });
    recordDelegatedAgentFailure({
      agentId: 'worker-1',
      parentAgentId: 'agent-1',
      workspaceId: 'ws-1',
      error: 'limit',
      errorCode: 'quota-exceeded',
      eventProviderId: 'claude-code',
      provider: 'claude-code',
    });
    recordDelegatedAgentFailure({
      agentId: 'worker-other',
      parentAgentId: 'agent-not-failed',
      workspaceId: 'ws-1',
      error: 'limit',
      errorCode: 'quota-exceeded',
      eventProviderId: 'claude-code',
      provider: 'claude-code',
    });
    mocks.eligible.mockImplementation((_state, _exhausted, workspaceId) =>
      workspaceId === 'ws-2' ? [] : ['codex'],
    );
    await settle();

    lastGroupToast().onSwitchAll();
    await settle();
    const dialog = get(providerSwitchDialog);
    expect(dialog.open).toBe(true);
    expect(dialog.loading).toBe(false);
    expect(
      dialog.rows.map((row) => [row.providerRef, row.model, row.agents.length, row.workerCount]),
    ).toEqual([
      ['claude-code', 'opus', 2, 1],
      ['claude-code', 'fable', 1, 0],
    ]);
    expect(dialog.rows[0].agents.map((agent) => agent.name)).toEqual(['Implementor', 'Planner']);
    expect(dialog.rows[0].selection).toEqual({ providerId: 'codex', modelId: 'sol' });
    expect(dialog.rows[1].targets).toEqual([]);

    dialog.actions?.select(dialog.rows[0].key, { providerId: 'codex', modelId: 'luna' });
    await settle();
    mocks.agentFailure.mockClear();
    get(providerSwitchDialog).actions?.confirm();
    await settle();

    const setModelCalls = mocks.setModel.mock.calls.map((c) => c.slice(0, 4).join(':'));
    expect(setModelCalls).toHaveLength(3);
    expect(setModelCalls).toEqual(
      expect.arrayContaining([
        'agent-1:luna:ws-1:codex',
        'worker-1:luna:ws-1:codex',
        'agent-x:luna:ws-3:codex',
      ]),
    );
    // A worker is switched before its coordinator restarts, and never retried.
    expect(
      mocks.setModel.mock.invocationCallOrder[setModelCalls.indexOf('worker-1:luna:ws-1:codex')],
    ).toBeLessThan(
      mocks.retry.mock.invocationCallOrder[
        mocks.retry.mock.calls.findIndex(([id]) => id === 'agent-1')
      ],
    );
    expect(mocks.retry.mock.calls).toEqual(
      expect.arrayContaining([
        ['agent-1', 'ws-1'],
        ['agent-x', 'ws-3'],
      ]),
    );
    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(getAgentFailureEntry('agent-1')).toBeUndefined();
    expect(getAgentFailureEntry('agent-x')).toBeUndefined();
    expect(getAgentFailureEntry('agent-2')).toBeDefined();
    expect(listDelegatedAgentFailures('agent-1')).toEqual([]);
    expect(listDelegatedAgentFailures('agent-not-failed')).toHaveLength(1);
    expect(getRememberedProviderSwitch('claude-code', 'opus')).toEqual({
      providerId: 'codex',
      modelId: 'luna',
    });

    const after = get(providerSwitchDialog);
    expect(after.finished).toBe(true);
    expect(after.progress).toEqual({ done: 3, total: 3 });
    expect(after.rows[0].workersSwitched).toBe(1);
    expect(after.rows[0].agents.map((agent) => agent.outcome?.status)).toEqual([
      'switched',
      'switched',
    ]);
    // agent-2 is left alone in the group, so it reverts to its per-agent toast.
    expect(new Set(mocks.agentFailure.mock.calls.map(([, o]) => o.id))).toEqual(
      new Set(['agent-failure:agent-2']),
    );

    after.actions?.close();
    await settle();
    expect(get(providerSwitchDialog).open).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('marks agents whose chosen target is unavailable and keeps a failed switch grouped', async () => {
    const { task } = start();
    quota('agent-1', 'ws-1', 1);
    quota('agent-2', 'ws-2', 2);
    mocks.eligible.mockImplementation((_state, _exhausted, workspaceId) =>
      workspaceId === 'ws-2' ? ['gemini'] : ['codex'],
    );
    mocks.setModel.mockResolvedValue({
      ok: true,
      data: { success: false, error: 'model rejected' },
    });
    await settle();
    lastGroupToast().onSwitchAll();
    await settle();
    get(providerSwitchDialog).actions?.confirm();
    await settle();

    const row = get(providerSwitchDialog).rows[0];
    expect(row.agents.map((agent) => [agent.agentId, agent.outcome])).toEqual([
      ['agent-1', { status: 'failed', reason: 'model rejected' }],
      ['agent-2', { status: 'unavailable' }],
    ]);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(getAgentFailureEntry('agent-1')).toBeDefined();
    expect(getAgentFailureEntry('agent-2')).toBeDefined();
    task.cancel();
    await task.toPromise();
  });

  it('prefills a remembered target next time, and ignores it once ineligible', async () => {
    window.localStorage.setItem(
      'agent-failure:provider-switch-choices',
      JSON.stringify({ 'claude-code|opus': { providerId: 'codex', modelId: 'luna', at: 1 } }),
    );
    const { task } = start();
    quota('agent-1', 'ws-1', 1);
    quota('agent-2', 'ws-2', 2);
    await settle();
    lastGroupToast().onSwitchAll();
    await settle();
    expect(get(providerSwitchDialog).rows[0].selection).toEqual({
      providerId: 'codex',
      modelId: 'luna',
    });
    get(providerSwitchDialog).actions?.close();

    mocks.eligible.mockReturnValue(['gemini']);
    lastGroupToast().onSwitchAll();
    await settle();
    expect(get(providerSwitchDialog).rows[0].selection).toEqual({
      providerId: 'gemini',
      modelId: 'sol',
    });
    task.cancel();
    await task.toPromise();
  });
});
