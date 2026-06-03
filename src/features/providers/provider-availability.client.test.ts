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
  getProviderAvailability,
} from './provider-availability.client';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  validateActiveProvider: vi.fn((availableProviderIds: string[]) => ({
    type: 'providerSettings/validateActiveProvider',
    payload: availableProviderIds,
  })),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => {},
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/provider-settings/provider-settings-slice', () => ({
  validateActiveProvider: mocks.validateActiveProvider,
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
    },
    hiddenProviders,
  };
}

function mockAvailability(data: ProviderAvailabilityResult): void {
  mocks.invoke.mockResolvedValue({ success: true, data });
}

function expectValidatedProviderIds(providerIds: string[]): void {
  expect(mocks.validateActiveProvider).toHaveBeenCalledWith(providerIds);
  expect(mocks.dispatch).toHaveBeenCalledWith({
    type: 'providerSettings/validateActiveProvider',
    payload: providerIds,
  });
}

describe('provider availability client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderAvailabilityCache();
  });

  it('dispatches validateActiveProvider with claude-code when auggie is unavailable', async () => {
    mockAvailability(createAvailabilityResult({ claudeCode: true }));

    await getProviderAvailability(true);

    expectValidatedProviderIds(['claude-code']);
  });

  it('excludes hidden providers from validateActiveProvider even when available', async () => {
    mockAvailability(createAvailabilityResult({ auggie: true, claudeCode: true }, ['auggie']));

    await getProviderAvailability(true);

    expectValidatedProviderIds(['claude-code']);
  });

  it('dispatches all available provider IDs when none are hidden', async () => {
    mockAvailability(
      createAvailabilityResult({
        auggie: true,
        claudeCode: true,
        codex: true,
        mock: true,
        opencode: true,
        cortex: true,
      }),
    );

    await getProviderAvailability(true);

    expectValidatedProviderIds(['auggie', 'claude-code', 'codex', 'mock', 'opencode', 'cortex']);
  });
});
