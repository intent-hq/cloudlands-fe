import { describe, expect, it, vi } from 'vitest';
import type { StoreState } from '$store/renderer/types';
import {
  agentAvailabilityReducer,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  initialState as agentAvailabilityInitialState,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import {
  initialState as modelInitialState,
  modelReducer,
  reloadModelsForProvider,
} from '$store/renderer/slices/model/model-slice';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import {
  initialState as providerSettingsInitialState,
  providerSettingsReducer,
  setActiveProvider,
  setProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
  selectIsProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import {
  commitOnboardingProviderSelection,
  type CommitOnboardingProviderSelectionAction,
} from './commit-onboarding-provider-selection';
import { resolveOnboardingSelectedProvider } from './resolve-onboarding-selected-provider';

describe('commitOnboardingProviderSelection', () => {
  it('does not commit a detected-only Antigravity provider, but commits its card click', () => {
    const dispatch = vi.fn();
    const selectedProviderId = resolveOnboardingSelectedProvider({
      activeProviderId: '',
      defaultProviderId: '',
      readyProviderIds: ['antigravity'],
    });
    expect(
      commitOnboardingProviderSelection({ selectedProviderId, activeProviderId: '', dispatch }),
    ).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      commitOnboardingProviderSelection({
        selectedProviderId: 'antigravity',
        activeProviderId: '',
        recommitActive: true,
        dispatch,
      }),
    ).toBe('antigravity');
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setProviderEnabled({ providerId: 'antigravity', enabled: true }),
      setActiveProvider('antigravity'),
      reloadModelsForProvider(),
    ]);
  });
  it('dispatches the card-click sequence when the selection is not active', () => {
    const dispatch = vi.fn();
    const committed = commitOnboardingProviderSelection({
      selectedProviderId: 'claude-code',
      activeProviderId: '',
      dispatch,
    });
    expect(committed).toBe('claude-code');
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      setActiveProvider('claude-code'),
      reloadModelsForProvider(),
    ]);
  });

  it('dispatches nothing when no provider is ready', () => {
    const dispatch = vi.fn();
    expect(
      commitOnboardingProviderSelection({
        selectedProviderId: undefined,
        activeProviderId: '',
        dispatch,
      }),
    ).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not double-dispatch when the selection is already the active provider', () => {
    const dispatch = vi.fn();
    expect(
      commitOnboardingProviderSelection({
        selectedProviderId: 'claude-code',
        activeProviderId: 'claude-code',
        dispatch,
      }),
    ).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('re-commits an already-active selection when recommitActive is set (card-click path)', () => {
    const dispatch = vi.fn();
    const committed = commitOnboardingProviderSelection({
      selectedProviderId: 'claude-code',
      activeProviderId: 'claude-code',
      recommitActive: true,
      dispatch,
    });
    expect(committed).toBe('claude-code');
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      setActiveProvider('claude-code'),
      reloadModelsForProvider(),
    ]);
  });
});

describe('no-click welcome-step advance regression (empty enabled set on step 4)', () => {
  // Fresh install: empty enabledProviders, no activeProviderId, exactly one
  // ready provider. The user never clicks a card and advances via the
  // button / ⌘↵ — the commit must leave the resolved provider enabled +
  // active so ModelPicker's availability gate sees a non-empty set.
  const providerCatalog = providerCatalogReducer(
    providerCatalogInitialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );

  it('enables and activates the resolved provider on an explicit advance', () => {
    let settings = providerSettingsReducer(
      providerSettingsInitialState,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    );
    // The model slice is kept pre-catalog-hydration here: at
    // providerCatalogLoaded it installs a first-row default-provider
    // fallback, and this regression needs the genuine nothing-active state.
    let model = modelInitialState;
    let availability = agentAvailabilityReducer(
      agentAvailabilityInitialState,
      checkSingleProviderRequested('claude-code'),
    );
    availability = agentAvailabilityReducer(
      availability,
      checkSingleProviderSuccess('claude-code', { available: true, authenticated: true }, 1),
    );

    const buildState = (): StoreState =>
      ({
        providerCatalog,
        agentAvailability: availability,
        providerSettings: settings,
        model,
      }) as unknown as StoreState;

    // Precondition: fresh install — nothing active, nothing enabled.
    let state = buildState();
    expect(selectActiveProviderId.select(state)).toBe('');
    expect(selectAvailableEnabledProviderIds.select(state)).toEqual([]);

    // The grid's resolved selection for a single ready provider.
    const selectedProviderId = resolveOnboardingSelectedProvider({
      activeProviderId: selectActiveProviderId.select(state),
      defaultProviderId: selectEffectiveDefaultProviderId.select(state),
      readyProviderIds: ['claude-code'],
    });
    expect(selectedProviderId).toBe('claude-code');

    // Advance (button or ⌘↵ — both call the same commit path).
    const apply = (action: CommitOnboardingProviderSelectionAction) => {
      settings = providerSettingsReducer(settings, action);
      model = modelReducer(model, action);
    };
    const committed = commitOnboardingProviderSelection({
      selectedProviderId,
      activeProviderId: selectActiveProviderId.select(state),
      dispatch: apply,
    });
    expect(committed).toBe('claude-code');

    state = buildState();
    expect(selectActiveProviderId.select(state)).toBe('claude-code');
    expect(selectIsProviderEnabled.select(state, 'claude-code')).toBe(true);
    expect(selectAvailableEnabledProviderIds.select(state)).toContain('claude-code');

    // A second advance (or a card click already committed) is a no-op: the
    // selection now resolves to the active provider.
    const secondCommit = commitOnboardingProviderSelection({
      selectedProviderId: resolveOnboardingSelectedProvider({
        activeProviderId: selectActiveProviderId.select(state),
        defaultProviderId: selectEffectiveDefaultProviderId.select(state),
        readyProviderIds: ['claude-code'],
      }),
      activeProviderId: selectActiveProviderId.select(state),
      dispatch: apply,
    });
    expect(secondCommit).toBeUndefined();
    expect(selectActiveProviderId.select(buildState())).toBe('claude-code');
  });
});
