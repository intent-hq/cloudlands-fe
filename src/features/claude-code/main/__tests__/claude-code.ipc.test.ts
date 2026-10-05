/** Claude availability uses daemon discovery; model listing uses the daemon catalog. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../../shared/constants/claude-code';

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
  getBackendClientForIpcEvent: () => ({
    backendId: 'local',
    client: { request: mocks.backendRequest },
  }),
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: mocks.findBinary,
  getCommonNpmPaths: (name: string) => [`/opt/homebrew/bin/${name}`],
}));

async function setupAndGetHandler(channel: string) {
  const { setupClaudeCodeIPC } = await import('../claude-code.ipc');
  setupClaudeCodeIPC();
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
}

describe('claude-code IPC availability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.findBinary.mockReset();
    mocks.backendRequest.mockReset();
  });

  it.each([
    [
      'bundled runtime without a standalone CLI',
      { installed: true, resolvedPath: '/usr/bin/npx' },
      true,
      undefined,
    ],
    ['valid adapter override without npx', { installed: true }, true, undefined],
    ['uninstalled', { installed: false }, false, CLAUDE_CODE_NPX_MISSING_WARNING],
    ['gated', { installed: false, gatedOff: 'TEST_GATE' }, false, undefined],
    ['missing', null, false, undefined],
  ])('uses daemon discovery for %s', async (_label, row, available, warning) => {
    mocks.findBinary.mockResolvedValue(null);
    mocks.backendRequest.mockResolvedValue({
      providers: row
        ? [
            {
              id: 'claude-code',
              displayName: 'Claude Code',
              command: 'npx',
              hasNpxFallback: false,
              ...row,
            },
          ]
        : [],
      npx:
        row && 'resolvedPath' in row && row.resolvedPath
          ? { resolvedPath: row.resolvedPath, version: '10.0.0', versionOk: true }
          : { resolvedPath: null, version: null, versionOk: false },
    });
    const handler = await setupAndGetHandler('claude-code:check-availability');
    const result = await handler({});
    expect(result).toEqual({ success: true, available, ...(warning ? { warning } : {}) });
    expect(mocks.backendRequest.mock.calls).toEqual([['host.providerDiscovery', {}]]);
    expect(mocks.findBinary).not.toHaveBeenCalled();
  });

  it('does not invent missing-runner guidance without an npx verdict', async () => {
    mocks.backendRequest.mockResolvedValue({
      providers: [{ id: 'claude-code', installed: false }],
    });
    const handler = await setupAndGetHandler('claude-code:check-availability');
    expect(await handler({})).toEqual({ success: true, available: false });
    expect(mocks.findBinary).not.toHaveBeenCalled();
  });

  it('preserves the legacy unavailable envelope when discovery throws', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('daemon unreachable'));
    const handler = await setupAndGetHandler('claude-code:check-availability');
    expect(await handler({})).toEqual({ success: true, available: false });
    expect(mocks.backendRequest).toHaveBeenCalledWith('host.providerDiscovery', {});
    expect(mocks.findBinary).not.toHaveBeenCalled();
  });
});

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
