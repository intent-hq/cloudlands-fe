import { afterEach, describe, expect, it } from 'vitest';
import {
  UnbridgedMockIpcChannelError,
  mockInvoke,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import {
  MOCK_TRANSACTION_CHANNELS,
  MockTransactionAckLostError,
  createMockTransactionHarness,
} from './mock-transaction';
import { FIXED_IDS } from './scenarios';

afterEach(() => resetMockIpcRouter());

describe('new workspace mock transaction', () => {
  it('preserves loud rejection for unregistered channels', async () => {
    createMockTransactionHarness();
    await expect(mockInvoke('workspaceDraft.notReal')).rejects.toBeInstanceOf(
      UnbridgedMockIpcChannelError,
    );
  });

  it('replays the applied promotion after ACK loss and reconnect', async () => {
    const harness = createMockTransactionHarness();
    const params = { id: FIXED_IDS.draft, expectedRevision: 1 };
    const first = mockInvoke(MOCK_TRANSACTION_CHANNELS.draftPromote, params);
    expect(harness.loseAck()).toBe(true);
    await expect(first).rejects.toBeInstanceOf(MockTransactionAckLostError);

    await expect(mockInvoke(MOCK_TRANSACTION_CHANNELS.draftPromote, params)).rejects.toThrow(
      'disconnected',
    );
    harness.reconnect();
    await expect(mockInvoke(MOCK_TRANSACTION_CHANNELS.draftPromote, params)).resolves.toMatchObject(
      {
        workspace: { id: FIXED_IDS.workspace },
      },
    );
    expect(harness.callLog.at(-1)?.status).toBe('replayed');
  });

  it('can resolve controlled operations out of request order', async () => {
    const harness = createMockTransactionHarness();
    let firstSettled = false;
    const first = mockInvoke(MOCK_TRANSACTION_CHANNELS.clone, {
      operationKey: FIXED_IDS.operation,
    });
    void first.finally(() => (firstSettled = true));
    const second = mockInvoke(MOCK_TRANSACTION_CHANNELS.setup, {
      workspaceId: FIXED_IDS.workspace,
    });
    const [firstId, secondId] = harness.pendingOperationIds;

    expect(harness.advance(secondId)).toBe(true);
    await expect(second).resolves.toMatchObject({ state: 'succeeded' });
    expect(firstSettled).toBe(false);
    expect(harness.callLog.find((entry) => entry.id === firstId)?.status).toBe('pending');

    harness.advance(firstId);
    await expect(first).resolves.toMatchObject({ phase: 'complete' });
  });
});
