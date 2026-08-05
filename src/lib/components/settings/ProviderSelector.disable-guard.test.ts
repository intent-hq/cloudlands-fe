/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
  toastError: vi.fn(),
  state: { current: {} as unknown },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  shell: { open: vi.fn() },
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn().mockResolvedValue({ value: {} }) } },
}));

vi.mock('$features/pi/pi-models.client', () => ({
  checkPiMcpAdapterInstalled: vi.fn().mockResolvedValue(true),
  installPiMcpAdapter: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock('./ProviderPathConfig.svelte', async () => ({
  default: (
    await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

async function buildState(fileSpecialists: object[]) {
  const { initialState: specialistsInitialState } = await import(
    '$store/renderer/slices/specialists/specialists-slice'
  );
  const { initialState: modelInitialState } = await import(
    '$store/renderer/slices/model/model-slice'
  );
  const { createCollection } = await import(
    '$lib/store-shim/utils/collections/collection-utils'
  );
  return {
    providerSettings: {
      activeProviderId: 'auggie',
      enabledProviders: { 'claude-code': true, codex: true },
    },
    model: { ...modelInitialState, providerModels: {} },
    specialists: {
      ...specialistsInitialState,
      fileSpecialists: createCollection('id', fileSpecialists as never[]),
    },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
  };
}

const providerStatus = { available: true, authenticated: true };
const availability = {
  hasAnyProvider: true,
  providers: {
    auggie: providerStatus,
    claudeCode: providerStatus,
    codex: providerStatus,
    cortex: { available: false },
    mock: { available: false },
    opencode: { available: false },
    pi: { available: false },
    droid: { available: false },
    grok: { available: false },
  },
  hiddenProviders: ['mock', 'cortex', 'opencode', 'pi', 'droid', 'grok'],
};

describe('ProviderSelector disable guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.state.current = await buildState([
      {
        id: 'my-spec',
        name: 'My Spec',
        description: 'test',
        codingAgent: 'claude-code',
        model: '',
        behaviorPrompt: 'prompt',
        filePath: '/tmp/my-spec.md',
        source: 'user',
      },
    ]);
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === AUGGIE_CHANNELS.STATUS) {
        return {
          success: true,
          data: {
            installed: true,
            authenticated: true,
            versionOk: true,
            nodeVersionOk: true,
            minimumVersion: '0.0.0',
          },
        };
      }
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return { success: true, data: availability };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { auggie: null, 'claude-code': null, codex: null } };
      }
      return { success: true, data: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  async function renderSelector() {
    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    const buttons = await waitFor(() => {
      const found = result
        .getAllByRole('button', { hidden: true })
        .filter((b) => b.textContent?.trim() === 'Disable');
      expect(found.length).toBe(2);
      return found;
    });
    return { result, buttons };
  }

  it('disables the Disable control for an in-use provider with a reason', async () => {
    const { buttons } = await renderSelector();
    // Rows are alphabetical: Anthropic Claude Code before OpenAI Codex
    const [claudeButton, codexButton] = buttons as HTMLButtonElement[];
    expect(claudeButton.disabled).toBe(true);
    expect(claudeButton.title).toContain('My Spec');
    expect(codexButton.disabled).toBe(false);
  });

  it('still dispatches setProviderEnabled(false) for providers not in use', async () => {
    const { buttons } = await renderSelector();
    const codexButton = buttons[1] as HTMLButtonElement;
    await fireEvent.click(codexButton);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/setProviderEnabled',
        payload: [{ providerId: 'codex', enabled: false }],
      }),
    );
  });

  it('blocks disabling an in-use provider even if the click fires', async () => {
    const { buttons } = await renderSelector();
    const claudeButton = buttons[0] as HTMLButtonElement;
    await fireEvent.click(claudeButton);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'providerSettings/setProviderEnabled' }),
    );
  });
});

describe('ProviderSelector default-unavailable honesty', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows "Default (unavailable)" for a generic active provider that is not installed', async () => {
    mocks.state.current = {
      ...(await buildState([])),
      providerSettings: {
        activeProviderId: 'codex',
        enabledProviders: { 'claude-code': true, codex: true },
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === AUGGIE_CHANNELS.STATUS) {
        return {
          success: true,
          data: {
            installed: true,
            authenticated: true,
            versionOk: true,
            nodeVersionOk: true,
            minimumVersion: '0.0.0',
          },
        };
      }
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return {
          success: true,
          data: {
            ...availability,
            providers: { ...availability.providers, codex: { available: false } },
          },
        };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { auggie: null, 'claude-code': null, codex: null } };
      }
      return { success: true, data: {} };
    });

    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() => {
      expect(result.getByText('OpenAI Codex')).toBeTruthy();
    });
    expect(result.getByText('Default (unavailable)')).toBeTruthy();
  });

  it('shows "Default (unavailable)" when Auggie is active but not installed', async () => {
    mocks.state.current = {
      ...(await buildState([])),
      providerSettings: {
        activeProviderId: 'auggie',
        enabledProviders: { 'claude-code': true, codex: true },
      },
    };
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === AUGGIE_CHANNELS.STATUS) {
        return {
          success: true,
          data: {
            installed: false,
            authenticated: false,
            versionOk: false,
            nodeVersionOk: true,
            minimumVersion: '0.0.0',
          },
        };
      }
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return { success: true, data: availability };
      }
      if (channel === PROVIDERS_CHANNELS.GET_PATHS) {
        return { success: true, data: { auggie: null, 'claude-code': null, codex: null } };
      }
      return { success: true, data: {} };
    });

    const ProviderSelector = (await import('./ProviderSelector.svelte')).default;
    const result = render(ProviderSelector);
    await waitFor(() => {
      expect(result.getByText('Default (unavailable)')).toBeTruthy();
    });
  });
});
