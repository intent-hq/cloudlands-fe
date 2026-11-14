/**
 * Tests for the main-process `providers:get-models` handler: a thin daemon
 * call that reads the per-provider catalog (`models.list { providerId }`,
 * PROTOCOL §6.7) on the invoking window's backend. These tests assert the
 * wire request shape, backend routing, and the envelope mapping.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  backendRequest: vi.fn(),
  remoteBackendRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest }),
  // Mirrors production routing: resolve the invoking window's backend id and
  // fail closed when that backend has no live pooled client.
  getBackendClientForIpcEvent: (event?: { sender?: { backendId?: string } }) => {
    const backendId = event?.sender?.backendId ?? 'local';
    if (backendId === 'local') {
      return { backendId, client: { request: mocks.backendRequest } };
    }
    if (backendId === 'remote-a') {
      return { backendId, client: { request: mocks.remoteBackendRequest } };
    }
    throw new Error(`Backend client is not connected: ${backendId}`);
  },
}));

const CODEX = { providerId: 'codex' };

async function setupAndGetModels() {
  const { setupProviderModelsIPC } = await import('./provider-models.ipc');
  setupProviderModelsIPC();
  const handler = mocks.handlers.get('providers:get-models');
  if (!handler) throw new Error('providers:get-models handler was not registered');
  return handler;
}

describe('providers:get-models main handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.backendRequest.mockReset();
  });

  it('requests models.list { providerId: "codex" } and maps rows to value/label', async () => {
    mocks.backendRequest.mockResolvedValue({
      providerId: 'codex',
      models: [
        {
          id: 'gpt-5.3-codex/high',
          name: 'GPT-5.3 Codex (High)',
          description: 'Deep reasoning',
        },
      ],
      source: 'codex',
    });

    const handler = await setupAndGetModels();
    const result = await handler({}, CODEX);

    expect(mocks.backendRequest).toHaveBeenCalledWith('models.list', { providerId: 'codex' });
    expect(result).toEqual({
      success: true,
      data: [
        {
          value: 'gpt-5.3-codex/high',
          label: 'GPT-5.3 Codex (High)',
          description: 'Deep reasoning',
        },
      ],
    });
  });

  it('passes forceRefresh through and preserves the daemon static-fallback warning', async () => {
    mocks.backendRequest.mockResolvedValue({
      providerId: 'codex',
      models: [{ id: 'gpt-5.3-codex/medium', name: 'GPT-5.3 Codex (Medium)' }],
      source: 'static',
      warning: 'Codex not installed; using static model list',
    });

    const handler = await setupAndGetModels();
    const result = await handler({}, { ...CODEX, forceRefresh: true });

    expect(mocks.backendRequest).toHaveBeenCalledWith('models.list', {
      providerId: 'codex',
      forceRefresh: true,
    });
    expect(result.success).toBe(true);
    expect(result.warning).toBe('Codex not installed; using static model list');
  });

  it('surfaces wire/transport failure via { success: false, error }', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('daemon unreachable'));

    const handler = await setupAndGetModels();
    const result = await handler({}, CODEX);

    expect(result.success).toBe(false);
    expect(result.error).toBe('daemon unreachable');
    expect(result.data).toBeUndefined();
  });

  it("issues models.list on the invoking window's backend, not the primary (intent#3682)", async () => {
    mocks.remoteBackendRequest.mockResolvedValue({
      providerId: 'codex',
      models: [{ id: 'remote-model', name: 'Remote Model' }],
    });

    const handler = await setupAndGetModels();
    const result = await handler({ sender: { backendId: 'remote-a' } }, CODEX);

    expect(mocks.remoteBackendRequest).toHaveBeenCalledWith('models.list', { providerId: 'codex' });
    expect(mocks.backendRequest).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ value: 'remote-model', label: 'Remote Model' }]);
  });

  it('fails closed when the window backend has no live pooled client (intent#3682)', async () => {
    const handler = await setupAndGetModels();
    const result = await handler({ sender: { backendId: 'remote-gone' } }, CODEX);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Backend client is not connected: remote-gone');
    expect(mocks.backendRequest).not.toHaveBeenCalled();
    expect(mocks.remoteBackendRequest).not.toHaveBeenCalled();
  });

  it('drops malformed rows (missing id/name) instead of failing the envelope', async () => {
    mocks.backendRequest.mockResolvedValue({
      providerId: 'codex',
      models: [
        { id: 'gpt-5.3-codex/low', name: 'GPT-5.3 Codex (Low)' },
        { id: '', name: 'No id' },
        { name: 'Missing id' },
        { id: 'missing-name' },
      ],
    });

    const handler = await setupAndGetModels();
    const result = await handler({}, CODEX);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ value: 'gpt-5.3-codex/low', label: 'GPT-5.3 Codex (Low)' }]);
  });
});
