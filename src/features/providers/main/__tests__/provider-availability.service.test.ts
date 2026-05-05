import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS_CHANNELS } from '../../../../shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  findBinary: vi.fn(),
  ensureManagedCodexAcp: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: mocks.findBinary,
  getCommonNpmPaths: vi.fn(() => []),
}));

vi.mock('../../../codex/main/codex-acp-manager', () => ({
  ensureManagedCodexAcp: mocks.ensureManagedCodexAcp,
}));

describe('provider availability service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.findBinary.mockResolvedValue(null);
  });

  it('does not call managed codex-acp installation while checking Codex availability', async () => {
    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'codex');

    expect(result).toEqual({ success: true, providerId: 'codex', data: { available: false } });
    expect(mocks.findBinary).toHaveBeenCalledWith('codex', expect.any(Object));
    expect(mocks.ensureManagedCodexAcp).not.toHaveBeenCalled();
  });
});