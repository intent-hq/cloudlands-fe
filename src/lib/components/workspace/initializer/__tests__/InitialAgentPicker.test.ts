/**
 * @vitest-environment jsdom
 *
 * Covers the reactive, data-gated stale-model-override clearing in
 * InitialAgentPicker: a persisted override is only compared to the daemon's
 * resolved default once file specialists and initializer hydration are ready;
 * overrides made in the current session are never cleared; and stale values
 * re-applied after mount (parent hydration) are cleared too.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => subs.delete(run);
      },
      set(v: T) {
        value = v;
        for (const run of subs) run(v);
      },
    };
  }
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  return {
    writable,
    readable,
    fileSpecialistsLoaded$: writable(false),
    hydrated$: writable(true),
    // Store view of specialists carrying the daemon's resolvedModel preview
    // (PROTOCOL §5.11) in the default-provider context.
    specialists$: writable<
      Array<{ id: string; name: string; description: string; resolvedModel?: string }>
    >([]),
    // `specialist.list(provider)` refetch used for per-provider previews.
    specialistsList: vi.fn(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    ),
    getProviderAvailability: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  // The picker reads the default provider / catalog rows via the
  // providerCatalog slice — hydrate the §5.38-shaped mock catalog.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } = await import(
    '$store/renderer/slices/provider-catalog/provider-catalog-slice'
  );
  const { MOCK_PROVIDER_CATALOG } = await import(
    '../../../../../test/fixtures/provider-catalog.fixture'
  );
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );
  return createAppStoreMockModule({ state: () => ({ providerCatalog }) });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.specialists$,
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.fileSpecialistsLoaded$,
  selectUserOverrides: () => mocks.readable({ modelOverrides: {} }),
  filterPickableSpecialists: (specialists: unknown[]) => specialists,
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => mocks.readable(''),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    specialists: { list: mocks.specialistsList },
  },
}));

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.readable(true),
}));

vi.mock('$features/providers/provider-availability.client', () => ({
  getProviderAvailability: mocks.getProviderAvailability,
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
}));

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('./mocks/MockModelPicker.svelte')).default,
}));

vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('./mocks/MockDropdownMenu.svelte')).default,
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import InitialAgentPicker from '../InitialAgentPicker.svelte';

/** The team-mode card renders first; its picker is index 0. */
function teamPickerSelected(): string {
  return screen.getAllByTestId('picker-selected')[0].textContent ?? '';
}

function teamPickerDefault(): string {
  return screen.getAllByTestId('picker-default')[0].textContent ?? '';
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('InitialAgentPicker stale model override clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.hydrated$.set(true);
    mocks.specialists$.set([]);
    mocks.specialistsList.mockImplementation(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('does not clear a persisted override before data is loaded, then clears it once loaded', async () => {
    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('opus4.6');

    // Data arrives: file specialists load; the daemon resolvedModel preview
    // (fable-5) is fetched per provider via specialist.list.
    mocks.fileSpecialistsLoaded$.set(true);

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    await waitFor(() => {
      expect(teamPickerSelected()).toBe('');
      expect(teamPickerDefault()).toBe('fable-5');
    });
  });

  it('does not clear a persisted override until the parent form state is hydrated', async () => {
    mocks.hydrated$.set(false);
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    expect(onModelChange).not.toHaveBeenCalled();

    mocks.hydrated$.set(true);
    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
  });

  it('preserves an override the user made in the current session', async () => {
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        onModelChange,
      },
    });

    await flush();
    await fireEvent.click(screen.getAllByTestId('pick-model')[0]);
    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith('user-picked-model'));

    // Churn the gated dependencies — the fresh session override must survive
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.fileSpecialistsLoaded$.set(true);
    await flush();

    expect(onModelChange).not.toHaveBeenCalledWith(undefined);
    expect(teamPickerSelected()).toBe('user-picked-model');
  });

  it('normalizes a degenerate persisted state (override flag set with no model) once data is ready', async () => {
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    const { rerender } = render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: undefined,
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));

    // The flag was cleared: a later selectedModel without the override flag
    // must not be treated as an override by the picker display.
    await rerender({ selectedModel: 'opus4.6' });
    await flush();
    expect(teamPickerSelected()).toBe('');
  });

  it('clears a stale override re-applied after mount (parent hydration)', async () => {
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    const { rerender } = render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        onModelChange,
      },
    });

    await flush();
    expect(onModelChange).not.toHaveBeenCalled();

    // Simulate the parent's hydration $effect re-applying persisted stale values
    await rerender({ selectedModel: 'opus4.6', modelWasOverridden: true });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    await waitFor(() => {
      expect(teamPickerSelected()).toBe('');
      expect(teamPickerDefault()).toBe('fable-5');
    });
  });

  it('invalidates cached per-provider previews when the store specialist view refreshes', async () => {
    mocks.fileSpecialistsLoaded$.set(true);

    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
      },
    });

    await waitFor(() => expect(teamPickerDefault()).toBe('fable-5'));
    expect(mocks.specialistsList).toHaveBeenCalledTimes(1);

    // Specialist defaults change on disk: the daemon emits specialists:changed
    // and the list subscription refreshes the store view. The cached
    // per-provider preview must be dropped and refetched.
    mocks.specialistsList.mockImplementation(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'sonnet-4.6' },
      ]),
    );
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'sonnet-4.6' },
    ]);

    await waitFor(() => expect(teamPickerDefault()).toBe('sonnet-4.6'));
    expect(mocks.specialistsList).toHaveBeenCalledTimes(2);
  });

  it('falls back to the store resolvedModel until the per-provider fetch lands', async () => {
    // Per-provider fetch never resolves — the store view (daemon default
    // provider context) must drive the preview.
    mocks.specialistsList.mockImplementation(() => new Promise(() => {}));
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'store-model' },
    ]);
    mocks.fileSpecialistsLoaded$.set(true);

    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
      },
    });

    await waitFor(() => expect(teamPickerDefault()).toBe('store-model'));
  });
});
