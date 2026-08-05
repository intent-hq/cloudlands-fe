import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ProviderAvailabilityResult } from './provider-availability.client';
import {
  clearProviderAvailabilityCache,
  getAvailableProviderIds,
  getProviderAvailability,
} from './provider-availability.client';

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
    clearProviderAvailabilityCache();
  });

  it('resolves the fetched availability data', async () => {
    const data = createAvailabilityResult({ claudeCode: true });
    mockAvailability(data);

    const result = await getProviderAvailability(true);

    expect(result).toEqual(data);
  });

  it('resolves claude-code as available when auggie is unavailable', async () => {
    mockAvailability(createAvailabilityResult({ claudeCode: true }));

    const availableIds = await getAvailableProviderIds(true);

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

    const availableIds = await getAvailableProviderIds(true);

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
});
