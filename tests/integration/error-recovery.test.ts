import { RequestDeduplicator } from '$features/agent/browser/services/request-deduplicator.service';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  chatErrorCleared,
  chatSendFailed,
  chatStateReducer,
  initialState,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHANNEL = 'agent:sendMessage';
const PARAMS = { workspaceId: 'ws-recovery', agentId: 'agent-recovery', content: 'Retry me' };

describe('Error recovery', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    resetMockIpcRouter();
    deduplicator = new (RequestDeduplicator as any)();
  });

  afterEach(() => {
    deduplicator.dispose();
    resetMockIpcRouter();
  });

  it('releases a failed request so the same operation can recover', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('transport unavailable'))
      .mockResolvedValueOnce({ success: true, queued: false, messageId: 'msg-recovered' });
    registerMockIpcHandler(CHANNEL, handler);
    const key = RequestDeduplicator.generateMessageKey(PARAMS.agentId, PARAMS.content);
    const operation = () => mockInvoke(CHANNEL, PARAMS);

    await expect(deduplicator.deduplicate(key, operation)).rejects.toThrow('transport unavailable');
    await expect(deduplicator.deduplicate(key, operation)).resolves.toEqual({
      success: true,
      queued: false,
      messageId: 'msg-recovered',
    });
    expect(handler).toHaveBeenNthCalledWith(1, PARAMS);
    expect(handler).toHaveBeenNthCalledWith(2, PARAMS);
  });

  it('stores and clears a send error through the production chat reducer', () => {
    const failed = chatStateReducer(initialState, chatSendFailed(PARAMS.agentId, 'send failed'));
    const recovered = chatStateReducer(failed, chatErrorCleared(PARAMS.agentId));

    expect(failed.byAgentId[PARAMS.agentId].error).toBe('send failed');
    expect(recovered.byAgentId[PARAMS.agentId].error).toBeNull();
  });
});
