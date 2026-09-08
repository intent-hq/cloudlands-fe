import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAvailabilityResult } from './provider-availability.client';
import { getAvailableProviderIds, getProviderAvailability } from './provider-availability.client';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
}));

type ProviderKey = keyof ProviderAvailabilityResult['providers'];

function createAvailabilityResult(
  availableProviders: Partial<Record<ProviderKey, boolean>>,
  hiddenProviders: string[] = [],
): ProviderAvailabilityResult {
  return {
    hasAnyProvider: Object.values(availableProviders).some(Boolean),
    providers: {
      auggie: { available: availableProviders.auggie ?? false },
      claudeCode: { available: availableProviders.claudeCode ?? false },
      codex: { available: availableProviders.codex ?? false },
      mock: { available: availableProviders.mock ?? false },
      opencode: { available: availableProviders.opencode ?? false },
      cortex: { available: availableProviders.cortex ?? false },
      pi: { available: availableProviders.pi ?? false },
      droid: { available: availableProviders.droid ?? false },
      grok: { available: availableProviders.grok ?? false },
      unsloth: { available: availableProviders.unsloth ?? false },
    },
    hiddenProviders,
  };
}

function mockAvailability(data: ProviderAvailabilityResult): void {
  mocks.invoke.mockResolvedValue({ success: true, data });
}

describe('provider availability client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the fetched availability data', async () => {
    const data = createAvailabilityResult({ claudeCode: true });
    mockAvailability(data);

    const result = await getProviderAvailability();

    expect(result).toEqual(data);
  });

  it('resolves claude-code as available when auggie is unavailable', async () => {
    mockAvailability(createAvailabilityResult({ claudeCode: true }));

    const availableIds = await getAvailableProviderIds();

    expect(availableIds).toEqual(['claude-code']);
  });

  it('resolves all available provider IDs when none are hidden', async () => {
    mockAvailability(
      createAvailabilityResult({
        auggie: true,
        claudeCode: true,
        codex: true,
        mock: true,
        opencode: true,
        cortex: true,
        droid: true,
      }),
    );

    const availableIds = await getAvailableProviderIds();

    expect(availableIds).toEqual([
      'auggie',
      'claude-code',
      'codex',
      'mock',
      'opencode',
      'cortex',
      'droid',
    ]);
  });

  it('never caches the result — every call hits the IPC bridge again', async () => {
    mockAvailability(createAvailabilityResult({ claudeCode: true }));
    await getProviderAvailability();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    mockAvailability(createAvailabilityResult({ codex: true }));
    const second = await getProviderAvailability();

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(second.providers.codex.available).toBe(true);
    expect(second.providers.claudeCode.available).toBe(false);
  });

  it('coalesces concurrent in-flight calls into a single IPC round-trip', async () => {
    let resolveInvoke: (value: { success: boolean; data: ProviderAvailabilityResult }) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    const data = createAvailabilityResult({ auggie: true });

    const first = getProviderAvailability();
    const second = getProviderAvailability();
    resolveInvoke!({ success: true, data });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(data);
    expect(secondResult).toEqual(data);
  });

  it('propagates a daemon RPC failure instead of returning a fabricated all-unavailable result', async () => {
    mocks.invoke.mockResolvedValue({ success: false, error: 'daemon unreachable' });

    await expect(getProviderAvailability()).rejects.toThrow('daemon unreachable');
  });

  it('reports transient discovery failure honestly and retries on the next call', async () => {
    const available = createAvailabilityResult({ codex: true });
    available.providers.antigravity = { available: true, authenticated: true };
    mockAvailability(available);
    expect((await getProviderAvailability()).providers.antigravity).toEqual({
      available: true,
      authenticated: true,
    });
    mocks.invoke.mockResolvedValueOnce({ success: false, error: 'discovery transport down' });
    await expect(getProviderAvailability()).rejects.toThrow('discovery transport down');
    mockAvailability(available);
    expect((await getProviderAvailability()).providers.antigravity?.authenticated).toBe(true);
  });

  it('default result carries no fabricated hiddenProviders empty list (gating verdict unknown)', async () => {
    // Envelope with success but no data falls back to the default result —
    // an empty hiddenProviders array there would read as an authoritative
    // "nothing hidden" verdict and let gated providers (e.g. mock) leak.
    mocks.invoke.mockResolvedValue({ success: true });

    const result = await getProviderAvailability();

    expect(result.hasAnyProvider).toBe(false);
    expect('hiddenProviders' in result).toBe(false);
    expect(result.hiddenProviders).toBeUndefined();
  });
});
