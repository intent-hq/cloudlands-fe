import { beforeEach, describe, expect, it, vi } from 'vitest';
const { wire } = vi.hoisted(() => ({ wire: vi.fn() }));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: () => ({ request: wire }),
}));
import { createBackendRuntime } from './backend-transport-runtime';
import { createBackendChatCommands } from './backend-chat-commands';
import { BackendError } from './backend-transport-types';
const client = createBackendChatCommands(
  createBackendRuntime(() => ({ remoteEnabled: () => false, connectionGeneration: () => 0 }))
    .backendRequest,
);
beforeEach(() => {
  wire.mockReset();
});
describe('strict rename final transport and receipt', () => {
  it('strict rename preserves the actual accepted name and exact captured origin', async () => {
    wire.mockImplementation(() => ({ success: true, name: 'Server accepted' }));
    const onDispatch = vi.fn();
    const result = await client.rename('agent-1', 'Requested', 'ws-1', {
      requireRenameReceipt: true,
      onDispatch,
    });
    expect(result).toEqual({
      success: true,
      renameOutcome: 'confirmed',
      dispatched: true,
      name: 'Server accepted',
    });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(wire).toHaveBeenCalledExactlyOnceWith(
      'agent.rename',
      { agentId: 'agent-1', name: 'Requested', workspaceId: 'ws-1' },
      undefined,
    );
  });

  it.each([
    {},
    { success: true },
    { success: true, name: '' },
    { success: true, name: 'Name', skipped: true },
    { success: false, error: 'unclassified' },
  ])('strict rename refuses to infer confirmation from %j', async (response) => {
    wire.mockImplementation(() => response);
    expect(
      await client.rename('agent-1', 'Name', 'ws-1', {
        requireRenameReceipt: true,
        onDispatch: () => {},
      }),
    ).toMatchObject({ success: false, renameOutcome: 'unknown', dispatched: true });
  });

  it.each([-32600, -32601, -32602, -32003, -32603])(
    'strict rename classifies dispatched RPC failure %s',
    async (rpcCode) => {
      wire.mockImplementation(() => {
        throw new BackendError({ code: 'REJECTED', message: 'refused', rpcCode });
      });
      expect(
        await client.rename('agent-1', 'Name', 'ws-1', {
          requireRenameReceipt: true,
          onDispatch: () => {},
        }),
      ).toMatchObject({
        success: false,
        renameOutcome: rpcCode === -32603 ? 'unknown' : 'failed',
        dispatched: true,
      });
    },
  );

  it('strict rename stops at a revoked final dispatch boundary without wire traffic', async () => {
    const result = await client.rename('agent-1', 'Name', 'ws-1', {
      requireRenameReceipt: true,
      onDispatch: () => {
        throw new Error('retired view');
      },
    });
    expect(result).toMatchObject({ success: false, renameOutcome: 'failed', dispatched: false });
    expect(wire.mock.calls).toEqual([]);
  });
});
