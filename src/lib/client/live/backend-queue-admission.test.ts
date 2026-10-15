import { expect, it, vi } from 'vitest';
import { createBackendChatCommands } from './backend-chat-commands';
it('rejects a retired enqueue at final preflight without writing and retains unknown acknowledgements', async () => {
  let current = true,
    wire = 0;
  const request = vi.fn(async (_method, _params, options) => {
    current = false;
    options?.onDispatch?.();
    wire++;
    return { success: true };
  });
  const client = createBackendChatCommands(request as any, { strictQueue: true });
  const result = await client.queue('agent', 'draft', {
    workspaceId: 'ws',
    messageId: 'request',
    onDispatch: () => {
      if (!current) throw new Error('retired');
    },
  });
  expect(wire).toBe(0);
  expect(result.success).toBe(false);
  current = true;
  request.mockImplementation(async (_method, _params, options) => {
    options?.onDispatch?.();
    wire++;
    throw new Error('receipt lost');
  });
  await expect(
    client.queue('agent', 'draft', {
      workspaceId: 'ws',
      messageId: 'request',
      onDispatch: () => {},
    }),
  ).rejects.toThrow('receipt lost');
  expect(wire).toBe(1);
});
it('does not accept malformed queue receipts or turn them into an empty successful queue', async () => {
  const request = vi.fn(async (_method, _params, options) => {
    options?.onDispatch?.();
    return {};
  });
  const client = createBackendChatCommands(request as any, { strictQueue: true });
  await expect(
    client.queue('agent', 'draft', {
      workspaceId: 'ws',
      messageId: 'request',
      onDispatch: () => {},
    }),
  ).rejects.toThrow();
  await expect(client.getQueue('agent', 'ws')).rejects.toThrow();
  expect(await createBackendChatCommands(request as any).getQueue('agent', 'ws')).toEqual([]);
});

it('accepts a correlated merged enqueue and keeps a wrong-identity receipt uncertain', async () => {
  const queuedMessage = {
    id: 'merged',
    content: 'earlier\n\ndraft',
    queuedAt: '2026-10-15',
    position: 0,
    submissionIds: ['earlier', 'request'],
  };
  const request = vi.fn(async (_method, _params, options) => {
    options?.onDispatch?.();
    return { success: true, queuedMessage };
  });
  const client = createBackendChatCommands(request as any, { strictQueue: true });
  const options = { workspaceId: 'ws', messageId: 'request', onDispatch: () => {} };
  expect(await client.queue('agent', 'draft', options)).toMatchObject({
    success: true,
    queuedMessage,
  });
  queuedMessage.submissionIds = ['unrelated'];
  await expect(client.queue('agent', 'draft', options)).rejects.toThrow();
});
