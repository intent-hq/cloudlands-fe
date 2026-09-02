import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
  navigateToRoute: vi.fn(async () => {}),
  resolveKeySlot: vi.fn((workspaceId: string | undefined) => (workspaceId === 'ws-1' ? 3 : null)),
}));
vi.mock('$lib/client', () => ({ appClient: { agents: { retry: mocks.retry } } }));
vi.mock('svelte-sonner', () => ({
  toast: { custom: mocks.custom, dismiss: mocks.dismiss },
}));
vi.mock('$lib/components/ui/toast/AgentFailureToast.svelte', () => ({
  default: 'AgentFailureToast',
}));
vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: mocks.navigateToRoute,
}));
vi.mock('$features/hardware-console/assignment/connected-key-slot', () => ({
  resolveConnectedWorkspaceKeySlot: mocks.resolveKeySlot,
}));

import {
  clearAgentFailureRegistry,
  getAgentFailureEntry,
  recordAgentFailure,
} from '$features/agent/agent-failure-registry';
import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { checkSingleProviderRequested } from '../../agent-availability/agent-availability-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../../provider-catalog/provider-catalog-slice';
import { openPanel, setChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-slice';
import { agentFailureToastSaga } from './agent-failure-toast-saga';

const settle = async () => {
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const catalogPayload = {
  providers: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      shortName: 'Claude',
      command: 'claude',
      canBeDisabled: true,
      loginCommandHint: 'claude /login',
      authErrorPatterns: ['authentication required'],
      visible: true,
    },
  ],
};

const hydratedProviderCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(catalogPayload),
);

function state(overrides: Record<string, unknown> = {}) {
  const first = {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Implementor',
    status: AgentStatus.Error,
    messages: [],
    provider: 'claude-code',
  } as AgentSession;
  const second = { ...first, id: 'agent-2', workspaceId: 'ws-2', name: 'Verifier' };
  const chief = { ...first, id: 'agent-chief', workspaceId: CHIEF_WORKSPACE_ID, name: 'Chief' };
  const firstWorkspace = { id: 'ws-1', title: 'Fix login' } as Workspace;
  const secondWorkspace = { id: 'ws-2', title: 'Dark mode' } as Workspace;
  return {
    agentSessions: {
      byAgentId: { 'agent-1': first, 'agent-2': second, 'agent-chief': chief },
    },
    workspace: {
      workspaces: {
        ids: ['ws-1', 'ws-2'],
        map: { 'ws-1': firstWorkspace, 'ws-2': secondWorkspace },
      },
    },
    providerCatalog: hydratedProviderCatalog,
    providerSettings: { enabledProviders: {}, activeProviderId: '' },
    model: { providerModels: {} },
    agentAvailability: { providerLoadingMap: {} },
    ...overrides,
  };
}

function lastToast(id: string) {
  return mocks.custom.mock.calls.filter(([, options]) => options.id === id).at(-1)?.[1];
}

