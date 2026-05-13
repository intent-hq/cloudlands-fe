import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

vi.mock(
  'typed-redux-saga',
  async () => await import('$lib/store/utils/test-helpers/typed-redux-saga-mock'),
);

import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import {
  initialState,
  providerSettingsReducer,
  setActiveProvider,
} from '../provider-settings-slice';
import { initSaga } from './provider-settings-saga';

const mockInvoke = vi.fn();

type DispatchedAction = ReturnType<typeof setActiveProvider>;

function installElectronApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { invoke: mockInvoke },
  });
}

function mockProviderAvailability(
  availableProviders: {
    auggie?: boolean;
    claudeCode?: boolean;
    codex?: boolean;
    opencode?: boolean;
    cortex?: boolean;
    mock?: boolean;
  },
  hiddenProviders: string[] = [],
): void {
  mockInvoke.mockResolvedValue({
    success: true,
    data: {
      hasAnyProvider: Object.values(availableProviders).some(Boolean),
      providers: {
        auggie: { available: availableProviders.auggie ?? false },
        claudeCode: { available: availableProviders.claudeCode ?? false },
        codex: { available: availableProviders.codex ?? false },
        opencode: { available: availableProviders.opencode ?? false },
        cortex: { available: availableProviders.cortex ?? false },
        mock: { available: availableProviders.mock ?? false },
      },
      hiddenProviders,
    },
  });
}

async function runInitSaga(): Promise<{
  dispatched: DispatchedAction[];
  activeProviderId: string;
}> {
  const dispatched: DispatchedAction[] = [];
  let providerSettings = initialState;

  await runSaga(
    {
      dispatch: (action: DispatchedAction) => {
        dispatched.push(action);
        providerSettings = providerSettingsReducer(providerSettings, action);
      },
      getState: () => ({ providerSettings }),
    },
    initSaga,
  ).toPromise();

  return { dispatched, activeProviderId: providerSettings.activeProviderId };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockInvoke.mockReset();
  localStorage.clear();
  vi.spyOn(window.localStorage, 'getItem').mockReturnValue(null);
  installElectronApi();
});

describe('provider settings initSaga', () => {
  it('switches the default active provider to claude-code when auggie is unavailable', async () => {
    mockProviderAvailability({ claudeCode: true });

    const { dispatched, activeProviderId } = await runInitSaga();

    expect(mockInvoke).toHaveBeenCalledWith(PROVIDERS_CHANNELS.GET_AVAILABILITY);
    expect(dispatched).toContainEqual(setActiveProvider('claude-code'));
    expect(activeProviderId).toBe('claude-code');
  });

  it('keeps auggie active when auggie is available', async () => {
    mockProviderAvailability({ auggie: true, claudeCode: true });

    const { dispatched, activeProviderId } = await runInitSaga();

    expect(dispatched).not.toContainEqual(setActiveProvider('claude-code'));
    expect(activeProviderId).toBe('auggie');
  });

  it('excludes hidden providers from startup validation', async () => {
    mockProviderAvailability({ mock: true, opencode: true }, ['mock']);

    const { dispatched, activeProviderId } = await runInitSaga();

    expect(dispatched).toContainEqual(setActiveProvider('opencode'));
    expect(activeProviderId).toBe('opencode');
  });
});
