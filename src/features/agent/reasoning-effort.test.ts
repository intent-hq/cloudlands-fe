/**
 * applyReasoningEffort — the session-level reasoning-effort writer behind the
 * chat-input effort control. FAKE client/store seams only, covering both the
 * first-class protocol 5.2 wire and the legacy compound-model wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetReasoningEffort = vi.hoisted(() =>
  vi.fn(
    async (_params: { agentId: string; workspaceId: string; reasoningEffort: string | null }) =>
      ({ success: true }) as { success: boolean; error?: string },
  ),
);
const mockSetModel = vi.hoisted(() =>
  vi.fn(async (_agentId: string, modelId: string) => ({
    ok: true as const,
    data: { success: true, modelId },
  })),
);
const mockToastError = vi.hoisted(() => vi.fn());
// The writer re-reads the session before rolling back, so the fake store keeps
// a mutable `reasoningEffort` that dispatches mirror — that is what lets a
// concurrent change be observed.
const storeState = vi.hoisted(() => ({
  agentSessions: {
    byAgentId: {} as Record<
      string,
      {
        reasoningEffort?: string | null;
        model?: string;
        provider?: string;
        metadata?: { provider?: string };
      }
    >,
  },
  daemonHealth: { stats: { protocolVersion: '6.1' } },
}));
const mockDispatch = vi.hoisted(() => vi.fn());

vi.mock('$lib/client', () => ({
  appClient: { agents: { setReasoningEffort: mockSetReasoningEffort } },
}));
vi.mock('./agent.client', () => ({ agentClient: { setModel: mockSetModel } }));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mockDispatch,
    get state() {
      return storeState;
    },
  },
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentProvider: {
    select: (_state: unknown, agentId: string) => {
      const session = storeState.agentSessions.byAgentId[agentId];
      return session?.provider ?? session?.metadata?.provider;
    },
  },
}));
vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAgentModelEffortLevels: {
    select: (_state: unknown, agentId: string) => {
      const model = storeState.agentSessions.byAgentId[agentId]?.model;
      return model?.startsWith('gpt5.6-')
        ? ['none', 'low', 'medium', 'high', 'xhigh', 'max']
        : ['low', 'medium', 'high', 'xhigh'];
    },
  },
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mockToastError } }));

import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { applyReasoningEffort } from './reasoning-effort';

function setStoredEffort(agentId: string, effort: string | null) {
  storeState.agentSessions.byAgentId[agentId] = {
    ...storeState.agentSessions.byAgentId[agentId],
    reasoningEffort: effort,
  };
}

describe('applyReasoningEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetReasoningEffort.mockResolvedValue({ success: true });
    mockSetModel.mockImplementation(async (_agentId: string, modelId: string) => ({
      ok: true,
      data: { success: true, modelId },
    }));
    storeState.agentSessions.byAgentId = {};
    storeState.daemonHealth.stats.protocolVersion = '6.1';
    mockDispatch.mockImplementation((action: { payload?: unknown[] }) => {
      const [agentId, patch] = (action.payload ?? []) as [
        string,
        { reasoningEffort?: string | null },
      ];
      if (agentId && patch && 'reasoningEffort' in patch) {
        setStoredEffort(agentId, patch.reasoningEffort ?? null);
      }
    });
  });

  it('dispatches the session field optimistically then forwards the mutation', async () => {
    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'high', null);

    expect(applied).toBe(true);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      updateSession('agent-1', { reasoningEffort: 'high' }),
    );
    expect(mockSetReasoningEffort).toHaveBeenCalledWith({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      reasoningEffort: 'high',
    });
  });

  it('forwards an explicit null to clear back to the provider default', async () => {
    await applyReasoningEffort('agent-1', 'ws-1', null, 'high');

    expect(mockSetReasoningEffort).toHaveBeenCalledWith({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      reasoningEffort: null,
    });
  });

  it('uses the protocol 5.1 compound-model wire for a legacy effort change', async () => {
    storeState.daemonHealth.stats.protocolVersion = '5.1';
    storeState.agentSessions.byAgentId['agent-1'] = {
      reasoningEffort: null,
      model: 'gpt-5.3-codex',
      provider: 'codex',
    };

    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'high', null);

    expect(applied).toBe(true);
    expect(mockSetReasoningEffort).not.toHaveBeenCalled();
    expect(mockSetModel).toHaveBeenCalledWith('agent-1', 'gpt-5.3-codex/high', 'ws-1', 'codex');
  });

  it('resolves a legacy provider from session metadata before building the model id', async () => {
    storeState.daemonHealth.stats.protocolVersion = '5.1';
    storeState.agentSessions.byAgentId['agent-1'] = {
      reasoningEffort: null,
      model: 'gpt-5.1-codex',
      metadata: { provider: 'codex' },
    };

    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'high', null);

    expect(applied).toBe(true);
    expect(mockSetModel).toHaveBeenCalledWith('agent-1', 'gpt-5.1-codex/high', 'ws-1', 'codex');
  });

  it('uses catalog-advertised legacy effort variants for an Auggie model', async () => {
    storeState.daemonHealth.stats.protocolVersion = '5.1';
    storeState.agentSessions.byAgentId['agent-1'] = {
      reasoningEffort: null,
      model: 'gpt5.6-sol',
      provider: 'auggie',
    };

    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'max', null);

    expect(applied).toBe(true);
    expect(mockSetReasoningEffort).not.toHaveBeenCalled();
    expect(mockSetModel).toHaveBeenCalledWith('agent-1', 'gpt5.6-sol/max', 'ws-1', 'auggie');
  });

  it('clears a protocol 5.1 effort by selecting the legacy base model', async () => {
    storeState.daemonHealth.stats.protocolVersion = '5.1';
    storeState.agentSessions.byAgentId['agent-1'] = {
      reasoningEffort: 'high',
      model: 'gpt-5.3-codex/high',
      provider: 'codex',
    };

    await applyReasoningEffort('agent-1', 'ws-1', null, 'high');

    expect(mockSetModel).toHaveBeenCalledWith('agent-1', 'gpt-5.3-codex', 'ws-1', 'codex');
  });

  it('reverts to the previous effort and surfaces the error on rejection', async () => {
    mockSetReasoningEffort.mockResolvedValue({ success: false, error: 'unsupported' });

    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'xhigh', 'low');

    expect(applied).toBe(false);
    expect(mockDispatch).toHaveBeenLastCalledWith(
      updateSession('agent-1', { reasoningEffort: 'low' }),
    );
    expect(mockToastError).toHaveBeenCalledWith('unsupported');
  });

  it('does not clobber a newer effort that landed while the mutation was in flight', async () => {
    mockSetReasoningEffort.mockImplementation(async ({ agentId }) => {
      // A second change (or a daemon `agent:updated`) wins the race.
      setStoredEffort(agentId, 'medium');
      return { success: false, error: 'unsupported' };
    });

    const applied = await applyReasoningEffort('agent-1', 'ws-1', 'xhigh', 'low');

    expect(applied).toBe(false);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(storeState.agentSessions.byAgentId['agent-1']?.reasoningEffort).toBe('medium');
  });
});
