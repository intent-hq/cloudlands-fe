/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), state: { current: {} as unknown } }));

vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn(), shell: { open: vi.fn() } }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

async function buildState({
  cursorEnabled,
  cursor = { available: true, authenticated: true },
}: {
  cursorEnabled: boolean;
  cursor?: object;
}) {
  const { initialState: modelInitialState } =
    await import('$store/renderer/slices/model/model-slice');
  const { initialState: providerSettingsInitialState } =
    await import('$store/renderer/slices/provider-settings/provider-settings-slice');
  const { initialState: availabilityInitialState } =
    await import('$store/renderer/slices/agent-availability/agent-availability-slice');
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_CURSOR_PROVIDER, MOCK_PROVIDER_CATALOG } =
    await import('../../../test/fixtures/provider-catalog.fixture');
  const codex = MOCK_PROVIDER_CATALOG.providers.find((row) => row.id === 'codex')!;
  return {
    providerCatalog: providerCatalogReducer(
      initialState,
      providerCatalogLoaded({ providers: [codex, MOCK_CURSOR_PROVIDER] }),
    ),
    providerSettings: {
      ...providerSettingsInitialState,
      enabledProviders: cursorEnabled ? { codex: true, cursor: true } : { codex: true },
    },
    model: { ...modelInitialState, defaultProviderId: 'codex', providerModels: {} },
    featureCodes: { activeFeatures: [], initialized: true },
    agentAvailability: {
      ...availabilityInitialState,
      providerStatusMap: {
        codex: { available: true, authenticated: true },
        cursor,
      },
      providerLoadingMap: { codex: false, cursor: false },
      hasCheckedOnce: true,
    },
  };
}

warmImport(() => import('./AgentGrid.svelte'));

describe('AgentGrid Cursor card', () => {
  afterEach(() => cleanup());

  async function renderGrid(options: { cursorEnabled: boolean; cursor?: object }) {
    mocks.state.current = await buildState(options);
    const AgentGrid = (await import('./AgentGrid.svelte')).default;
    const result = render(AgentGrid);
    await waitFor(() =>
      expect(result.container.querySelector('[data-provider-id="codex"]')).not.toBeNull(),
    );
    return result;
  }

  it.each([false, true])('shows the Cursor card with enabled=%s', async (cursorEnabled) => {
    const { container } = await renderGrid({ cursorEnabled });
    expect(container.querySelector('[data-provider-id="cursor"]')).not.toBeNull();
  });

  it('does not enable an installed Cursor just by showing its card', async () => {
    const { providerEnablementSeedRequested, setProviderEnabled } =
      await import('$store/renderer/slices/provider-settings/provider-settings-slice');
    mocks.dispatch.mockClear();
    await renderGrid({ cursorEnabled: false });
    const enables = mocks.dispatch.mock.calls
      .map(([action]) => action as { type: string; payload?: unknown[] })
      .filter(
        (action) =>
          action.type === setProviderEnabled.type ||
          action.type === providerEnablementSeedRequested.type,
      );
    expect(enables).toEqual([]);
  });

  it('labels a refused Cursor CLI Unsupported with its guidance, not Not installed', async () => {
    const { m } = await import('$shared/paraglide/messages.js');
    const reason = 'cursor-agent runs the Grok agent host, not the Cursor CLI.';
    const warning = m.settings_providers_cursorUnsupported_warning({ reason });
    const { container } = await renderGrid({
      cursorEnabled: false,
      cursor: { available: false, unavailableReason: reason, warning },
    });
    const card = container.querySelector('[data-provider-id="cursor"]') as HTMLElement;
    expect(card.textContent).toContain(m.onboarding_providerCard_unsupported_label());
    expect(card.textContent).not.toContain(m.onboarding_providerCard_notInstalled_label());
    expect(card.textContent).toContain(warning);
    expect(card.textContent).not.toContain('cursor.com/install');
  });
});
