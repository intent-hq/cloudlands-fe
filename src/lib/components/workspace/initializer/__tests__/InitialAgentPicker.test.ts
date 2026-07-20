/**
 * @vitest-environment jsdom
 *
 * Covers the reactive, data-gated stale-model-override clearing in
 * InitialAgentPicker: a persisted override is only compared to the specialist
 * default once file specialists, available models, and initializer hydration
 * are all ready; overrides made in the current session are never cleared; and
 * stale values re-applied after mount (parent hydration) are cleared too.
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
    availableModels$: writable<{ value: string; label: string }[]>([]),
    effectiveModel: 'fable-5',
    getProviderAvailability: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}) });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.readable([]),
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.fileSpecialistsLoaded$,
  selectUserOverrides: () => mocks.readable({ modelOverrides: {} }),
  selectEffectiveModel: { select: () => mocks.effectiveModel },
  selectEffectiveCodingAgent: { select: () => 'auggie' },
  filterSpecialistsByGitHubAuth: (specialists: unknown[]) => specialists,
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => mocks.readable(''),
  selectAvailableModels: () => mocks.availableModels$,
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

const FABLE = { value: 'fable-5', label: 'Fable 5' };

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
    mocks.availableModels$.set([]);
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

    // Data arrives: file specialists + models load, specialist default resolves to fable-5
    mocks.availableModels$.set([FABLE]);
    mocks.fileSpecialistsLoaded$.set(true);

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    await waitFor(() => {
      expect(teamPickerSelected()).toBe('');
      expect(teamPickerDefault()).toBe('fable-5');
    });
  });

  it('does not clear a persisted override until the parent form state is hydrated', async () => {
    mocks.hydrated$.set(false);
    mocks.availableModels$.set([FABLE]);
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
    mocks.availableModels$.set([FABLE]);
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
    mocks.availableModels$.set([FABLE, { value: 'other-model', label: 'Other' }]);
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.fileSpecialistsLoaded$.set(true);
    await flush();

    expect(onModelChange).not.toHaveBeenCalledWith(undefined);
    expect(teamPickerSelected()).toBe('user-picked-model');
  });

  it('clears a stale override re-applied after mount (parent hydration)', async () => {
    mocks.availableModels$.set([FABLE]);
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
});
