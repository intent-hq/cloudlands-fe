import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupPersistenceIPC } from '../persistence.ipc';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage } from '$shared/types';
import type { AgentSession } from '$shared/types/agent-session';

const mocks = vi.hoisted(() => ({
  unifiedPersistence: {
    loadAgent: vi.fn(),
    saveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgents: vi.fn(),
  },
  workspacePath: vi.fn((workspaceId: string) => `/test/workspaces/${workspaceId}`),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('../agent-persistence', () => ({
  unifiedPersistence: mocks.unifiedPersistence,
  UnifiedPersistence: {
    getInstance: vi.fn(() => mocks.unifiedPersistence),
  },
}));

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: mocks.unifiedPersistence,
}));

vi.mock('../../../../shared/main/config.js', () => ({
  WorkspaceConfig: {
    paths: {
      workspace: mocks.workspacePath,
    },
  },
}));

function expectNoDuplicateNonEmptyAppMessageIds(messages: AgentMessage[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const message of messages) {
    if (!message.appMessageId) continue;
    if (seen.has(message.appMessageId)) duplicates.add(message.appMessageId);
    seen.add(message.appMessageId);
  }
  expect([...duplicates]).toEqual([]);
}

describe('Persistence IPC duplicate regression', () => {
  let handlers: Map<string, (...args: any[]) => Promise<any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as any).mockImplementation((channel: string, handler: any) => {
      handlers.set(channel, handler);
    });
    setupPersistenceIPC();
  });

  afterEach(() => {
    handlers.clear();
  });

  it('deduplicates stale frontend assistant placeholder against backend final on save', async () => {
    const appMessageId = 'app-msg-observed-final';
    const existingAgent: AgentSession = {
      id: 'agent-app-message-dedup-test' as any,
      workspaceId: 'amber-forest' as any,
      name: 'App Message Dedup Test Agent',
      status: AgentStatus.Active,
      messages: [
        {
          id: 'msg-user-1',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Hello' }],
          timestamp: '2026-03-05T17:08:49Z',
        },
        {
          id: 'msg_backend_final',
          appMessageId,
          role: 'assistant',
          contentBlocks: [
            { type: 'text', text: 'Final answer' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
            { type: 'tool_result', tool_use_id: 'toolu_1', output: { content: 'file contents' } },
          ],
          timestamp: '2026-03-05T17:08:55Z',
          isStreaming: false,
        },
      ] as any[],
      createdAt: new Date(),
      updatedAt: new Date(),
      backendSessionId: null,
    };
    const frontendSession: AgentSession = {
      ...existingAgent,
      messages: [
        existingAgent.messages[0],
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          appMessageId,
          role: 'assistant',
          contentBlocks: [
            { type: 'text', text: 'Final answer' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
          ],
          timestamp: '2026-03-05T17:08:54Z',
          isStreaming: true,
        },
        {
          id: 'msg-new-user',
          role: 'user',
          contentBlocks: [{ type: 'text', text: 'Follow up' }],
          timestamp: '2026-03-05T17:09:00Z',
        },
      ] as any[],
    };

    mocks.unifiedPersistence.loadAgent.mockResolvedValue({ success: true, data: existingAgent });
    mocks.unifiedPersistence.saveAgent.mockResolvedValue({ success: true });

    const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
    const result = await handler!({} as IpcMainInvokeEvent, {
      session: frontendSession,
      workspaceId: 'amber-forest',
    });

    expect(result.success).toBe(true);
    const savedAgent = mocks.unifiedPersistence.saveAgent.mock.calls[0][0];
    expect(savedAgent.messages.map((message: AgentMessage) => message.id)).toEqual([
      'msg-user-1',
      'msg_backend_final',
      'msg-new-user',
    ]);
    expect(savedAgent.messages[1]).toMatchObject({ appMessageId, isStreaming: false });
    expectNoDuplicateNonEmptyAppMessageIds(savedAgent.messages);
  });
});
