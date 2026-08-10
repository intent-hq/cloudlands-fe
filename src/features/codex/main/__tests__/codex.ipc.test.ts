/**
 * Tests for the Codex IPC handlers.
 *
 * Both handlers are thin daemon calls: availability resolves the codex CLI
 * through `host.findBinary` (PROTOCOL §5.14) and GET_MODELS reads the
 * per-provider catalog (`models.list { providerId: 'codex' }`, PROTOCOL
 * §6.7). These tests assert the wire request shape and the envelope mapping.
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
  findBinary: vi.fn(),
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

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: mocks.findBinary,
}));

async function setupAndGetHandler(channel: string) {
  const { setupCodexIPC } = await import('../codex.ipc');
  setupCodexIPC();
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
}

async function setupAndGetModels() {
  return setupAndGetHandler('codex:get-models');
}

describe('codex IPC availability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.findBinary.mockReset();
  });

  it('reports available when the daemon resolves the codex CLI', async () => {
    mocks.findBinary.mockResolvedValue('/opt/homebrew/bin/codex');

    const handler = await setupAndGetHandler('codex:check-availability');
    const result = await handler({});

    expect(mocks.findBinary).toHaveBeenCalledWith('codex', { cache: false });
    expect(result).toEqual({ success: true, available: true });
  });

  it('reports unavailable when the codex CLI does not resolve', async () => {
    mocks.findBinary.mockResolvedValue(null);

    const handler = await setupAndGetHandler('codex:check-availability');

    expect(await handler({})).toEqual({ success: true, available: false });
  });
});

describe('codex IPC model listing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.backendRequest.mockReset();
    mocks.findBinary.mockReset();
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
