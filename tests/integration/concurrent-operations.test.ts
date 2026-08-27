import { RequestDeduplicator } from '$features/agent/browser/services/request-deduplicator.service';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHANNEL = 'agent:sendMessage';

describe('Concurrent operations', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    resetMockIpcRouter();
    deduplicator = new (RequestDeduplicator as any)();
  });

  afterEach(() => {
    deduplicator.dispose();
    resetMockIpcRouter();
  });

  it('shares one transport request for concurrent identical sends', async () => {
    const params = { workspaceId: 'ws-1', agentId: 'agent-1', content: 'Hello' };
    const handler = vi.fn(async (received: unknown) => {
      expect(received).toEqual(params);
      await Promise.resolve();
      return { success: true, queued: false, messageId: 'msg-1' };
    });
    registerMockIpcHandler(CHANNEL, handler);
    const key = RequestDeduplicator.generateMessageKey(params.agentId, params.content);
    const operation = () => mockInvoke(CHANNEL, params);

    const [first, second] = await Promise.all([
      deduplicator.deduplicate(key, operation),
      deduplicator.deduplicate(key, operation),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('allows concurrent sends for different agents', async () => {
    const handler = vi.fn(async (params: { agentId: string }) => ({
      success: true,
      queued: false,
      messageId: `msg-${params.agentId}`,
    }));
    registerMockIpcHandler(CHANNEL, handler);
    const send = (agentId: string) => {
      const params = { workspaceId: 'ws-1', agentId, content: 'Hello' };
      const key = RequestDeduplicator.generateMessageKey(agentId, params.content);
      return deduplicator.deduplicate(key, () => mockInvoke(CHANNEL, params));
    };

    await expect(Promise.all([send('agent-1'), send('agent-2')])).resolves.toEqual([
      { success: true, queued: false, messageId: 'msg-agent-1' },
      { success: true, queued: false, messageId: 'msg-agent-2' },
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('issues a fresh transport request after the first one settles', async () => {
    const params = { workspaceId: 'ws-1', agentId: 'agent-1', content: 'Again' };
    const handler = vi.fn(async () => ({ success: true, queued: false, messageId: 'msg-1' }));
    registerMockIpcHandler(CHANNEL, handler);
    const key = RequestDeduplicator.generateMessageKey(params.agentId, params.content);
    const operation = () => mockInvoke(CHANNEL, params);

    await deduplicator.deduplicate(key, operation);
    await deduplicator.deduplicate(key, operation);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
