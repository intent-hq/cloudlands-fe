/** Claude Code model listing uses the daemon catalog. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  backendRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest }),
  getBackendClientForIpcEvent: () => ({
    backendId: 'local',
    client: { request: mocks.backendRequest },
  }),
}));

async function setupAndGetHandler(channel: string) {
  const { setupClaudeCodeIPC } = await import('../claude-code.ipc');
  setupClaudeCodeIPC();
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
}

describe('claude-code IPC model listing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.backendRequest.mockReset();
  });

  it('requests models.list { providerId: "claude-code" } and maps rows to value/label', async () => {
    mocks.backendRequest.mockResolvedValue({
      providerId: 'claude-code',
      models: [{ id: 'opus', name: 'Claude Opus', description: 'Most capable' }],
      source: 'claude-code',
    });

    const handler = await setupAndGetHandler('claude-code:get-models');
    const result = await handler({});

    expect(mocks.backendRequest).toHaveBeenCalledWith('models.list', {
      providerId: 'claude-code',
    });
    expect(result).toEqual({
      success: true,
      data: [{ value: 'opus', label: 'Claude Opus', description: 'Most capable' }],
    });
  });

  it('passes forceRefresh through to the daemon', async () => {
    mocks.backendRequest.mockResolvedValue({
      providerId: 'claude-code',
      models: [{ id: 'sonnet', name: 'Claude Sonnet' }],
    });

    const handler = await setupAndGetHandler('claude-code:get-models');
    await handler({}, { forceRefresh: true });

    expect(mocks.backendRequest).toHaveBeenCalledWith('models.list', {
      providerId: 'claude-code',
      forceRefresh: true,
    });
  });
});
