import { PassThrough } from 'stream';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  AdapterDisposedError,
  CodexAppServerAcpAdapter,
} from '../codex-app-server-transport';

function createMockCodex() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: any[] = [];
  const waiters: Array<(request: any) => void> = [];
  let buffer = '';

  stdin.on('data', (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const request = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(request);
      else requests.push(request);
    }
  });

  return {
    proc: { stdin, stdout, stderr },
    async nextRequest() {
      if (requests.length > 0) return requests.shift();
      return new Promise<any>((resolve) => waiters.push(resolve));
    },
    send(message: any) {
      stdout.write(`${JSON.stringify(message)}\n`);
    },
  };
}

async function createInitializedSession(
  mock: ReturnType<typeof createMockCodex>,
  adapter: CodexAppServerAcpAdapter,
) {
  const sessionPromise = adapter.newSession({ cwd: '/repo', metadata: { model: 'gpt-5-codex' } });
  const initialize = await mock.nextRequest();
  mock.send({ jsonrpc: '2.0', id: initialize.id, result: { userAgent: 'codex-test' } });
  const start = await mock.nextRequest();
  mock.send({ jsonrpc: '2.0', id: start.id, result: { thread: { id: 'thread-1' } } });
  await sessionPromise;
  return start;
}

describe('CodexAppServerAcpAdapter', () => {
  it('maps session/new to initialize plus thread/start', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });

    const sessionPromise = adapter.newSession({
      cwd: '/workspace',
      metadata: { model: 'gpt-5-codex', systemPrompt: 'Be helpful.' },
    });

    const initialize = await mock.nextRequest();
    expect(initialize.method).toBe('initialize');
    expect(initialize.params.capabilities.experimentalApi).toBe(true);
    mock.send({ jsonrpc: '2.0', id: initialize.id, result: { userAgent: 'codex-test' } });

    const threadStart = await mock.nextRequest();
    expect(threadStart.method).toBe('thread/start');
    expect(threadStart.params).toMatchObject({
      cwd: '/workspace',
      model: 'gpt-5-codex',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      baseInstructions: 'Be helpful.',
    });
    mock.send({ jsonrpc: '2.0', id: threadStart.id, result: { thread: { id: 'thread-123' } } });

    await expect(sessionPromise).resolves.toMatchObject({
      sessionId: 'thread-123',
      modeState: { currentModeId: 'bypassPermissions' },
    });
    adapter.dispose();
  });

  it('maps session/load to thread/resume', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });

    const loadPromise = adapter.loadSession({ sessionId: 'thread-old', cwd: '/repo' });
    const initialize = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: initialize.id, result: { userAgent: 'codex-test' } });
    const resume = await mock.nextRequest();

    expect(resume.method).toBe('thread/resume');
    expect(resume.params).toMatchObject({
      threadId: 'thread-old',
      cwd: '/repo',
      excludeTurns: false,
    });
    mock.send({ jsonrpc: '2.0', id: resume.id, result: { thread: { id: 'thread-old' } } });

    await expect(loadPromise).resolves.toMatchObject({ sessionId: 'thread-old', messages: [] });
    adapter.dispose();
  });

  it('lists models through Codex model/list', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });

    const initializePromise = adapter.initialize();
    const initialize = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: initialize.id, result: { userAgent: 'codex-test' } });
    await initializePromise;

    const response = { data: [], nextCursor: null };
    const listPromise = adapter.listModels();
    const list = await mock.nextRequest();
    expect(list.method).toBe('model/list');
    expect(list.params).toEqual({});
    mock.send({ jsonrpc: '2.0', id: list.id, result: response });

    await expect(listPromise).resolves.toEqual(response);
    adapter.dispose();
  });

  it('uses unique ids for concurrent Codex requests and resolves them by id', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });

    const firstPromise = adapter.listModels();
    const secondPromise = adapter.listModels();
    const first = await mock.nextRequest();
    const second = await mock.nextRequest();

    expect(first).toMatchObject({ method: 'model/list' });
    expect(second).toMatchObject({ method: 'model/list' });
    expect(first.id).not.toBe(second.id);

    const secondResponse = { data: [{ id: 'second' }], nextCursor: null };
    const firstResponse = { data: [{ id: 'first' }], nextCursor: null };
    mock.send({ jsonrpc: '2.0', id: second.id, result: secondResponse });
    mock.send({ jsonrpc: '2.0', id: first.id, result: firstResponse });

    await expect(firstPromise).resolves.toEqual(firstResponse);
    await expect(secondPromise).resolves.toEqual(secondResponse);
    adapter.dispose();
  });

  it('maps session/prompt to turn/start and Codex notifications to ACP session/update', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    await createInitializedSession(mock, adapter);

    const notifications: any[] = [];
    adapter.on('notification', (notification) => notifications.push(notification));

    const promptPromise = adapter.prompt({
      sessionId: 'thread-1',
      prompt: [{ type: 'text', text: 'Hello Codex' }],
    });
    const turnStart = await mock.nextRequest();
    expect(turnStart.method).toBe('turn/start');
    expect(turnStart.params).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Hello Codex', text_elements: [] }],
      approvalPolicy: 'never',
    });
    mock.send({ jsonrpc: '2.0', id: turnStart.id, result: { turn: { id: 'turn-1' } } });

    mock.send({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'Hi' },
    });
    mock.send({
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'tool-1',
          server: 'workspace-mcp',
          tool: 'read_note',
          status: 'inProgress',
          arguments: { noteId: 'spec' },
        },
      },
    });
    mock.send({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'mcpToolCall',
          id: 'tool-1',
          server: 'workspace-mcp',
          tool: 'read_note',
          status: 'completed',
          arguments: { noteId: 'spec' },
          result: { content: [{ type: 'text', text: 'Spec' }] },
        },
      },
    });
    mock.send({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
    });

    await expect(promptPromise).resolves.toEqual({ stopReason: 'end_turn' });
    expect(notifications.map((n) => n.params.sessionUpdate.sessionUpdate)).toEqual([
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
      'done',
    ]);
    expect(notifications[1].params.sessionUpdate.rawInput).toEqual({
      server: 'workspace-mcp',
      tool: 'read_note',
      arguments: { noteId: 'spec' },
    });
    adapter.dispose();
  });

  it('resolves prompt when turn/completed arrives before the prompt waiter registers', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    await createInitializedSession(mock, adapter);

    const promptPromise = adapter.prompt({ sessionId: 'thread-1', prompt: 'fast' });
    const turnStart = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: turnStart.id, result: { turn: { id: 'turn-fast' } } });
    mock.send({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-fast', status: 'completed' } },
    });

    await expect(promptPromise).resolves.toEqual({ stopReason: 'end_turn' });
    adapter.dispose();
  });

  it('rejects pending Codex requests with AdapterDisposedError on dispose', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });

    const initializePromise = adapter.initialize();
    await mock.nextRequest();

    adapter.dispose();

    await expect(initializePromise).rejects.toBeInstanceOf(AdapterDisposedError);
  });

  it('rejects pending prompts with AdapterDisposedError on dispose', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    await createInitializedSession(mock, adapter);

    const promptPromise = adapter.prompt({ sessionId: 'thread-1', prompt: 'wait' });
    const turnStart = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: turnStart.id, result: { turn: { id: 'turn-wait' } } });
    await Promise.resolve();

    adapter.dispose();

    await expect(promptPromise).rejects.toBeInstanceOf(AdapterDisposedError);
  });

  it('maps session/cancel to turn/interrupt for the active turn', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    await createInitializedSession(mock, adapter);

    const promptPromise = adapter.prompt({
      sessionId: 'thread-1',
      prompt: [{ type: 'text', text: 'Stop' }],
    });
    const turnStart = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: turnStart.id, result: { turn: { id: 'turn-1' } } });

    const cancelPromise = adapter.cancel({ sessionId: 'thread-1' });
    const interrupt = await mock.nextRequest();
    expect(interrupt.method).toBe('turn/interrupt');
    expect(interrupt.params).toEqual({ threadId: 'thread-1', turnId: 'turn-1' });
    mock.send({ jsonrpc: '2.0', id: interrupt.id, result: {} });
    await cancelPromise;

    mock.send({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
    });
    await expect(promptPromise).resolves.toEqual({ stopReason: 'cancelled' });
    adapter.dispose();
  });

  it('round-trips legacy applyPatchApproval through ACP session/request_permission', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    const emitted: string[] = [];
    adapter.on('message', (message) => emitted.push(message));

    mock.send({
      jsonrpc: '2.0',
      id: 'legacy-approval-1',
      method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-1',
        callId: 'patch-1',
        fileChanges: { '/repo/file.ts': { type: 'update', unified_diff: '@@', move_path: null } },
        reason: 'Need to edit a file',
        grantRoot: null,
      },
    });

    const acpRequest = JSON.parse(emitted[0]);
    expect(acpRequest).toMatchObject({
      method: 'session/request_permission',
      params: {
        sessionId: 'thread-1',
        toolCall: { toolCallId: 'patch-1', title: 'Allow Codex file changes', kind: 'edit' },
      },
    });

    await adapter.handleAcpMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: acpRequest.id,
        result: { outcome: { outcome: 'selected', optionId: 'allow_once' } },
      }),
    );
    const codexResponse = await mock.nextRequest();
    expect(codexResponse).toEqual({
      jsonrpc: '2.0',
      id: 'legacy-approval-1',
      result: { decision: 'approved' },
    });
    adapter.dispose();
  });

  it('round-trips v2 item permissions approval through ACP session/request_permission', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    const emitted: string[] = [];
    adapter.on('message', (message) => emitted.push(message));

    const permissions = {
      network: { allow: ['example.com'] },
      fileSystem: { writableRoots: ['/repo'] },
    };
    mock.send({
      jsonrpc: '2.0',
      id: 'v2-approval-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        cwd: '/repo',
        reason: 'Need network and filesystem access',
        permissions,
      },
    });

    const acpRequest = JSON.parse(emitted[0]);
    expect(acpRequest).toMatchObject({
      method: 'session/request_permission',
      params: {
        sessionId: 'thread-1',
        toolCall: { toolCallId: 'item-1', title: 'Allow Codex additional permissions' },
      },
    });

    await adapter.handleAcpMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: acpRequest.id,
        result: { outcome: { outcome: 'selected', optionId: 'allow_session' } },
      }),
    );
    const codexResponse = await mock.nextRequest();
    expect(codexResponse).toEqual({
      jsonrpc: '2.0',
      id: 'v2-approval-1',
      result: { permissions, scope: 'session', strictAutoReview: false },
    });
    adapter.dispose();
  });

  it('forwards Codex model reroute and config warnings as diagnostic session updates', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });
    await createInitializedSession(mock, adapter);
    const notifications: any[] = [];
    adapter.on('notification', (notification) => notifications.push(notification));

    mock.send({
      jsonrpc: '2.0',
      method: 'model/rerouted',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        fromModel: 'gpt-5-codex',
        toModel: 'gpt-5-mini',
        reason: 'rate_limited',
      },
    });
    mock.send({
      jsonrpc: '2.0',
      method: 'configWarning',
      params: {
        summary: 'Invalid config value',
        details: 'Using default instead.',
        path: '/repo/.codex/config.toml',
      },
    });

    expect(notifications.map((n) => n.params.sessionUpdate.content.text)).toEqual([
      '[Codex warning] Model rerouted from gpt-5-codex to gpt-5-mini: rate_limited',
      '[Codex warning] Invalid config value (/repo/.codex/config.toml). Using default instead.',
    ]);
    expect(
      notifications.every((n) => n.params.sessionUpdate.sessionUpdate === 'agent_message_chunk'),
    ).toBe(true);
    adapter.dispose();
  });

  it('handles ACP JSON-RPC requests directly for future provider wiring', async () => {
    const mock = createMockCodex();
    const adapter = new CodexAppServerAcpAdapter(mock.proc, { requestTimeoutMs: 500 });

    const responsePromise = adapter.handleAcpMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'session/new', params: { cwd: '/repo' } }),
    );
    const initialize = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: initialize.id, result: { userAgent: 'codex-test' } });
    const start = await mock.nextRequest();
    mock.send({ jsonrpc: '2.0', id: start.id, result: { thread: { id: 'thread-jsonrpc' } } });

    const responseText = await responsePromise;
    expect(responseText).not.toBeNull();
    const response = JSON.parse(responseText ?? '');
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 10,
      result: { sessionId: 'thread-jsonrpc' },
    });
    adapter.dispose();
  });
});
