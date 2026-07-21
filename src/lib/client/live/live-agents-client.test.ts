import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCreateRequest } from '../app-client';

// FAKE transport only: the backend bridge is routed at the shared
// MockBackendTransport fixture so no request ever reaches the user's real
// daemon. Each test scripts a `backend.onRequest(...)` handler and asserts the
// JSON-RPC method + params the client emits (via `backend.requests`) plus how
// the client folds success / error into a MutationResult.
vi.mock('./backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock';
import { LiveAgentsClient } from './live-agents-client';

describe('LiveAgentsClient mutations (fake transport)', () => {
  let backend: MockBackendHandle;
  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    resetMockBackend();
  });

  it('create forwards agent.create with the widened P2-12a params and returns the normalized session', async () => {
    // Daemon returns the full `AgentLite` projection (P2-12a widened §5.5).
    // Unique id so the module-level agentWorkspaceIndex cache does not bleed
    // into the sibling `send` tests below (which expect a cold cache).
    backend.onRequest('agent.create', () => ({
      agent: {
        id: 'agent-p212a-1',
        workspaceId: 'ws-p212a',
        name: 'widened',
        model: 'opus',
        provider: 'auggie',
        status: 'pending',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
      },
    }));
    const client = new LiveAgentsClient();

    const request: AgentCreateRequest = {
      workspaceId: 'ws-p212a',
      prompt: 'do the thing',
      model: 'opus',
      specialist: 'implementor',
      name: 'widened',
      // Even when a legacy caller passes an id, it must NOT hit the wire —
      // the daemon assigns the session id.
      agentId: 'agent-legacy-client',
      provider: 'auggie',
      agentType: 'task-loop',
      metadata: { tag: 'unit' },
      workspacePath: '/tmp/wid',
      workspaceContext: { selection: 'note:1' },
    };
    const session = await client.create(request);

    expect(session.id).toBe('agent-p212a-1');
    expect(session.workspaceId).toBe('ws-p212a');
    expect(session.name).toBe('widened');
    expect(backend.requests[0]).toEqual({
      method: 'agent.create',
      params: expect.objectContaining({
        workspaceId: 'ws-p212a',
        model: 'opus',
        specialistId: 'implementor',
        behaviorPrompt: 'do the thing',
        name: 'widened',
        provider: 'auggie',
        agentType: 'task-loop',
        metadata: { tag: 'unit' },
        workspacePath: '/tmp/wid',
        workspaceContext: { selection: 'note:1' },
        idempotencyKey: expect.any(String),
      }),
    });
    // The client-supplied agentId is dropped before the request is sent.
    expect(backend.requests[0]?.params).not.toHaveProperty('agentId');
  });

  it('create omits absent optional params (backward-compat with the pre-P2-12a callers)', async () => {
    backend.onRequest('agent.create', () => ({
      agent: { id: 'agent-p212a-2', workspaceId: 'ws-p212a', status: 'pending' },
    }));
    const client = new LiveAgentsClient();

    await client.create({ workspaceId: 'ws-p212a' });

    const params = backend.requests[0]?.params as Record<string, unknown>;
    expect(params.workspaceId).toBe('ws-p212a');
    expect(params.idempotencyKey).toEqual(expect.any(String));
    // Every optional param stays off the wire when the caller didn't supply it.
    for (const key of [
      'model',
      'specialistId',
      'behaviorPrompt',
      'name',
      'agentId',
      'provider',
      'agentType',
      'metadata',
      'workspacePath',
      'workspaceContext',
    ]) {
      expect(params).not.toHaveProperty(key);
    }
  });

  it('send forwards agent.sendMessage with workspaceId + minted messageId', async () => {
    // First backend call resolves the agent (priming workspaceId cache);
    // second is the actual agent.sendMessage mutation.
    backend.onRequest('agent.get', () => ({ agent: { id: 'agent-1', workspaceId: 'ws-1' } }));
    backend.onRequest('agent.sendMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();

    expect(await client.send('agent-1', 'hi')).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({ method: 'agent.get', params: { agentId: 'agent-1' } });
    expect(backend.requests[1]).toEqual({
      method: 'agent.sendMessage',
      params: expect.objectContaining({
        agentId: 'agent-1',
        content: 'hi',
        workspaceId: 'ws-1',
        messageId: expect.any(String),
      }),
    });
  });

  it('send reuses the cached workspaceId from a prior list/get without re-fetching', async () => {
    // Prime the cache via list().
    backend.onRequest('agent.list', () => ({
      agents: [{ id: 'agent-1', workspaceId: 'ws-1', name: 'A1', status: 'idle' }],
    }));
    backend.onRequest('agent.sendMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();
    await client.list('ws-1');

    expect(await client.send('agent-1', 'hi')).toEqual({ success: true });

    // Exactly two backend calls total: the priming list and the sendMessage.
    expect(backend.requests).toHaveLength(2);
    expect(backend.requests.at(-1)).toEqual({
      method: 'agent.sendMessage',
      params: expect.objectContaining({ agentId: 'agent-1', content: 'hi', workspaceId: 'ws-1' }),
    });
  });

  it("send fails cleanly when the agent's workspace cannot be resolved", async () => {
    // agent.get returns nothing -> resolver returns null -> send refuses to fire
    // a malformed agent.sendMessage.
    backend.onRequest('agent.get', () => null);
    const client = new LiveAgentsClient();

    const result = await client.send('agent-ghost', 'hi');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/agent-ghost/);
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toEqual({
      method: 'agent.get',
      params: { agentId: 'agent-ghost' },
    });
  });

  it('queue forwards agent.queueMessage and surfaces the returned queuedMessage', async () => {
    const queuedMessage = {
      id: 'qm-1',
      content: 'later',
      queuedAt: '2026-06-29T00:00:00.000Z',
      position: 0,
    };
    backend.onRequest('agent.queueMessage', () => ({ success: true, queuedMessage }));
    const client = new LiveAgentsClient();

    const result = await client.queue('agent-1', 'later');
    expect(result).toEqual({ success: true, queuedMessage });
    expect(backend.requests[0]).toEqual({
      method: 'agent.queueMessage',
      params: { agentId: 'agent-1', content: 'later' },
    });
  });

  it('queue still succeeds when the daemon omits queuedMessage', async () => {
    backend.onRequest('agent.queueMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();

    expect(await client.queue('agent-1', 'later')).toEqual({ success: true });
  });

  it('removeQueued forwards agent.removeQueuedMessage with PROTOCOL §5.5 params and folds the idempotent BE body into success', async () => {
    // PROTOCOL §5.5: the daemon's agent.removeQueuedMessage ALWAYS returns
    // `{ success: true }`, including when the messageId is unknown or the
    // queue is empty. The seam folds that into the uniform MutationResult.
    backend.onRequest('agent.removeQueuedMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();

    const result = await client.removeQueued('agent-1', 'qm-1');
    expect(result).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.removeQueuedMessage',
      params: { agentId: 'agent-1', messageId: 'qm-1' },
    });
  });

  it('removeQueued surfaces a transport failure as a non-success MutationResult (no throw)', async () => {
    backend.onRequest('agent.removeQueuedMessage', () => {
      throw new Error('ipc boom');
    });
    const client = new LiveAgentsClient();

    const result = await client.removeQueued('agent-1', 'qm-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ipc boom');
  });

  it('editAndRegenerate forwards agent.editAndRegenerate with §5.5 params (model omitted when absent)', async () => {
    // PROTOCOL §5.5 (catalog-parity extension): agent.editAndRegenerate takes
    // { agentId, messageId, content, workspaceId, model? } and returns
    // { success, queued: false, messageId, truncatedCount }. The seam folds the
    // body into a uniform MutationResult and must NOT send an explicit
    // `model: undefined` the daemon would reject.
    backend.onRequest('agent.editAndRegenerate', () => ({
      success: true,
      queued: false,
      messageId: 'user-msg-new',
      truncatedCount: 3,
    }));
    const client = new LiveAgentsClient();

    const result = await client.editAndRegenerate({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'msg-edit-1',
      content: 'edited text',
    });
    expect(result).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.editAndRegenerate',
      params: {
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        messageId: 'msg-edit-1',
        content: 'edited text',
      },
    });
  });

  it('editAndRegenerate forwards the per-request model override when supplied', async () => {
    backend.onRequest('agent.editAndRegenerate', () => ({
      success: true,
      queued: false,
      messageId: 'user-msg-new',
      truncatedCount: 1,
    }));
    const client = new LiveAgentsClient();

    await client.editAndRegenerate({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'msg-edit-1',
      content: 'edited text',
      model: 'opus',
    });
    expect(backend.requests[0]).toEqual({
      method: 'agent.editAndRegenerate',
      params: expect.objectContaining({ model: 'opus' }),
    });
  });

  it('editAndRegenerate surfaces a daemon rejection as a non-success MutationResult (no throw)', async () => {
    // Unknown / non-user messageIds are rejected with -32602 BEFORE any state
    // changes (transcript untouched) per the §5.5 contract.
    backend.onRequest('agent.editAndRegenerate', () => {
      throw new Error('Invalid params: messageId does not reference a user message');
    });
    const client = new LiveAgentsClient();

    const result = await client.editAndRegenerate({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'msg-not-user',
      content: 'edited text',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('messageId does not reference a user message');
  });

  it('stop forwards agent.stop with §5.5 params and folds the ack into success', async () => {
    // PROTOCOL §5.5: agent.stop takes `{ agentId }` and acks `{ success: true }`
    // — the daemon cancels the in-flight stream and emits the terminal
    // `agent:stream:end` (§7), so the ack body carries nothing else.
    backend.onRequest('agent.stop', () => ({ success: true }));
    const client = new LiveAgentsClient();

    expect(await client.stop('agent-1')).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({ method: 'agent.stop', params: { agentId: 'agent-1' } });
  });

  it('stop surfaces a transport failure as a non-success MutationResult (no throw)', async () => {
    backend.onRequest('agent.stop', () => {
      throw new Error('stop boom');
    });
    const client = new LiveAgentsClient();

    const result = await client.stop('agent-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('stop boom');
  });

  it('delete forwards agent.delete with §5.5 params and folds the idempotent BE body into success', async () => {
    // PROTOCOL §5.5: agent.delete takes `{ agentId }` (workspaceId optional, the
    // daemon resolves it) and returns `{ success: true }` — idempotently, even
    // when the agent is already gone. The seam forwards only `{ agentId }`.
    backend.onRequest('agent.delete', () => ({ success: true }));
    const client = new LiveAgentsClient();

    expect(await client.delete('agent-1')).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.delete',
      params: { agentId: 'agent-1' },
    });
  });

  it('delete surfaces a transport failure as a non-success MutationResult (no throw)', async () => {
    backend.onRequest('agent.delete', () => {
      throw new Error('delete boom');
    });
    const client = new LiveAgentsClient();

    const result = await client.delete('agent-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('delete boom');
  });

  it('maps a daemon error to a failed MutationResult without throwing', async () => {
    // Use a fresh agentId so the module-level workspace cache is guaranteed to
    // miss; the resolver call resolves successfully, then agent.sendMessage
    // rejects and the failure is folded into a MutationResult (not thrown).
    backend.onRequest('agent.get', () => ({ agent: { id: 'agent-err', workspaceId: 'ws-1' } }));
    backend.onRequest('agent.sendMessage', () => {
      throw new Error('agent busy');
    });
    const client = new LiveAgentsClient();

    expect(await client.send('agent-err', 'x')).toEqual({ success: false, error: 'agent busy' });
  });
});

