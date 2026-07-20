import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PROVIDERS_CHANNELS } from '../../../../shared/ipc/channels';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../../shared/constants/claude-code';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  findBinary: vi.fn(),
  ensureManagedCodexAcp: vi.fn(),
  backendRequest: vi.fn(),
  findAuggiePathAsync: vi.fn(),
  hostExec: vi.fn(),
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

vi.mock('../../../codex/main/codex-acp-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../codex/main/codex-acp-manager')>()),
  ensureManagedCodexAcp: mocks.ensureManagedCodexAcp,
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest }),
}));

vi.mock('../../../auggie/main/auggie.ipc', () => ({
  findAuggiePathAsync: mocks.findAuggiePathAsync,
}));

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: mocks.hostExec,
}));

vi.mock('../../../feature-codes/main/feature-codes.service', () => ({
  featureCodesService: { isFeatureEnabled: vi.fn(() => false) },
}));

/** host.providerDiscovery body with every provider uninstalled. */
const EMPTY_DISCOVERY = {
  providers: ['auggie', 'claude-code', 'codex', 'cortex', 'opencode', 'pi', 'droid'].map(
    (id) => ({
      id,
      displayName: id,
      command: id,
      installed: false,
      resolvedPath: null,
      gatedOff: null,
      hasNpxFallback: false,
    }),
  ),
  npx: { resolvedPath: null, version: null, versionOk: false },
};

describe('provider availability service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.findBinary.mockResolvedValue(null);
    mocks.findAuggiePathAsync.mockResolvedValue(null);
    mocks.hostExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
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

  it('surfaces the npx-missing warning on the discovery path when the claude CLI is installed', async () => {
    // The daemon reports claude-code as not installed (npx-only provider,
    // npx absent), but the claude CLI itself is on the host — the aggregate
    // must still warn instead of showing a silently unavailable provider.
    mocks.backendRequest.mockResolvedValue(EMPTY_DISCOVERY);
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/usr/local/bin/claude' : null,
    );

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.available).toBe(false);
    expect(result.providers.claudeCode.warning).toBe(CLAUDE_CODE_NPX_MISSING_WARNING);
    expect(result.npx).toEqual({ resolvedPath: null, version: null, versionOk: false });
  });

  it('does not warn on the discovery path when the claude CLI is absent', async () => {
    mocks.backendRequest.mockResolvedValue(EMPTY_DISCOVERY);

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.available).toBe(false);
    expect(result.providers.claudeCode.warning).toBeUndefined();
  });

  it('does not warn on the discovery path when npx is present', async () => {
    mocks.backendRequest.mockResolvedValue({
      ...EMPTY_DISCOVERY,
      npx: { resolvedPath: '/usr/local/bin/npx', version: '10.0.0', versionOk: true },
    });
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/usr/local/bin/claude' : null,
    );

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.warning).toBeUndefined();
  });
});