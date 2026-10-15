import { describe, expect, it, vi } from 'vitest';
import { createBackendChatCommands } from './backend-chat-commands';

function client(response: unknown, error?: unknown) {
  const wire = vi.fn();
  const request = vi.fn(
    async <T>(
      _method: string,
      _params?: unknown,
      options?: { onDispatch?: () => void },
    ): Promise<T> => {
      options?.onDispatch?.();
      wire(_method, _params);
      if (error) throw error;
      return response as T;
    },
  );
  return { api: createBackendChatCommands(request), wire };
}
const options = () => ({ requireRemovalReceipt: true as const, onDispatch: vi.fn() });

describe('strict queue removal wire contract', () => {
  it('sends only captured IDs and interprets the idempotent ack as absence', async () => {
    const { api, wire } = client({ success: true });
    const opts = options();
    await expect(api.removeQueued('a', 'q', 'w', opts)).resolves.toEqual({
      success: true,
      removalOutcome: 'no-longer-queued',
    });
    expect(wire).toHaveBeenCalledExactlyOnceWith('agent.removeQueuedMessage', {
      agentId: 'a',
      messageId: 'q',
      workspaceId: 'w',
    });
    expect(opts.onDispatch).toHaveBeenCalledOnce();
  });
  it.each([undefined, null, {}, [], { success: false }, { success: 'true' }, { ok: true }])(
    'does not promote malformed/missing receipts to success: %j',
    async (body) => {
      await expect(client(body).api.removeQueued('a', 'q', 'w', options())).resolves.toMatchObject({
        success: false,
        removalOutcome: 'unknown',
      });
    },
  );
  it.each([-32600, -32601, -32602, -32003])(
    'keeps definite refusal %s distinct',
    async (rpcCode) => {
      await expect(
        client(undefined, Object.assign(new Error('refused'), { rpcCode })).api.removeQueued(
          'a',
          'q',
          'w',
          options(),
        ),
      ).resolves.toMatchObject({ success: false, removalOutcome: 'failed' });
    },
  );
  it.each([new Error('offline'), Object.assign(new Error('internal'), { rpcCode: -32603 })])(
    'retains uncertainty after possible dispatch: %j',
    async (error) => {
      await expect(
        client(undefined, error).api.removeQueued('a', 'q', 'w', options()),
      ).resolves.toMatchObject({ success: false, removalOutcome: 'unknown' });
    },
  );
  it('checks authority at dispatch and never invokes the wire after revocation', async () => {
    const { api, wire } = client({ success: true });
    await expect(
      api.removeQueued('a', 'q', 'w', {
        ...options(),
        onDispatch() {
          throw new Error('retired');
        },
      }),
    ).resolves.toMatchObject({ success: false, removalOutcome: 'failed' });
    expect(wire).not.toHaveBeenCalled();
  });
  it('validates the queue envelope and passes valid order and metadata through unchanged', async () => {
    const queue = [
      {
        id: 'b',
        content: 'second',
        queuedAt: '2026-10-15T00:00:00Z',
        position: 1,
        messageMetadata: { source: 'human' },
      },
      { id: 'a', content: 'first', queuedAt: '2026-10-15T00:00:00Z', position: 0 },
    ];
    const { api, wire } = client({ success: true, queue });
    expect(await api.getQueue('a', 'w', { requireQueueReceipt: true })).toBe(queue);
    expect(wire).toHaveBeenCalledExactlyOnceWith('agent.getQueue', {
      agentId: 'a',
      workspaceId: 'w',
    });
  });
  it.each([
    {},
    { success: true },
    { success: false, queue: [] },
    { success: true, queue: [{}] },
    { success: true, queue: [{ id: 'q', content: '', queuedAt: '', position: -1 }] },
  ])(
    'rejects a bad strict queue snapshot without manufacturing an empty queue: %j',
    async (response) => {
      await expect(
        client(response).api.getQueue('a', 'w', { requireQueueReceipt: true }),
      ).rejects.toThrow();
    },
  );
});
