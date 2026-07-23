/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  toastError: vi.fn(),
  state: { current: {} as unknown },
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
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

describe('AdditionalAgentsSettings disable guard', () => {
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
  });

  afterEach(() => {
    cleanup();
  });

  async function renderToggles() {
    const AdditionalAgentsSettings = (await import('./AdditionalAgentsSettings.svelte')).default;
    const result = render(AdditionalAgentsSettings);
    const { ACP_PROVIDERS } = await import('$shared/config/provider-config');
    const providers = Object.values(ACP_PROVIDERS).filter((p) => p.canBeDisabled);
    const toggles = await waitFor(() => {
      const found = result.getAllByRole('switch', { hidden: true });
      expect(found.length).toBe(providers.length);
      return found;
    });
    return { providers, toggles };
  }

  it('blocks toggling off an in-use provider and shows the reason', async () => {
    const { providers, toggles } = await renderToggles();
    const claudeIndex = providers.findIndex((p) => p.id === 'claude-code');
    await fireEvent.click(toggles[claudeIndex]);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'providerSettings/toggleProvider' }),
    );
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('still dispatches toggleProvider for providers not in use', async () => {
    const { providers, toggles } = await renderToggles();
    const codexIndex = providers.findIndex((p) => p.id === 'codex');
    await fireEvent.click(toggles[codexIndex]);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/toggleProvider',
        payload: ['codex'],
      }),
    );
  });

  it('always allows toggling a disabled provider back on', async () => {
    mocks.state.current = {
      ...(await buildState([])),
      providerSettings: {
        activeProviderId: 'auggie',
        enabledProviders: { 'claude-code': false },
      },
    };
    const { providers, toggles } = await renderToggles();
    const claudeIndex = providers.findIndex((p) => p.id === 'claude-code');
    await fireEvent.click(toggles[claudeIndex]);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/toggleProvider',
        payload: ['claude-code'],
      }),
    );
  });
});