describe('LiveAgentsClient reads thread daemon activity flags (PROTOCOL §5.5)', () => {
  let backend: MockBackendHandle;
  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    resetMockBackend();
  });

  it('list carries isResponding/isWaitingOnTool/isWaitingForOtherAgents verbatim', async () => {
    backend.onRequest('agent.list', () => ({
      agents: [
        {
          id: 'agent-1',
          workspaceId: 'ws-1',
          name: 'A1',
          status: 'active',
          isResponding: true,
          isWaitingOnTool: true,
          isWaitingForOtherAgents: false,
          waitingForAgentIds: [],
        },
      ],
    }));
    const client = new LiveAgentsClient();

    const [agent] = await client.list('ws-1');
    expect(agent).toMatchObject({
      isResponding: true,
      isWaitingOnTool: true,
      isWaitingForOtherAgents: false,
      waitingForAgentIds: [],
    });
  });

  it('get carries the daemon activity flags verbatim', async () => {
    backend.onRequest('agent.get', () => ({
      agent: {
        id: 'agent-1',
        workspaceId: 'ws-1',
        name: 'A1',
        status: 'idle',
        isResponding: false,
        isWaitingOnTool: false,
        isWaitingForOtherAgents: true,
        waitingForAgentIds: ['agent-child-1', 'agent-child-2'],
      },
    }));
    const client = new LiveAgentsClient();

    const agent = await client.get('agent-1');
    expect(agent).toMatchObject({
      isResponding: false,
      isWaitingOnTool: false,
      isWaitingForOtherAgents: true,
      waitingForAgentIds: ['agent-child-1', 'agent-child-2'],
    });
  });

  it('does not synthesize activity flags the daemon omits (no healing)', async () => {
    backend.onRequest('agent.get', () => ({
      agent: { id: 'agent-1', workspaceId: 'ws-1', name: 'A1', status: 'completed' },
    }));
    const client = new LiveAgentsClient();

    const agent = await client.get('agent-1');
    expect(agent?.isResponding).toBeUndefined();
    expect(agent?.isWaitingOnTool).toBeUndefined();
    expect(agent?.isWaitingForOtherAgents).toBeUndefined();
    expect(agent?.waitingForAgentIds).toBeUndefined();
  });

  // ---- §5.5 agent.getConversation pagination -----------------------------

  it('getConversation forwards limit only when no pageToken is given (first page)', async () => {
    backend.onRequest('agent.getConversation', () => ({
      messages: [{ id: 'm1' }],
      truncated: true,
      totalMessages: 3,
      nextToken: 'tok-2',
    }));
    const client = new LiveAgentsClient();

    const page = await client.getConversation('agent-1');

    expect(backend.requests[0]).toEqual({
      method: 'agent.getConversation',
      params: { agentId: 'agent-1', limit: 200 },
    });
    expect(page.nextToken).toBe('tok-2');
    expect(page.truncated).toBe(true);
    expect(page.totalMessages).toBe(3);
    expect(page.messages).toHaveLength(1);
  });

  it('getConversation forwards nextToken as the pagination cursor', async () => {
    backend.onRequest('agent.getConversation', () => ({
      messages: [],
      truncated: false,
      totalMessages: 3,
      nextToken: null,
    }));
    const client = new LiveAgentsClient();

    const page = await client.getConversation('agent-1', 100, 'tok-2');

    expect(backend.requests[0]).toEqual({
      method: 'agent.getConversation',
      params: { agentId: 'agent-1', limit: 100, nextToken: 'tok-2' },
    });
    expect(page.nextToken).toBeNull();
  });

  it('getConversation normalizes a missing nextToken to null', async () => {
    backend.onRequest('agent.getConversation', () => ({
      messages: [],
      truncated: false,
      totalMessages: 0,
    }));
    const client = new LiveAgentsClient();

    const page = await client.getConversation('agent-1');
    expect(page.nextToken).toBeNull();
  });

  describe('retry', () => {
    it('calls agent.retry with correct params and returns ok:true on success', async () => {
      backend.onRequest('agent.retry', (params) => {
        expect(params).toEqual({
          agentId: 'agent-retry-1',
          workspaceId: 'ws-retry-1',
        });
        return { ok: true, redriven: true };
      });
      const client = new LiveAgentsClient();

      const result = await client.retry('agent-retry-1', 'ws-retry-1');
      expect(result).toEqual({ ok: true, redriven: true });
      expect(backend.requests).toHaveLength(1);
      expect(backend.requests[0].method).toBe('agent.retry');
    });

    it('surfaces redriven:false when the daemon had nothing to redrive', async () => {
      backend.onRequest('agent.retry', () => ({ ok: true, redriven: false }));
      const client = new LiveAgentsClient();

      const result = await client.retry('agent-empty-queue', 'ws-1');
      expect(result).toEqual({ ok: true, redriven: false });
    });

    it('leaves redriven undefined when the daemon omits it (older daemon)', async () => {
      backend.onRequest('agent.retry', () => ({ ok: true }));
      const client = new LiveAgentsClient();

      const result = await client.retry('agent-old-daemon', 'ws-1');
      expect(result).toEqual({ ok: true, redriven: undefined });
    });

    it('returns ok:false with error message when backend returns ok:false', async () => {
      backend.onRequest('agent.retry', () => ({
        ok: false,
        error: 'Agent not in error status',
      }));
      const client = new LiveAgentsClient();

      const result = await client.retry('agent-not-error', 'ws-1');
      expect(result).toEqual({ ok: false, error: 'Agent not in error status' });
    });

    it('returns ok:false with error message on transport error without throwing', async () => {
      backend.onRequest('agent.retry', () => {
        throw new Error('Transport failure');
      });
      const client = new LiveAgentsClient();

      const result = await client.retry('agent-fail', 'ws-1');
      expect(result).toEqual({ ok: false, error: 'Transport failure' });
    });
  });

  describe('stopReason normalization', () => {
    it('normalizes agent.get payload with stopReason field', async () => {
      backend.onRequest('agent.get', () => ({
        agent: {
          id: 'agent-123',
          workspaceId: 'ws-1',
          name: 'error-agent',
          status: 'error',
          stopReason: 'Agent spawn failed after 3 retries',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      }));
      const client = new LiveAgentsClient();

      const session = await client.get('agent-123');

      expect(session).not.toBeNull();
      expect(session?.id).toBe('agent-123');
      expect(session?.status).toBe('error');
      expect(session?.stopReason).toBe('Agent spawn failed after 3 retries');
    });

    it('normalizes agent.list payload with stopReason field', async () => {
      backend.onRequest('agent.list', () => ({
        agents: [
          {
            id: 'agent-1',
            workspaceId: 'ws-1',
            name: 'completed-agent',
            status: 'completed',
            stopReason: 'end_turn',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'agent-2',
            workspaceId: 'ws-1',
            name: 'error-agent',
            status: 'error',
            stopReason: 'timeout',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      }));
      const client = new LiveAgentsClient();

      const sessions = await client.list('ws-1');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].stopReason).toBe('end_turn');
      expect(sessions[1].stopReason).toBe('timeout');
    });

    it('normalizes agent.get payload without stopReason field', async () => {
      backend.onRequest('agent.get', () => ({
        agent: {
          id: 'agent-456',
          workspaceId: 'ws-1',
          name: 'pending-agent',
          status: 'pending',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      }));
      const client = new LiveAgentsClient();

      const session = await client.get('agent-456');

      expect(session).not.toBeNull();
      expect(session?.id).toBe('agent-456');
      expect(session?.status).toBe('pending');
      // stopReason should be undefined when not present in the payload
      expect(session?.stopReason).toBeUndefined();
    });
  });
});
