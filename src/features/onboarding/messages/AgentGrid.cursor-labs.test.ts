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
  lab,
  cursorEnabled,
  cursor = { available: true, authenticated: true },
}: {
  lab: boolean;
  cursorEnabled: boolean;
  cursor?: object;
}) {
  const { initialState: modelInitialState } =
    await import('$store/renderer/slices/model/model-slice');
  const { initialState: providerSettingsInitialState } =
    await import('$store/renderer/slices/provider-settings/provider-settings-slice');
  const { initialState: availabilityInitialState } =
    await import('$store/renderer/slices/agent-availability/agent-availability-slice');
  const { initialState: userPreferencesInitialState } =
    await import('$store/renderer/slices/user-preferences/user-preferences-slice');
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
      enabledProviders: { codex: true, cursor: cursorEnabled },
    },
    userPreferences: { ...userPreferencesInitialState, labsCursorProviderEnabled: lab },
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

describe('AgentGrid Cursor Labs gate', () => {
  afterEach(() => cleanup());

  async function renderGrid(options: { lab: boolean; cursorEnabled: boolean; cursor?: object }) {
    mocks.state.current = await buildState(options);
    const AgentGrid = (await import('./AgentGrid.svelte')).default;
    const result = render(AgentGrid);
    await waitFor(() =>
      expect(result.container.querySelector('[data-provider-id="codex"]')).not.toBeNull(),
    );
    return result;
  }

  it.each([
    [false, false, false],
    [false, true, false],
    [true, false, true],
    [true, true, true],
  ])('lab=%s enabled=%s shows the Cursor card: %s', async (lab, cursorEnabled, shown) => {
    const { container } = await renderGrid({ lab, cursorEnabled });
    expect(container.querySelector('[data-provider-id="cursor"]') !== null).toBe(shown);
  });

  it('labels a refused Cursor CLI Unsupported with its guidance, not Not installed', async () => {
    const { m } = await import('$shared/paraglide/messages.js');
    const reason = 'cursor-agent runs the Grok agent host, not the Cursor CLI.';
    const warning = m.settings_providers_cursorUnsupported_warning({ reason });
    const { container } = await renderGrid({
      lab: true,
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
