import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ electron: false, invoke: vi.fn(), resolve: vi.fn() }));
vi.mock('$lib/utils/platform-capabilities', () => ({ isElectronPlatform: () => mocks.electron }));
vi.mock('$lib/client/live/backend-transport', () => ({
  electronAPI: () => ({ invoke: mocks.invoke }),
}));
vi.mock('$lib/client/live/backend-transport-factory', () => ({
  resolveBackendTransport: mocks.resolve,
}));
import { prepareOnboardingAdapters } from './provider-adapter-preparation.client';

describe('onboarding preparation transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.electron = false;
  });
  it('captures the web transport once and uses the exact daemon contract', async () => {
    const request = vi.fn(async (method) =>
      method === 'host.providerDiscovery'
        ? { providers: [{ id: 'pi', installed: true }] }
        : { accepted: true },
    );
    mocks.resolve.mockReturnValue({ request });
    await prepareOnboardingAdapters('web:1');
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(request.mock.calls).toEqual([
      ['host.providerDiscovery', {}],
      ['host.prepareProviderAdapters', { providerIds: ['pi'] }],
    ]);
  });
  it('uses one Electron IPC operation so main captures the sender route before discovery', async () => {
    mocks.electron = true;
    mocks.invoke.mockResolvedValue(undefined);
    await prepareOnboardingAdapters('remote:1');
    expect(mocks.invoke).toHaveBeenCalledWith('providers:prepare-adapters', 'remote:1');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('quietly ignores unavailable Electron IPC on older clients', async () => {
    mocks.electron = true;
    mocks.invoke.mockRejectedValue(new Error('unavailable'));
    await expect(prepareOnboardingAdapters('a')).resolves.toBeUndefined();
  });
});
