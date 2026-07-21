/**
 * Tests for the Codex IPC handlers.
 *
 * GET_MODELS is a thin call to the daemon's per-provider catalog
 * (`models.list { providerId: 'codex' }`, PROTOCOL §6.7) — the daemon owns
 * the ACP/app-server probes and the static fallback. These tests assert the
 * wire request shape and the envelope mapping.
 */

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  backendRequest: vi.fn(),
  resolveCodexModelListCommands: vi.fn(),
  getManagedCodexAcpStatus: vi.fn(),
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
}));

vi.mock('../codex-resolver', () => ({
  resolveCodexModelListCommands: mocks.resolveCodexModelListCommands,
}));

vi.mock('../codex-acp-manager', () => ({
  getManagedCodexAcpStatus: mocks.getManagedCodexAcpStatus,
}));

async function setupAndGetModels() {
  const { setupCodexIPC } = await import('../codex.ipc');
  setupCodexIPC();
  const handler = mocks.handlers.get('codex:get-models');
  if (!handler) throw new Error('codex:get-models handler was not registered');
  return handler;
}

describe('codex IPC model listing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.backendRequest.mockReset();
    mocks.resolveCodexModelListCommands.mockReset();
    mocks.getManagedCodexAcpStatus.mockReturnValue({ state: 'not_installed', version: '0.16.0' });
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
    const result = await handler({});

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
    const result = await handler({}, { forceRefresh: true });

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
    const result = await handler({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('daemon unreachable');
    expect(result.data).toBeUndefined();
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
    const result = await handler({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { value: 'gpt-5.3-codex/low', label: 'GPT-5.3 Codex (Low)' },
    ]);
  });
});
