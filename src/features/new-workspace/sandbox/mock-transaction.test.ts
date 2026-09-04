import { describe, expect, it } from 'vitest';
import { UnbridgedMockIpcChannelError, mockInvoke } from '$shared/ipc-mock-router';
import {
  MOCK_TRANSACTION_CHANNELS,
  MockDraftConflictError,
  MockTransactionAckLostError,
  MockTransactionRejectedError,
  createMockTransactionHarness,
} from './mock-transaction';
import { DEFAULT_SCENARIO_FIXTURES, FIXED_IDS } from './scenarios';

describe('new workspace mock transaction', () => {
  it('does not register handlers on the shared renderer IPC router', async () => {
    createMockTransactionHarness();
    await expect(mockInvoke(MOCK_TRANSACTION_CHANNELS.draftPromote)).rejects.toBeInstanceOf(
      UnbridgedMockIpcChannelError,
    );
  });

  it('replays the applied promotion after ACK loss and reconnect', async () => {
    const harness = createMockTransactionHarness();
    const first = harness.workspaceDrafts.promote(FIXED_IDS.draft, 1);
    expect(harness.loseAck()).toBe(true);
    await expect(first).rejects.toBeInstanceOf(MockTransactionAckLostError);

    await expect(harness.workspaceDrafts.promote(FIXED_IDS.draft, 1)).rejects.toThrow(
      'disconnected',
    );
    harness.reconnect();
    await expect(harness.workspaceDrafts.get(FIXED_IDS.draft)).resolves.toMatchObject({
      phase: 'promoted',
      promotedWorkspaceId: FIXED_IDS.workspace,
    });
    await expect(harness.workspaceDrafts.promote(FIXED_IDS.draft, 1)).resolves.toMatchObject({
      workspace: { id: FIXED_IDS.workspace },
    });
    expect(harness.callLog.at(-1)?.status).toBe('replayed');
  });

  it('returns the protocol revision-conflict code and current draft', async () => {
    const harness = createMockTransactionHarness();
    const update = harness.workspaceDrafts.update(FIXED_IDS.draft, 0, { intentText: 'stale' });

    await expect(update).rejects.toMatchObject({
      rpcCode: -32009,
      data: { current: { id: FIXED_IDS.draft, revision: 1 } },
    });
    await expect(update).rejects.toBeInstanceOf(MockDraftConflictError);
  });

  it('surfaces controlled promotion failure as a daemon-shaped client error', async () => {
    const harness = createMockTransactionHarness();
    const promotion = harness.workspaceDrafts.promote(FIXED_IDS.draft, 1);

    expect(harness.reject()).toBe(true);
    await expect(promotion).rejects.toBeInstanceOf(MockTransactionRejectedError);
    await expect(promotion).rejects.toMatchObject({ rpcCode: -32000 });
  });

  it('can resolve controlled operations out of request order', async () => {
    const harness = createMockTransactionHarness();
    let firstSettled = false;
    const first = harness.invokeScriptStep({
      channel: MOCK_TRANSACTION_CHANNELS.clone,
      params: { operationKey: FIXED_IDS.operation },
    });
    void first.finally(() => (firstSettled = true));
    const second = harness.invokeScriptStep({
      channel: MOCK_TRANSACTION_CHANNELS.setup,
      params: { workspaceId: FIXED_IDS.workspace },
    });
    const [firstId, secondId] = harness.pendingOperationIds;

    expect(harness.advance(secondId)).toBe(true);
    await expect(second).resolves.toMatchObject({ state: 'succeeded' });
    expect(firstSettled).toBe(false);
    expect(harness.callLog.find((entry) => entry.id === firstId)?.status).toBe('pending');

    harness.advance(firstId);
    await expect(first).resolves.toMatchObject({ phase: 'complete' });
  });

  it('supports the unknown setup outcome without renderer IPC registration', async () => {
    const harness = createMockTransactionHarness({
      ...DEFAULT_SCENARIO_FIXTURES,
      setupResult: { state: 'unknown' },
    });
    const setup = harness.invokeScriptStep({
      channel: MOCK_TRANSACTION_CHANNELS.setup,
      params: { workspaceId: FIXED_IDS.workspace },
    });

    harness.advance();
    await expect(setup).resolves.toEqual({ state: 'unknown' });
  });
});