describe('agentFailureToastSaga', () => {
  beforeEach(() => clearAgentFailureRegistry());
  afterEach(() => {
    clearAgentFailureRegistry();
    vi.clearAllMocks();
  });

  it('renders one stable per-agent toast with per-agent props — no grouping', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'spawn failed: EPERM' });
    await settle();

    const first = lastToast('agent-failure:agent-1');
    expect(first?.componentProps).toEqual(
      expect.objectContaining({
        title: 'Implementor failed',
        errorSummary: 'spawn failed: EPERM',
        contextLine: 'Implementor — Fix login',
        retryLabel: 'Retry Implementor',
        retrying: false,
        keySlot: 3,
        onRetry: expect.any(Function),
        onSwitchTo: expect.any(Function),
        onClose: expect.any(Function),
      }),
    );
    expect(first?.componentProps).not.toHaveProperty('detailLines');
    // Non-auth failure: no login guidance, no forced auth-status refresh.
    expect(first?.componentProps.loginCommandHint).toBeUndefined();
    expect(first?.componentProps.showClaudeDesktopNote).toBe(false);
    // Same error text still renders a SECOND toast — one per agent.
    expect(lastToast('agent-failure:agent-2')?.componentProps).toEqual(
      expect.objectContaining({
        title: 'Verifier failed',
        contextLine: 'Verifier — Dark mode',
        retryLabel: 'Retry Verifier',
        keySlot: null,
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('auth failure carries login guidance and dispatches ONE forced auth-status refresh', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      error: 'JSON-RPC error -32000: Authentication required',
      at: 1000,
    });
    await settle();

    // The toast renders the catalog login hint + the claude desktop caveat
    // alongside (not instead of) the raw error summary.
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({
        errorSummary: 'JSON-RPC error -32000: Authentication required',
        loginCommandHint: 'claude /login',
        showClaudeDesktopNote: true,
      }),
    );
    // Forced provider auth-status refresh — the worker probes with force:true.
    expect(dispatch).toHaveBeenCalledWith(checkSingleProviderRequested('claude-code'));

    // A re-render of the SAME failure (manual close) must not re-probe.
    lastToast('agent-failure:agent-1').componentProps.onClose();
    await settle();
    const refreshCalls = () =>
      dispatch.mock.calls.filter(
        ([action]) => action?.type === checkSingleProviderRequested('claude-code').type,
      ).length;
    expect(refreshCalls()).toBe(1);

    // A NEWER auth failure refreshes again.
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      error: 'JSON-RPC error -32000: Authentication required',
      at: 2000,
    });
    await settle();
    expect(refreshCalls()).toBe(2);
    task.cancel();
    await task.toPromise();
  });

  it('a same-provider failure burst dispatches ONE refresh, not one per agent', async () => {
    // Mirrors the real store: the first checkSingleProviderRequested flips
    // the provider's loading flag synchronously, so the second agent's
    // render sees it and skips the redundant concurrent probe.
    const loadingMap: Record<string, boolean> = {};
    const dispatch = vi.fn((action: { type?: string; payload?: [string] }) => {
      if (action?.type === checkSingleProviderRequested('x').type) {
        loadingMap[action.payload![0]] = true;
      }
      return action;
    });
    const getState = () => state({ agentAvailability: { providerLoadingMap: loadingMap } });
    const task = runSaga({ dispatch, getState }, agentFailureToastSaga);
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      error: 'JSON-RPC error -32000: Authentication required',
      at: 1000,
    });
    recordAgentFailure({
      agentId: 'agent-2',
      workspaceId: 'ws-2',
      error: 'JSON-RPC error -32000: Authentication required',
      at: 1000,
    });
    await settle();

    expect(
      dispatch.mock.calls.filter(
        ([action]) => action?.type === checkSingleProviderRequested('claude-code').type,
      ),
    ).toHaveLength(1);
    // Both toasts still carry the login guidance.
    expect(lastToast('agent-failure:agent-1').componentProps.loginCommandHint).toBe(
      'claude /login',
    );
    expect(lastToast('agent-failure:agent-2').componentProps.loginCommandHint).toBe(
      'claude /login',
    );
    task.cancel();
    await task.toPromise();
  });

  it('a failure rendered before catalog hydration gains guidance once the catalog lands', async () => {
    let providerCatalog = providerCatalogInitialState;
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => state({ providerCatalog }) },
      agentFailureToastSaga,
    );
    recordAgentFailure({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      error: 'JSON-RPC error -32000: Authentication required',
      at: 1000,
    });
    await settle();

    // Pre-hydration: no rows to match against — no guidance, no refresh.
    expect(lastToast('agent-failure:agent-1').componentProps.loginCommandHint).toBeUndefined();
    expect(
      dispatch.mock.calls.filter(
        ([action]) => action?.type === checkSingleProviderRequested('claude-code').type,
      ),
    ).toHaveLength(0);

    // Catalog hydration re-renders the unchanged entry with guidance and
    // fires the deferred forced refresh.
    providerCatalog = hydratedProviderCatalog;
    channel.put(providerCatalogLoaded(catalogPayload));
    await settle();

    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({
        loginCommandHint: 'claude /login',
        showClaudeDesktopNote: true,
      }),
    );
    expect(
      dispatch.mock.calls.filter(
        ([action]) => action?.type === checkSingleProviderRequested('claude-code').type,
      ),
    ).toHaveLength(1);
    task.cancel();
    await task.toPromise();
  });

  it('non-auth failures dispatch no provider refresh', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    await settle();

    expect(
      dispatch.mock.calls.filter(
        ([action]) => action?.type === checkSingleProviderRequested('claude-code').type,
      ),
    ).toHaveLength(0);
    task.cancel();
    await task.toPromise();
  });

  it('Switch To navigates to the workspace and opens the agent tab WITHOUT retrying', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onSwitchTo();
    await settle();

    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatch).toHaveBeenCalledWith(openAgentTabRequested('ws-1', { agentId: 'agent-1' }));
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(getAgentFailureEntry('agent-1')).toBeDefined();
    task.cancel();
    await task.toPromise();
  });

  it('Switch To on a chief-of-staff failure opens the sidebar Assistant panel', async () => {
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({
      agentId: 'agent-chief',
      workspaceId: CHIEF_WORKSPACE_ID,
      error: 'boom',
    });
    await settle();

    lastToast('agent-failure:agent-chief').componentProps.onSwitchTo();
    await settle();

    expect(dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('agent-chief'));
    expect(dispatch).toHaveBeenCalledWith(openPanel('chief'));
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('Retry retries the one agent, navigates, and removes the entry on ok:true', async () => {
    mocks.retry.mockResolvedValue({ ok: true });
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();

    expect(mocks.retry.mock.calls).toEqual([['agent-1', 'ws-1']]);
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatch).toHaveBeenCalledWith(openAgentTabRequested('ws-1', { agentId: 'agent-1' }));
    expect(getAgentFailureEntry('agent-1')).toBeUndefined();
    expect(getAgentFailureEntry('agent-2')).toBeDefined();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');
    task.cancel();
    await task.toPromise();
  });

  it('Retry ok:false keeps the entry, still navigates, and shows the failure note', async () => {
    mocks.retry.mockResolvedValue({ ok: false });
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();

    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(getAgentFailureEntry('agent-1')).toBeDefined();
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ retrying: false, retryNote: 'Retry failed' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('Retry notFound removes the entry and dismisses the toast — no permanent Retry failed state (#2806)', async () => {
    // The daemon rejected agent.retry with the not-found discriminator: the
    // agent was deleted while the toast sat open. The stale entry must be
    // dropped and the toast dismissed instead of keep-and-note.
    mocks.retry.mockResolvedValue({ ok: false, notFound: true, error: 'Agent agent-1 not found' });
    const dispatch = vi.fn();
    const task = runSaga({ dispatch, getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();

    expect(getAgentFailureEntry('agent-1')).toBeUndefined();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');
    // No failure-note re-render after the dismissal: the last render carries
    // no retryNote at all (asserting absence, not a specific i18n string).
    expect(lastToast('agent-failure:agent-1').componentProps.retryNote).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('stale notFound does not erase a re-failure that landed during the retry', async () => {
    // Mirrors the stale-ok:true guard: a NEWER failure recorded while the
    // not-found retry was in flight (e.g. the agent was recreated and failed
    // again) must survive the stale not-found result.
    let resolveRetry!: (value: { ok: false; notFound: true; error: string }) => void;
    mocks.retry.mockImplementation(
      () =>
        new Promise<{ ok: false; notFound: true; error: string }>(
          (resolve) => (resolveRetry = resolve),
        ),
    );
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'new boom', at: 2000 });
    resolveRetry({ ok: false, notFound: true, error: 'Agent agent-1 not found' });
    await settle();

    expect(getAgentFailureEntry('agent-1')?.error).toBe('new boom');
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ errorSummary: 'new boom', retrying: false }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('stale ok:true does not erase a re-failure that landed during the retry', async () => {
    let resolveRetry!: (value: { ok: boolean }) => void;
    mocks.retry.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => (resolveRetry = resolve)),
    );
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'new boom', at: 2000 });
    resolveRetry({ ok: true });
    await settle();

    expect(getAgentFailureEntry('agent-1')?.error).toBe('new boom');
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ errorSummary: 'new boom', retrying: false }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('manual close during an in-flight retry stays hidden after an ok:false retry', async () => {
    let resolveRetry!: (value: { ok: boolean }) => void;
    mocks.retry.mockImplementation(
      () => new Promise<{ ok: boolean }>((resolve) => (resolveRetry = resolve)),
    );
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onRetry();
    await settle();
    lastToast('agent-failure:agent-1').componentProps.onClose();
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');

    const callsAfterClose = mocks.custom.mock.calls.length;
    resolveRetry({ ok: false });
    await settle();
    // The failed retry must NOT resurrect the manually dismissed toast.
    expect(mocks.custom).toHaveBeenCalledTimes(callsAfterClose);
    expect(getAgentFailureEntry('agent-1')).toBeDefined();

    // A NEWER failure during/after that window still re-shows the toast.
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom again', at: 2000 });
    await settle();
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ errorSummary: 'boom again' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('manual close hides the toast until a NEWER failure lands for that agent', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();

    lastToast('agent-failure:agent-1').componentProps.onClose();
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');
    expect(getAgentFailureEntry('agent-1')).toBeDefined();

    const callsAfterClose = mocks.custom.mock.calls.length;
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await settle();
    expect(mocks.custom).toHaveBeenCalledTimes(callsAfterClose);

    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom again', at: 2000 });
    await settle();
    expect(lastToast('agent-failure:agent-1').componentProps).toEqual(
      expect.objectContaining({ errorSummary: 'boom again' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('unsubscribes and dismisses owned toasts on cancellation', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: state }, agentFailureToastSaga);
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await settle();
    const callsBeforeCancel = mocks.custom.mock.calls.length;
    task.cancel();
    await task.toPromise();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-failure:agent-1');

    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'different' });
    await settle();
    expect(mocks.custom).toHaveBeenCalledTimes(callsBeforeCancel);
  });
});
