import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  setModel: vi.fn(),
  applyReasoningEffort: vi.fn(),
  reconcileAgentReasoningEffort: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: mocks.dispatch });
});
vi.mock('$features/agent/agent.client', () => ({
  agentClient: { setModel: mocks.setModel },
}));
vi.mock('$features/agent/reasoning-effort', () => ({
  applyReasoningEffort: mocks.applyReasoningEffort,
  reconcileAgentReasoningEffort: mocks.reconcileAgentReasoningEffort,
}));

import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  SKIPPED_MUTATION,
  createAgentModelMutator,
  isSkippedMutation,
} from './agent-model-mutator';

const AGENT = 'agent-1';
const WORKSPACE = 'ws-1';
const SET_MODEL_OK = { ok: true as const, data: { success: true, modelId: 'auggie:sonnet4.6' } };

function expectNoUnderlyingCalls() {
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.setModel).not.toHaveBeenCalled();
  expect(mocks.reconcileAgentReasoningEffort).not.toHaveBeenCalled();
  expect(mocks.applyReasoningEffort).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setModel.mockResolvedValue(SET_MODEL_OK);
  mocks.reconcileAgentReasoningEffort.mockResolvedValue(true);
  mocks.applyReasoningEffort.mockResolvedValue(true);
});

describe('createAgentModelMutator — locked', () => {
  it('skips every mutation without touching the store, the RPC, or the effort writers', async () => {
    const mutator = createAgentModelMutator({ isLocked: () => true });

    expect(mutator.setSessionModel(AGENT, 'auggie:sonnet4.6')).toBe(false);
    const setModelResult = await mutator.setModel(AGENT, 'auggie:sonnet4.6', WORKSPACE, 'auggie');
    expect(setModelResult).toBe(SKIPPED_MUTATION);
    expect(isSkippedMutation(setModelResult)).toBe(true);
    await expect(mutator.reconcileEffort(AGENT, WORKSPACE, 'high', ['low', 'high'])).resolves.toBe(
      false,
    );
    await expect(mutator.applyEffort(AGENT, WORKSPACE, 'low', 'high')).resolves.toBe(false);

    expectNoUnderlyingCalls();
  });
});

describe('createAgentModelMutator — unlocked', () => {
  const mutator = createAgentModelMutator({ isLocked: () => false });

  it('setSessionModel dispatches the agent-session updateSession action', () => {
    expect(mutator.setSessionModel(AGENT, 'auggie:sonnet4.6')).toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      updateSession(AGENT, { model: 'auggie:sonnet4.6' }),
    );
  });

  it('setModel forwards the exact arguments and returns the RPC result', async () => {
    const result = await mutator.setModel(AGENT, 'auggie:sonnet4.6', WORKSPACE, 'auggie');
    expect(mocks.setModel).toHaveBeenCalledWith(AGENT, 'auggie:sonnet4.6', WORKSPACE, 'auggie');
    expect(result).toBe(SET_MODEL_OK);
    expect(isSkippedMutation(result)).toBe(false);
  });

  it('setModel forwards an omitted providerId as undefined', async () => {
    await mutator.setModel(AGENT, 'auggie:sonnet4.6', WORKSPACE);
    expect(mocks.setModel).toHaveBeenCalledWith(AGENT, 'auggie:sonnet4.6', WORKSPACE, undefined);
  });

  it('reconcileEffort forwards the exact arguments and returns the writer result', async () => {
    mocks.reconcileAgentReasoningEffort.mockResolvedValueOnce(false);
    await expect(mutator.reconcileEffort(AGENT, WORKSPACE, 'high', ['low', 'high'])).resolves.toBe(
      false,
    );
    expect(mocks.reconcileAgentReasoningEffort).toHaveBeenCalledWith(
      AGENT,
      WORKSPACE,
      'high',
      ['low', 'high'],
      { canMutate: expect.any(Function) },
    );
  });

  it('applyEffort forwards the exact arguments and returns the writer result', async () => {
    await expect(mutator.applyEffort(AGENT, WORKSPACE, null, 'high')).resolves.toBe(true);
    expect(mocks.applyReasoningEffort).toHaveBeenCalledWith(AGENT, WORKSPACE, null, 'high', {
      canMutate: expect.any(Function),
    });
  });
});

