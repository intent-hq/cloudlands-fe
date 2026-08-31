/**
 * @vitest-environment jsdom
 *
 * Regression test for the model-refresh rewire (intent-hq/intent#3966): the
 * post-auth status check must dispatch `reloadModelsForProvider` — the action
 * the registered modelReloadSaga listens for — not the deleted
 * `retryLoadModels`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { warmImport } from '../../test/warm-import';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (value: unknown) => void) => {
      fn({ url: { pathname: '/' } });
      return () => {};
    },
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  shell: { open: vi.fn() },
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', () => ({
  selectProviderCatalogEntry: { select: vi.fn(() => undefined) },
}));

vi.mock('$lib/components/AuggieInstructionsPanel.svelte', async () => ({
  default: (await import('./workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import AuggieSetupGate from './AuggieSetupGate.svelte';
import { reloadModelsForProvider } from '$store/renderer/slices/model/model-slice';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('./ui/__tests__/mocks/Fa.svelte'));

describe('AuggieSetupGate model refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('dispatches reloadModelsForProvider once auggie is installed and authenticated', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return {
          success: true,
          data: { hasAnyProvider: false, providers: { auggie: { available: false } } },
        };
      }
      if (channel === PROVIDERS_CHANNELS.CHECK_SINGLE) {
        return { success: true, data: { available: true, authenticated: true } };
      }
      return { success: true, data: {} };
    });

    render(AuggieSetupGate);

    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: reloadModelsForProvider.type }),
      );
    });
  });

  it('does not refresh models when auggie is not authenticated', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === PROVIDERS_CHANNELS.GET_AVAILABILITY) {
        return {
          success: true,
          data: { hasAnyProvider: false, providers: { auggie: { available: false } } },
        };
      }
      if (channel === PROVIDERS_CHANNELS.CHECK_SINGLE) {
        return { success: true, data: { available: true, authenticated: false } };
      }
      return { success: true, data: {} };
    });

    render(AuggieSetupGate);

    // Wait for the status check round-trip to settle.
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(PROVIDERS_CHANNELS.CHECK_SINGLE, {
        providerId: 'auggie',
      });
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: reloadModelsForProvider.type }),
    );
  });
});
