/**
 * Tests for the Claude Code IPC handlers.
 *
 * Availability resolves the `claude` CLI (prerequisite) and `npx` (the adapter
 * runner) through `host.findBinary` (PROTOCOL §5.14); GET_MODELS reads the
 * per-provider catalog (`models.list { providerId: 'claude-code' }`, PROTOCOL
 * §6.7). These tests pin the three-way availability verdict, including the
 * `CLAUDE_CODE_NPX_MISSING_WARNING` case.
 */

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
  });

  it('reports available when the daemon resolves both the claude CLI and npx', async () => {
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/opt/homebrew/bin/claude' : '/opt/homebrew/bin/npx',
    );

    const handler = await setupAndGetHandler('claude-code:check-availability');
    const result = await handler({});

    expect(mocks.findBinary).toHaveBeenCalledWith('claude', {
      cache: false,
      commonPaths: ['/opt/homebrew/bin/claude'],
    });
    expect(mocks.findBinary).toHaveBeenCalledWith('npx', {
      cache: false,
      commonPaths: ['/opt/homebrew/bin/npx'],
    });
    expect(result).toEqual({ success: true, available: true });
  });

  it('reports unavailable without a warning when the claude CLI does not resolve', async () => {
    mocks.findBinary.mockResolvedValue(null);

    const handler = await setupAndGetHandler('claude-code:check-availability');
    const result = await handler({});

    expect(result).toEqual({ success: true, available: false });
    expect(mocks.findBinary).toHaveBeenCalledTimes(1);
    expect(mocks.findBinary).not.toHaveBeenCalledWith('npx', expect.anything());
  });

  it('carries CLAUDE_CODE_NPX_MISSING_WARNING when claude resolves but npx does not', async () => {
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/opt/homebrew/bin/claude' : null,
    );

    const handler = await setupAndGetHandler('claude-code:check-availability');

    expect(await handler({})).toEqual({
      success: true,
      available: false,
      warning: CLAUDE_CODE_NPX_MISSING_WARNING,
    });
  });

  it('reports unavailable when the binary lookup throws', async () => {
    mocks.findBinary.mockRejectedValue(new Error('daemon unreachable'));

    const handler = await setupAndGetHandler('claude-code:check-availability');

    expect(await handler({})).toEqual({ success: true, available: false });
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