describe('createAgentModelMutator — canMutate handed to the effort writers', () => {
  function canMutateOf(mock: ReturnType<typeof vi.fn>): () => boolean {
    const options = mock.mock.calls.at(-1)?.at(-1) as { canMutate?: () => boolean } | undefined;
    if (!options?.canMutate) throw new Error('writer was not given canMutate');
    return options.canMutate;
  }

  it('applyEffort passes a canMutate that reflects the live lock, not the entry check', async () => {
    let locked = false;
    const mutator = createAgentModelMutator({ isLocked: () => locked });
    let canMutateDuringRpc: boolean | undefined;
    let canMutateAfterFlip: boolean | undefined;
    mocks.applyReasoningEffort.mockImplementationOnce(async () => {
      const canMutate = canMutateOf(mocks.applyReasoningEffort);
      canMutateDuringRpc = canMutate();
      // The role flips while the mocked RPC is still pending.
      locked = true;
      canMutateAfterFlip = canMutate();
      return false;
    });

    await expect(mutator.applyEffort(AGENT, WORKSPACE, 'low', 'high')).resolves.toBe(false);
    expect(canMutateDuringRpc).toBe(true);
    expect(canMutateAfterFlip).toBe(false);
  });

  it('reconcileEffort passes a canMutate that reflects the live lock', async () => {
    let locked = false;
    const mutator = createAgentModelMutator({ isLocked: () => locked });

    await mutator.reconcileEffort(AGENT, WORKSPACE, 'high', ['low']);
    const canMutate = canMutateOf(mocks.reconcileAgentReasoningEffort);
    expect(canMutate()).toBe(true);
    locked = true;
    expect(canMutate()).toBe(false);
  });
});

describe('createAgentModelMutator — call-time lock evaluation', () => {
  it('evaluates the lock on every call, not at construction', async () => {
    let locked = false;
    const isLocked = vi.fn(() => locked);
    const mutator = createAgentModelMutator({ isLocked });
    expect(isLocked).not.toHaveBeenCalled();

    const first = await mutator.setModel(AGENT, 'auggie:sonnet4.6', WORKSPACE, 'auggie');
    expect(first).toBe(SET_MODEL_OK);
    expect(mocks.setModel).toHaveBeenCalledTimes(1);

    locked = true;
    const second = await mutator.setModel(AGENT, 'auggie:opus4.6', WORKSPACE, 'auggie');
    expect(second).toBe(SKIPPED_MUTATION);
    expect(mocks.setModel).toHaveBeenCalledTimes(1);
    expect(isLocked).toHaveBeenCalledTimes(2);
  });

  it('a lock flip between a model write and the follow-up effort reconcile skips the reconcile', async () => {
    let locked = false;
    const mutator = createAgentModelMutator({ isLocked: () => locked });

    await mutator.setModel(AGENT, 'auggie:sonnet4.6', WORKSPACE, 'auggie');
    expect(mocks.setModel).toHaveBeenCalledTimes(1);

    locked = true;
    await expect(mutator.reconcileEffort(AGENT, WORKSPACE, 'high', ['low'])).resolves.toBe(false);
    expect(mutator.setSessionModel(AGENT, 'auggie:sonnet4.6')).toBe(false);
    expect(mocks.reconcileAgentReasoningEffort).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();

    locked = false;
    await expect(mutator.applyEffort(AGENT, WORKSPACE, 'low', 'high')).resolves.toBe(true);
    expect(mocks.applyReasoningEffort).toHaveBeenCalledWith(AGENT, WORKSPACE, 'low', 'high', {
      canMutate: expect.any(Function),
    });
  });
});
