/**
 * AgentBackendAdapter — daemon-forwarding tests.
 *
 * The adapter is a thin `IAgentBackendService` binding over the intentd
 * JSON-RPC daemon (PROTOCOL.md §5.5). Each method forwards to `agent.*` via
 * `getBackendClient().request()`; these tests assert the request shape and
 * response mapping against a mocked backend client — no live daemon.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-intent'),
    getName: vi.fn().mockReturnValue('Intent'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

const requestMock = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('$shared/logger', () => ({
  Logger: vi.fn(function () {
    return {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
  }),
}));

async function getAdapter() {
  vi.resetModules();
  const { getAgentBackendAdapter } = await import('../agent-backend-adapter');
  return getAgentBackendAdapter();
}

describe('AgentBackendAdapter daemon forwarding', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('forwards createAgent to agent.create with the full IPC field set', async () => {
    const backendSession = {
      id: 'agent-create-1',
      workspaceId: 'ws-create-1',
      name: 'Adapter Create',
      backendSessionId: 'backend-session-create-1',
      messages: [],
    };
    requestMock.mockResolvedValueOnce({ agent: backendSession });
    const adapter = await getAdapter();

    const imageBlocks = [{ type: 'image' as const, data: 'base64-image', mimeType: 'image/png' }];
    const workspaceContext = {
      openPanels: [{ type: 'file', title: 'adapter.ts', path: 'src/adapter.ts' }],
      linkedReferences: [{ type: 'note', title: 'Spec', identifier: 'spec' }],
    };

    const result = await adapter.createAgent({
      workspaceId: 'ws-create-1' as any,
      workspacePath: '/tmp/workspace',
      name: 'Adapter Create',
      initialMessage: 'Describe this image',
      skipInitialPrompt: true,
      imageBlocks,
      workspaceContext,
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      'agent.create',
      expect.objectContaining({
        workspaceId: 'ws-create-1',
        workspacePath: '/tmp/workspace',
        name: 'Adapter Create',
        initialMessage: 'Describe this image',
        skipInitialPrompt: true,
        imageBlocks,
        workspaceContext,
      }),
    );
    const forwardedParams = requestMock.mock.calls[0][1];
    expect(forwardedParams).not.toHaveProperty('specialistName');
    expect(forwardedParams).not.toHaveProperty('roleReminder');

    expect(result).toEqual({
      agent: backendSession,
      sessionId: 'backend-session-create-1',
    });
  });

  it('throws when the daemon returns no agent', async () => {
    requestMock.mockResolvedValueOnce({});
    const adapter = await getAdapter();

    await expect(
      adapter.createAgent({
        workspaceId: 'ws-empty' as any,
        workspacePath: '/tmp/ws',
        name: 'Empty',
      }),
    ).rejects.toThrow('Failed to create agent');
  });

  it('forwards streamMessage to agent.sendMessage with the extended field set', async () => {
    requestMock.mockResolvedValueOnce({ success: true, messageId: 'msg-1' });
    const adapter = await getAdapter();

    const result = await adapter.streamMessage({
      agentId: 'agent-stream',
      workspaceId: 'ws-stream',
      content: 'Hello',
      imageBlocks: [{ type: 'image', data: 'b64', mimeType: 'image/png' }],
      fileBlocks: [{ type: 'file', fileName: 'x.txt', data: 'aGk=', mimeType: 'text/plain' }],
      model: 'sonnet-4.5',
      messageMetadata: { pinned: true },
      contextReferences: [{ path: 'src/x.ts' }],
      noteIds: ['note-1'],
      stdinContext: 'stdin-data',
      assistantMessageId: 'assist-1',
      assistantAppMessageId: 'assist-app-1',
      userAppMessageId: 'user-app-1',
    });

    expect(requestMock).toHaveBeenCalledWith(
      'agent.sendMessage',
      expect.objectContaining({
        agentId: 'agent-stream',
        workspaceId: 'ws-stream',
        content: 'Hello',
        imageBlocks: expect.any(Array),
        fileBlocks: expect.any(Array),
        model: 'sonnet-4.5',
        messageMetadata: { pinned: true },
        contextReferences: expect.any(Array),
        noteIds: ['note-1'],
        stdinContext: 'stdin-data',
        assistantMessageId: 'assist-1',
        assistantAppMessageId: 'assist-app-1',
        userAppMessageId: 'user-app-1',
      }),
    );
    expect(result).toEqual({ success: true, messageId: 'msg-1' });
  });

  it('passes through auto-queue responses from agent.sendMessage', async () => {
    // PROTOCOL.md §5.5: when the target is mid-turn, the daemon returns
    // `{ success: true, queued: true, messageId? }` instead of the retired
    // FE `IN_FLIGHT_PROMPT_DROPPED` error string.
    const queuedResponse = { success: true, queued: true, messageId: 'msg-queued' };
    requestMock.mockResolvedValueOnce(queuedResponse);
    const adapter = await getAdapter();

    await expect(
      adapter.streamMessage({ agentId: 'agent-mid-turn', workspaceId: 'ws', content: 'q' }),
    ).resolves.toEqual(queuedResponse);
  });

  it('throws genuine streamMessage failures', async () => {
    requestMock.mockResolvedValueOnce({ success: false, error: 'Provider stream failed' });
    const adapter = await getAdapter();

    await expect(
      adapter.streamMessage({ agentId: 'agent-failed', workspaceId: 'ws', content: 'x' }),
    ).rejects.toThrow('Provider stream failed');
  });

  it('forwards backendStop to agent.stop', async () => {
    requestMock.mockResolvedValueOnce({});
    const adapter = await getAdapter();

    await expect(adapter.backendStop({ agentId: 'agent-stop' })).resolves.toEqual({
      success: true,
    });
    expect(requestMock).toHaveBeenCalledWith('agent.stop', { agentId: 'agent-stop' });
  });
});
