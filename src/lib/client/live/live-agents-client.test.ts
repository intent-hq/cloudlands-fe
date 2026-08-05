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
  BackendError,
  buildErrorPayload,
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
      // Generated placeholder name — the flag must reach the wire verbatim so
      // the daemon keeps the session self-renameable (§5.5).
      nameExplicitlySet: false,
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
        nameExplicitlySet: false,
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

  it('create forwards nameExplicitlySet:true verbatim (user-chosen name)', async () => {
    backend.onRequest('agent.create', () => ({
      agent: { id: 'agent-explicit-1', workspaceId: 'ws-p212a', status: 'pending' },
    }));
    const client = new LiveAgentsClient();

    await client.create({
      workspaceId: 'ws-p212a',
      name: 'My Chosen Name',
      nameExplicitlySet: true,
    });

    expect(backend.requests[0]?.params).toEqual(
      expect.objectContaining({ name: 'My Chosen Name', nameExplicitlySet: true }),
    );
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
      'nameExplicitlySet',
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

  it('create throws when the daemon response lacks the daemon-assigned agent.id', async () => {
    // The daemon-assigned id is the only way to address follow-up sends —
    // a missing/empty id must fail loudly, not coerce into an empty session key.
    backend.onRequest('agent.create', () => ({
      agent: { workspaceId: 'ws-p212a', status: 'pending' },
    }));
    const client = new LiveAgentsClient();

    await expect(client.create({ workspaceId: 'ws-p212a' })).rejects.toThrow(
      /missing daemon-assigned agent\.id/,
    );
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

  it('queue surfaces the top-level turnId from the §5.5 response (monorepo#1057)', async () => {
    const queuedMessage = {
      id: 'qm-1',
      content: 'later',
      queuedAt: '2026-06-29T00:00:00.000Z',
      position: 0,
      turnId: 'qm-1',
    };
    backend.onRequest('agent.queueMessage', () => ({
      success: true,
      queuedMessage,
      turnId: 'qm-1',
    }));
    const client = new LiveAgentsClient();

    const result = await client.queue('agent-1', 'later');
    expect(result).toEqual({ success: true, queuedMessage, turnId: 'qm-1' });
  });

  it('queue falls back to queuedMessage.turnId when the top-level field is absent', async () => {
    const queuedMessage = {
      id: 'qm-2',
      content: 'later',
      queuedAt: '2026-06-29T00:00:00.000Z',
      position: 0,
      turnId: 'turn-preserved',
    };
    backend.onRequest('agent.queueMessage', () => ({ success: true, queuedMessage }));
    const client = new LiveAgentsClient();

    const result = await client.queue('agent-1', 'later');
    expect(result.turnId).toBe('turn-preserved');
  });

  it('queue forwards imageBlocks on agent.queueMessage params when supplied (§5.5)', async () => {
    // PROTOCOL §5.5: agent.queueMessage accepts optional imageBlocks; the
    // daemon persists them on the QueuedMessage so queued attachments
    // survive queue-on-send. The seam forwards them verbatim.
    const imageBlocks = [
      { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' },
    ];
    const queuedMessage = {
      id: 'qm-img-1',
      content: 'later with image',
      queuedAt: '2026-06-29T00:00:00.000Z',
      position: 0,
      imageBlocks,
    };
    backend.onRequest('agent.queueMessage', () => ({ success: true, queuedMessage }));
    const client = new LiveAgentsClient();

    const result = await client.queue('agent-1', 'later with image', { imageBlocks });
    expect(result).toEqual({ success: true, queuedMessage });
    expect(backend.requests[0]).toEqual({
      method: 'agent.queueMessage',
      params: { agentId: 'agent-1', content: 'later with image', imageBlocks },
    });
  });

  it('queue omits the imageBlocks key entirely when no images are supplied', async () => {
    backend.onRequest('agent.queueMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();

    await client.queue('agent-1', 'no images', {});
    expect(backend.requests[0]).toEqual({
      method: 'agent.queueMessage',
      params: { agentId: 'agent-1', content: 'no images' },
    });
    expect('imageBlocks' in (backend.requests[0]?.params as object)).toBe(false);
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

  it('editQueued forwards agent.editQueuedMessage with §5.5 params (editing omitted when absent) and surfaces the queuedMessage', async () => {
    // PROTOCOL §5.5: `{ agentId, messageId, content, editing? }` →
    // `{ success, queuedMessage }` (same QueuedMessage shape as queueMessage).
    const queuedMessage = {
      id: 'qm-1',
      content: 'edited',
      queuedAt: '2026-06-29T00:00:00.000Z',
      position: 0,
    };
    backend.onRequest('agent.editQueuedMessage', () => ({ success: true, queuedMessage }));
    const client = new LiveAgentsClient();

    const result = await client.editQueued('agent-1', 'qm-1', 'edited');
    expect(result).toEqual({ success: true, queuedMessage });
    expect(backend.requests[0]).toEqual({
      method: 'agent.editQueuedMessage',
      params: { agentId: 'agent-1', messageId: 'qm-1', content: 'edited' },
    });
    // No explicit `editing: undefined` on the wire — the daemon router's
    // opt_value lookup must see the param as absent.
    expect(backend.requests[0]?.params).not.toHaveProperty('editing');
  });

  it('editQueued forwards editing:true (STAB-27 hold) and editing:false (release) explicitly', async () => {
    const queuedMessage = {
      id: 'qm-1',
      content: 'held',
      queuedAt: '2026-06-29T00:00:00.000Z',
      position: 0,
      editing: true,
    };
    backend.onRequest('agent.editQueuedMessage', () => ({ success: true, queuedMessage }));
    const client = new LiveAgentsClient();

    await client.editQueued('agent-1', 'qm-1', 'held', true);
    await client.editQueued('agent-1', 'qm-1', 'released', false);

    expect(backend.requests[0]).toEqual({
      method: 'agent.editQueuedMessage',
      params: { agentId: 'agent-1', messageId: 'qm-1', content: 'held', editing: true },
    });
    expect(backend.requests[1]).toEqual({
      method: 'agent.editQueuedMessage',
      params: { agentId: 'agent-1', messageId: 'qm-1', content: 'released', editing: false },
    });
  });

  it('editQueued still succeeds when the daemon omits queuedMessage', async () => {
    backend.onRequest('agent.editQueuedMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();

    expect(await client.editQueued('agent-1', 'qm-1', 'edited')).toEqual({ success: true });
  });

  it('editQueued folds a raw BackendError into {success:false,error} (design §5 risk 2: no {success,data} unwrap anymore)', async () => {
    // The retired renderer proxy unwrapped `{success,data}` envelopes; the
    // seam now sees the raw BackendError a daemon rejection throws (§9). The
    // ChatPanel error branch reads `result.error`, so the daemon message must
    // land there verbatim and the call must NOT throw.
    backend.onRequest('agent.editQueuedMessage', () => {
      throw new BackendError(
        buildErrorPayload('INVALID_PARAMS', 'not found: queued message', { rpcCode: -32602 }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.editQueued('agent-1', 'qm-gone', 'edited');
    expect(result).toEqual({ success: false, error: 'not found: queued message' });
  });

  it('sendQueuedNow forwards agent.sendQueuedMessageNow with §5.5 params and folds the daemon body into success', async () => {
    // PROTOCOL §5.5: `{ agentId, workspaceId, messageId }` →
    // `{ success, queued: false, messageId }` (atomic dequeue + interrupt send).
    backend.onRequest('agent.sendQueuedMessageNow', () => ({
      success: true,
      queued: false,
      messageId: 'qm-9',
    }));
    const client = new LiveAgentsClient();

    const result = await client.sendQueuedNow({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'qm-9',
    });

    expect(result.success).toBe(true);
    expect(backend.requests[0]).toEqual({
      method: 'agent.sendQueuedMessageNow',
      params: {
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        messageId: 'qm-9',
      },
    });
  });

  it('sendQueuedNow surfaces the delivered arm\u2019s turnId (monorepo#1057)', async () => {
    // §5.5: the delivered arm is `{ success: true, queued: false, messageId,
    // turnId }` — this path emits NO agent:queue:processing event, so the
    // RPC's turnId is the promotion signal the caller dispatches from.
    backend.onRequest('agent.sendQueuedMessageNow', () => ({
      success: true,
      queued: false,
      messageId: 'qm-9',
      turnId: 'turn-preserved',
    }));
    const client = new LiveAgentsClient();

    const result = await client.sendQueuedNow({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'qm-9',
    });
    expect(result).toEqual({ success: true, turnId: 'turn-preserved' });
  });

  it('sendQueuedNow folds the -32602 missing-entry rejection into {success:false,error} (no throw)', async () => {
    // NOT idempotent (§5.5): an already-drained/removed entry rejects with
    // -32602 — the seam folds it into a MutationResult instead of throwing.
    backend.onRequest('agent.sendQueuedMessageNow', () => {
      throw new BackendError(
        buildErrorPayload('INVALID_PARAMS', 'not found: queued message', { rpcCode: -32602 }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.sendQueuedNow({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'qm-gone',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found: queued message');
  });

  it('sendQueuedNow does NOT surface a turnId on the slot-race restore arm (no queuedMessage fallback)', async () => {
    // §5.5 slot-race arm: `{ success: true, queued: true, queuedMessage }` —
    // the entry was RESTORED at the queue front, not delivered. Unlike
    // `queue()`, this method must not fall back to `queuedMessage.turnId`:
    // a restore surfaced as a delivery would promote the parked record.
    backend.onRequest('agent.sendQueuedMessageNow', () => ({
      success: true,
      queued: true,
      queuedMessage: {
        id: 'qm-9',
        content: 'held',
        queuedAt: '2026-01-01T00:00:00.000Z',
        position: 0,
        turnId: 'turn-restored',
      },
    }));
    const client = new LiveAgentsClient();

    const result = await client.sendQueuedNow({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'qm-9',
    });
    expect(result).toEqual({ success: true });
  });

  it('sendQueuedNow folds JSON-RPC "Internal error" + data.detail into the error like runMutation', async () => {
    // Regression: extracting turnId bypassed runMutation, which must not lose
    // the shared mutationErrorMessage shaping (generic "Internal error"
    // messages fold in `data.detail` so toasts stay actionable).
    backend.onRequest('agent.sendQueuedMessageNow', () => {
      throw new BackendError(
        buildErrorPayload('BACKEND_ERROR', 'Internal error', {
          rpcCode: -32603,
          data: { detail: 'queue store unavailable' },
        }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.sendQueuedNow({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'qm-9',
    });
    expect(result).toEqual({ success: false, error: 'Internal error: queue store unavailable' });
  });

  it('getQueue forwards agent.getQueue and returns the daemon queue array verbatim (incl. messageMetadata)', async () => {
    // PROTOCOL §5.5/§6.6: `{ agentId }` → `{ success, queue: QueuedMessage[] }`.
    // Entries may carry optional opaque `messageMetadata` — passed through
    // untouched (thin-presenter rule: no healing/normalizing).
    const queue = [
      { id: 'q-1', content: 'a', position: 0, queuedAt: '2026-01-01T00:00:00.000Z' },
      {
        id: 'q-2',
        content: '[WORKSPACE EVENTS] woken by 1 event(s)',
        position: 1,
        queuedAt: '2026-01-01T00:00:01.000Z',
        messageMetadata: { type: 'event_notification', eventCount: 1 },
      },
    ];
    backend.onRequest('agent.getQueue', () => ({ success: true, queue }));
    const client = new LiveAgentsClient();

    const result = await client.getQueue('agent-1');
    expect(result).toEqual(queue);
    expect(backend.requests[0]).toEqual({
      method: 'agent.getQueue',
      params: { agentId: 'agent-1' },
    });
  });

  it('getQueue returns [] when the daemon body omits queue', async () => {
    backend.onRequest('agent.getQueue', () => ({ success: true }));
    const client = new LiveAgentsClient();

    expect(await client.getQueue('agent-1')).toEqual([]);
  });

  it('getQueue propagates a BackendError rejection (read seam — callers handle it)', async () => {
    backend.onRequest('agent.getQueue', () => {
      throw new BackendError(
        buildErrorPayload('BACKEND_ERROR', 'not found: agent session', { rpcCode: -32004 }),
      );
    });
    const client = new LiveAgentsClient();

    await expect(client.getQueue('agent-ghost')).rejects.toMatchObject({
      name: 'BackendError',
      message: 'not found: agent session',
      rpcCode: -32004,
    });
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

  it('cancelSubscriptions forwards the unscoped §5.5 request with no optional keys on the wire', async () => {
    // PROTOCOL §5.5: unscoped agent.cancelSubscriptions takes exactly
    // `{ agentId, workspaceId }` — a present-but-non-string subscriptionId /
    // groupId is rejected with -32602, so undefined must never be serialized.
    backend.onRequest('agent.cancelSubscriptions', () => ({ success: true }));
    const client = new LiveAgentsClient();

    const result = await client.cancelSubscriptions({ agentId: 'agent-1', workspaceId: 'ws-1' });
    expect(result).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.cancelSubscriptions',
      params: { agentId: 'agent-1', workspaceId: 'ws-1' },
    });
  });

  it('cancelSubscriptions forwards subscriptionId scoping (§5.5 scoped watch cancel)', async () => {
    backend.onRequest('agent.cancelSubscriptions', () => ({ success: true }));
    const client = new LiveAgentsClient();

    await client.cancelSubscriptions({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      subscriptionId: 'watch-1',
    });
    expect(backend.requests[0]).toEqual({
      method: 'agent.cancelSubscriptions',
      params: { agentId: 'agent-1', workspaceId: 'ws-1', subscriptionId: 'watch-1' },
    });
  });

  it('cancelSubscriptions forwards groupId scoping (§5.5 scoped group cancel)', async () => {
    backend.onRequest('agent.cancelSubscriptions', () => ({ success: true }));
    const client = new LiveAgentsClient();

    await client.cancelSubscriptions({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      groupId: 'grp-1',
    });
    expect(backend.requests[0]).toEqual({
      method: 'agent.cancelSubscriptions',
      params: { agentId: 'agent-1', workspaceId: 'ws-1', groupId: 'grp-1' },
    });
  });

  it('cancelSubscriptions folds an unknown-id -32602 rejection into a non-success result', async () => {
    // PROTOCOL §5.5: an id that does not name a watch/group owned by agentId
    // rejects with -32602 BEFORE anything is removed (all-or-nothing).
    backend.onRequest('agent.cancelSubscriptions', () => {
      throw new BackendError(
        buildErrorPayload('INVALID_PARAMS', 'unknown subscription id: watch-missing', {
          rpcCode: -32602,
        }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.cancelSubscriptions({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      subscriptionId: 'watch-missing',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown subscription id');
  });

  it('dismissQuestions forwards agent.dismissQuestions with §5.5 params and folds the ack into success', async () => {
    // PROTOCOL §5.5: agent.dismissQuestions takes `{ agentId, workspaceId,
    // messageId }` (all required) and returns `{ success: true,
    // dismissedQuestionsMessageId }`. The daemon persists the marker in
    // session metadata (survives reload) and emits `agent:updated`.
    backend.onRequest('agent.dismissQuestions', () => ({
      success: true,
      dismissedQuestionsMessageId: 'msg-q1',
    }));
    const client = new LiveAgentsClient();

    const result = await client.dismissQuestions({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'msg-q1',
    });
    expect(result).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.dismissQuestions',
      params: { agentId: 'agent-1', workspaceId: 'ws-1', messageId: 'msg-q1' },
    });
  });

  it('dismissQuestions folds a daemon NotFound rejection into {success:false,error} (no throw)', async () => {
    // Workspace mismatch / unknown agent rejects with NotFound (-32004) per
    // the §5.5 contract — the mutation seam never throws.
    backend.onRequest('agent.dismissQuestions', () => {
      throw new BackendError(
        buildErrorPayload('BACKEND_ERROR', 'not found: agent session agent-x', {
          rpcCode: -32004,
        }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.dismissQuestions({
      agentId: 'agent-x',
      workspaceId: 'ws-1',
      messageId: 'msg-q1',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found: agent session');
  });

  it('markSeen forwards agent.markSeen with §4.5 params and folds the ack into success', async () => {
    // PROTOCOL §4.5: agent.markSeen takes `{ workspaceId, agentId,
    // messageId }` (all required) and returns `{ success: true,
    // lastSeenMessageId }`. The daemon persists the marker in session
    // metadata (served on AgentLite) and emits `agent:updated`.
    backend.onRequest('agent.markSeen', () => ({
      success: true,
      lastSeenMessageId: 'msg-9',
    }));
    const client = new LiveAgentsClient();

    const result = await client.markSeen({
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      messageId: 'msg-9',
    });
    expect(result).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.markSeen',
      params: { workspaceId: 'ws-1', agentId: 'agent-1', messageId: 'msg-9' },
    });
  });

  it('markSeen folds a daemon NotFound rejection into {success:false,error} (no throw)', async () => {
    // Workspace mismatch / unknown agent rejects with NotFound (-32004) —
    // the mutation seam never throws (the trigger is fire-and-forget).
    backend.onRequest('agent.markSeen', () => {
      throw new BackendError(
        buildErrorPayload('BACKEND_ERROR', 'not found: agent session agent-x', {
          rpcCode: -32004,
        }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.markSeen({
      agentId: 'agent-x',
      workspaceId: 'ws-1',
      messageId: 'msg-9',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found: agent session');
  });

  it('rename forwards agent.rename with §5.5 params and folds the ack into success', async () => {
    // PROTOCOL §5.5: agent.rename takes `{ agentId, name }` (name non-empty)
    // and returns `{ success: true, name }`; an applied rename emits
    // `agent:renamed`. The user-initiated seam never sends the optional
    // `skipIfExplicitlySet` guard — a user rename always wins — and the
    // seam's optional workspaceId argument stays off the wire.
    backend.onRequest('agent.rename', () => ({ success: true, name: 'New Name' }));
    const client = new LiveAgentsClient();

    expect(await client.rename('agent-1', 'New Name', 'ws-1')).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.rename',
      params: { agentId: 'agent-1', name: 'New Name' },
    });
    expect(backend.requests[0]?.params).not.toHaveProperty('skipIfExplicitlySet');
    expect(backend.requests[0]?.params).not.toHaveProperty('workspaceId');
  });

  it('rename forwards skipIfExplicitlySet: true when a caller opts into the §5.5 rename guard', async () => {
    // Automated renames (e.g. the chief first-message rename in
    // chat-send-service) pass options.skipIfExplicitlySet so the daemon
    // leaves an explicitly-named session untouched and acks
    // `{ success: true, name, skipped: true }`.
    backend.onRequest('agent.rename', () => ({ success: true, name: 'Derived Title' }));
    const client = new LiveAgentsClient();

    const result = await client.rename('agent-1', 'Derived Title', undefined, {
      skipIfExplicitlySet: true,
    });
    expect(result).toEqual({ success: true });
    expect(backend.requests[0]).toEqual({
      method: 'agent.rename',
      params: { agentId: 'agent-1', name: 'Derived Title', skipIfExplicitlySet: true },
    });
    expect(backend.requests[0]?.params).not.toHaveProperty('workspaceId');
  });

  it('rename surfaces a daemon rejection as a non-success MutationResult (no throw)', async () => {
    backend.onRequest('agent.rename', () => {
      throw new BackendError(
        buildErrorPayload('INVALID_PARAMS', 'name must be a non-empty string', {
          rpcCode: -32602,
        }),
      );
    });
    const client = new LiveAgentsClient();

    const result = await client.rename('agent-1', '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('name must be a non-empty string');
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

  it('list carries lastMessageRole + lastUserMessage verbatim (§5.5 additive freshness fields)', async () => {
    backend.onRequest('agent.list', () => ({
      agents: [
        {
          id: 'agent-1',
          workspaceId: 'ws-1',
          name: 'A1',
          status: 'idle',
          lastUserMessage: 'newest user line\nsecond line',
          lastMessageRole: 'user',
        },
      ],
    }));
    const client = new LiveAgentsClient();

    const [agent] = await client.list('ws-1');
    expect(agent).toMatchObject({
      lastUserMessage: 'newest user line\nsecond line',
      lastMessageRole: 'user',
    });
  });

  it('does not synthesize lastMessageRole when the daemon omits it (older daemon)', async () => {
    backend.onRequest('agent.get', () => ({
      agent: { id: 'agent-1', workspaceId: 'ws-1', name: 'A1', status: 'idle' },
    }));
    const client = new LiveAgentsClient();

    const agent = await client.get('agent-1');
    expect(agent?.lastMessageRole).toBeUndefined();
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

  it('getConversation forwards aroundMessageId (§5.5 seek) and surfaces prevToken', async () => {
    backend.onRequest('agent.getConversation', () => ({
      messages: [{ id: 'msg-target' }],
      truncated: true,
      totalMessages: 900,
      nextToken: 'older-tok',
      prevToken: 'newer-tok',
    }));
    const client = new LiveAgentsClient();

    const page = await client.getConversation('agent-1', 200, undefined, 'msg-target');

    expect(backend.requests[0]).toEqual({
      method: 'agent.getConversation',
      params: { agentId: 'agent-1', limit: 200, aroundMessageId: 'msg-target' },
    });
    expect(page.nextToken).toBe('older-tok');
    expect(page.prevToken).toBe('newer-tok');
    expect(page.messages).toHaveLength(1);
  });

  it('getConversation normalizes a missing prevToken to null (legacy backward pages)', async () => {
    backend.onRequest('agent.getConversation', () => ({
      messages: [],
      truncated: false,
      totalMessages: 0,
      nextToken: null,
    }));
    const client = new LiveAgentsClient();

    const page = await client.getConversation('agent-1');
    expect(page.prevToken).toBeNull();
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

    it('surfaces the redriven head entry\u2019s turnId (monorepo#1057)', async () => {
      // §5.5: turnId is present only with redriven:true — the requeued
      // entry's PRESERVED turn-correlation id (same id the original
      // send/enqueue RPC returned), peeked before the drain pops it.
      backend.onRequest('agent.retry', () => ({
        ok: true,
        redriven: true,
        turnId: 'turn-original',
      }));
      const client = new LiveAgentsClient();

      const result = await client.retry('agent-retry-1', 'ws-retry-1');
      expect(result).toEqual({ ok: true, redriven: true, turnId: 'turn-original' });
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

// ---- Typed per-workspace agent channel (PROTOCOL §6.9, monorepo#775) -------
// On liveState daemons `subscribe` registers ONE `agent.subscribe` per
// workspace id — a bare `{ workspaceId }` frame, the params shape that routes
// to the collection channel rather than the deprecated `eventTypes` service
// alias (§6.9). The channel carries `AgentLite` entities; `agent:deleted`
// (the soft-hide-then-commit deletion flow's convergence signal) arrives as a
// `removedIds` delta. Snapshots/deltas reconcile per channel and merge;
// workspace add/delete re-reconciles the channel set. The subscription is
// live only while EVERY channel is push-confirmed — any gap keeps legacy
// refetches serving.
describe('LiveAgentsClient.subscribe typed per-workspace agent channel (PROTOCOL §6.9)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  let backend: MockBackendHandle;

  const requestsFor = (method: string) =>
    backend.requests.filter((r) => r.method === method).map((r) => r.params);

  // §6.9-shaped wire entity as carried by the agent channel: the `AgentLite`
  // projection (camelCase serde, `workspaceId` always present, no `rev`).
  const wireAgent = (id: string, workspaceId: string, name: string, status = 'idle') => ({
    id,
    workspaceId,
    name,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const pushSnapshot = (subscriptionId: string, seq: number, snapshot: unknown[]) =>
    backend.pushSubscriptionPush({ subscriptionId, kind: 'snapshot', seq, snapshot });
  const pushDelta = (
    subscriptionId: string,
    seq: number,
    delta: { added?: unknown[]; updated?: unknown[]; removedIds?: string[] },
  ) => backend.pushSubscriptionPush({ subscriptionId, kind: 'delta', seq, delta });
  const fireLegacy = (type: string) => backend.pushEvent({ type });

  // Mutable daemon fixture the mock serves: the workspace set and each
  // workspace's `agent.list` rows (the legacy/bridging refetch source).
  let workspaceIds: string[] = [];
  let agentsByWorkspace: Record<string, unknown[]> = {};
  let chanSeq = 0;

  beforeEach(() => {
    backend = installMockBackend();
    backend.setLiveStateCapability(true);
    chanSeq = 0;
    workspaceIds = ['ws-1', 'ws-2'];
    agentsByWorkspace = {};
    backend.onRequest('workspace.list', () => ({
      workspaces: workspaceIds.map((id) => ({ id })),
    }));
    backend.onRequest('agent.subscribe', () => {
      chanSeq += 1;
      return { subscriptionId: `chan-${chanSeq}` };
    });
    backend.onRequest('agent.unsubscribe', () => ({ success: true }));
    backend.onRequest('agent.list', (params) => {
      const wsId = (params as { workspaceId?: string })?.workspaceId ?? '';
      return { agents: agentsByWorkspace[wsId] ?? [] };
    });
  });

  afterEach(() => {
    resetMockBackend();
  });

  it('registers one agent.subscribe per workspace with bare { workspaceId } params', async () => {
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(() => {});

    await vi.waitFor(() => {
      expect(requestsFor('agent.subscribe')).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
    });
    // The bare frame is what routes to the §6.9 collection channel — an
    // `eventTypes`-bearing frame would fall through to the deprecated alias.
    for (const params of requestsFor('agent.subscribe')) {
      expect(params).not.toHaveProperty('eventTypes');
    }
    unsubscribe();
  });

  it('does not register channels on a daemon without liveState — legacy refetches keep serving', async () => {
    backend.setLiveStateCapability(false);
    workspaceIds = ['ws-1'];
    agentsByWorkspace = { 'ws-1': [wireAgent('agent-leg-1', 'ws-1', 'A')] };
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);

    // Initial one-shot refetch aggregates across workspaces as before.
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect((handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>).map((a) => a.id)).toEqual([
      'agent-leg-1',
    ]);
    expect(requestsFor('agent.subscribe')).toEqual([]);

    // A legacy lifecycle event still refetches.
    const listCallsBefore = requestsFor('agent.list').length;
    fireLegacy('agent:status-changed');
    await flush();
    expect(requestsFor('agent.list').length).toBeGreaterThan(listCallsBefore);
    unsubscribe();
  });

  it('goes live only when every workspace channel is snapshot-confirmed, merging their agents', async () => {
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();

    // Only chan-1 (ws-1) confirmed: not live yet — legacy events still refetch.
    pushSnapshot('chan-1', 0, [wireAgent('agent-a', 'ws-1', 'A')]);
    const listCallsBefore = requestsFor('agent.list').length;
    fireLegacy('agent:status-changed');
    await flush();
    expect(requestsFor('agent.list').length).toBeGreaterThan(listCallsBefore);

    // chan-2 (ws-2) confirms: live — the merged cross-workspace collection emits.
    pushSnapshot('chan-2', 0, [wireAgent('agent-b', 'ws-2', 'B')]);
    const merged = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(merged.map((a) => a.id).sort()).toEqual(['agent-a', 'agent-b']);
    expect(merged.find((a) => a.id === 'agent-a')).toMatchObject({
      workspaceId: 'ws-1',
      status: 'idle',
    });

    // A lifecycle-driven `updated` delta reconciles the projection; legacy
    // agent events no longer refetch.
    pushDelta('chan-2', 1, { updated: [wireAgent('agent-b', 'ws-2', 'B', 'active')] });
    const afterDelta = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(afterDelta.find((a) => a.id === 'agent-b')).toMatchObject({ status: 'active' });
    const listCallsLive = requestsFor('agent.list').length;
    fireLegacy('agent:status-changed');
    fireLegacy('agent:idle');
    await flush();
    expect(requestsFor('agent.list')).toHaveLength(listCallsLive);
    unsubscribe();
  });

  it('primes the agentWorkspaceIndex from push entities exactly like the list/get paths', async () => {
    backend.onRequest('agent.sendMessage', () => ({ success: true }));
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(() => {});
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();

    // Snapshot and delta entities flow through normalizeAgent, so the cache
    // holds their workspaceIds without any list()/get() having run.
    pushSnapshot('chan-1', 0, [wireAgent('agent-prime-snap', 'ws-1', 'S')]);
    pushSnapshot('chan-2', 0, []);
    pushDelta('chan-2', 1, { added: [wireAgent('agent-prime-delta', 'ws-2', 'D')] });

    expect(await client.send('agent-prime-snap', 'hi')).toEqual({ success: true });
    expect(await client.send('agent-prime-delta', 'ho')).toEqual({ success: true });
    // No agent.get fallback fired — the workspaceId came from the primed cache.
    expect(requestsFor('agent.get')).toEqual([]);
    expect(requestsFor('agent.sendMessage')).toEqual([
      expect.objectContaining({ agentId: 'agent-prime-snap', workspaceId: 'ws-1' }),
      expect.objectContaining({ agentId: 'agent-prime-delta', workspaceId: 'ws-2' }),
    ]);
    unsubscribe();
  });

  // Deletion-flow convergence (soft-hide-then-commit, agent-mutation-service):
  // after the committed `agent.delete` succeeds the daemon emits
  // `agent:deleted`, which the typed channel delivers as a `removedIds` delta
  // — the hidden session reconciles away without a legacy refetch.
  it('converges the deletion flow: agent.delete then an agent:deleted removedIds delta drops the session', async () => {
    backend.onRequest('agent.delete', () => ({ success: true }));
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();
    pushSnapshot('chan-1', 0, [
      wireAgent('agent-del-1', 'ws-1', 'Doomed'),
      wireAgent('agent-keep-1', 'ws-1', 'Kept'),
    ]);
    pushSnapshot('chan-2', 0, []);

    // The commit path fires the real wire delete (§5.5)…
    expect(await client.delete('agent-del-1')).toEqual({ success: true });
    expect(requestsFor('agent.delete')).toEqual([{ agentId: 'agent-del-1' }]);

    // …and the daemon's agent:deleted arrives as a typed removedIds delta.
    const listCallsBefore = requestsFor('agent.list').length;
    pushDelta('chan-1', 1, { removedIds: ['agent-del-1'] });
    const afterDelete = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(afterDelete.map((a) => a.id)).toEqual(['agent-keep-1']);
    // Convergence came from the delta — no legacy refetch fired.
    expect(requestsFor('agent.list')).toHaveLength(listCallsBefore);
    unsubscribe();
  });

  it('a created workspace registers a new channel and merges its snapshot', async () => {
    workspaceIds = ['ws-1'];
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() =>
      expect(requestsFor('agent.subscribe')).toEqual([{ workspaceId: 'ws-1' }]),
    );
    await flush();
    pushSnapshot('chan-1', 0, [wireAgent('agent-a', 'ws-1', 'A')]);

    workspaceIds = ['ws-1', 'ws-2'];
    fireLegacy('workspace:created');
    await vi.waitFor(() => {
      expect(requestsFor('agent.subscribe')).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
    });
    await flush();

    pushSnapshot('chan-2', 0, [wireAgent('agent-b', 'ws-2', 'B')]);
    const merged = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(merged.map((a) => a.id).sort()).toEqual(['agent-a', 'agent-b']);
    unsubscribe();
  });

  it('a deleted workspace unsubscribes its channel and evicts its agents', async () => {
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();
    pushSnapshot('chan-1', 0, [wireAgent('agent-a', 'ws-1', 'A')]);
    pushSnapshot('chan-2', 0, [wireAgent('agent-b', 'ws-2', 'B')]);

    workspaceIds = ['ws-1'];
    fireLegacy('workspace:deleted');
    await vi.waitFor(() => {
      expect(requestsFor('agent.unsubscribe')).toEqual([{ subscriptionId: 'chan-2' }]);
    });
    const evicted = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(evicted.map((a) => a.id)).toEqual(['agent-a']);
    unsubscribe();
  });

  it('stays legacy while any channel registration fails — refetches keep serving', async () => {
    agentsByWorkspace = {
      'ws-1': [wireAgent('agent-a', 'ws-1', 'A')],
      'ws-2': [wireAgent('agent-b', 'ws-2', 'B')],
    };
    backend.onRequest('agent.subscribe', (params) => {
      const wsId = (params as { workspaceId?: string })?.workspaceId;
      if (wsId === 'ws-2') throw new Error('boom');
      chanSeq += 1;
      return { subscriptionId: `chan-${chanSeq}` };
    });
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();

    // chan-1 confirms but ws-2's registration failed: never live.
    pushSnapshot('chan-1', 0, [wireAgent('agent-a', 'ws-1', 'A')]);
    const listCallsBefore = requestsFor('agent.list').length;
    fireLegacy('agent:status-changed');
    await flush();
    expect(requestsFor('agent.list').length).toBeGreaterThan(listCallsBefore);
    // The refetch (not the lone snapshot) serves the full cross-workspace set.
    const served = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(served.map((a) => a.id).sort()).toEqual(['agent-a', 'agent-b']);
    unsubscribe();
  });

  it('reconnect re-enumerates workspaces and re-registers only the surviving channels', async () => {
    const handler = vi.fn();
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();
    pushSnapshot('chan-1', 0, [wireAgent('agent-a', 'ws-1', 'A')]);
    pushSnapshot('chan-2', 0, [wireAgent('agent-b', 'ws-2', 'B')]);

    // ws-2 disappeared during the outage. The reconnect handler re-registers
    // both surviving channel states synchronously (ws-1 → chan-3, ws-2 →
    // chan-4); the id source's reconnect refresh then re-enumerates and
    // reconciles ws-2 away — its dead channel is unsubscribed instead of
    // pinning the subscription in legacy mode.
    workspaceIds = ['ws-1'];
    backend.triggerReconnect();
    await vi.waitFor(() => {
      expect(requestsFor('agent.subscribe').slice(2)).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
      expect(requestsFor('agent.unsubscribe')).toEqual([{ subscriptionId: 'chan-4' }]);
    });

    // The surviving ws-1 channel's recovery snapshot re-enters live mode with
    // only ws-1's agents.
    pushSnapshot('chan-3', 0, [wireAgent('agent-a', 'ws-1', 'A')]);
    await flush();
    const recovered = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(recovered.map((a) => a.id)).toEqual(['agent-a']);
    unsubscribe();
  });

  it('unsubscribes every workspace channel on dispose', async () => {
    const client = new LiveAgentsClient();
    const unsubscribe = client.subscribe(() => {});
    await vi.waitFor(() => expect(requestsFor('agent.subscribe')).toHaveLength(2));
    await flush();

    unsubscribe();
    expect(requestsFor('agent.unsubscribe')).toEqual([
      { subscriptionId: 'chan-1' },
      { subscriptionId: 'chan-2' },
    ]);
  });
});
