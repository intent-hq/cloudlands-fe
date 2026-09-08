import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import type { ProviderStatus } from '../agent-availability/agent-availability-types';
import {
  agentAvailabilityReducer,
  checkAllProvidersComplete,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  initialState as agentAvailabilityInitialState,
  setAllProvidersLoading,
} from '../agent-availability/agent-availability-slice';
import { selectHasCheckedOnce } from '../agent-availability/agent-availability-selectors';
import { initialState as modelInitialState, modelReducer } from '../model/model-slice';
import {
  initialState as providerCatalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '../provider-catalog/provider-catalog-slice';
import { selectEffectiveDefaultProviderId } from '../provider-catalog/provider-catalog-selectors';
import {
  initialState as providerSettingsInitialState,
  loadEnabledProvidersFromStorage,
  providerSettingsReducer,
  setActiveProvider,
  setProviderEnabled,
} from './provider-settings-slice';
import { hydrateDefaultProvider } from '../model/model-slice';
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '$shared/types/provider-availability';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import {
  selectActiveProviderId,
  selectAvailableEnabledProviderIds,
  selectEnabledProviderIds,
  selectEnabledProviders,
  selectIsActiveProviderAvailable,
  selectIsProviderActive,
  selectIsProviderEnabled,
  selectIsProviderModelAccessAllowed,
  selectModelFetchProviderIds,
} from './provider-settings-selectors';

const providerCatalog = providerCatalogReducer(
  providerCatalogInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

function mockState(
  enabledProviders: Record<string, boolean>,
  activeProviderId = 'auggie',
  providerStatusMap: Record<string, ProviderStatus> = {},
): StoreState {
  return {
    providerCatalog,
    model: {
      ...modelInitialState,
      defaultProviderId: activeProviderId,
    },
    providerSettings: {
      enabledProviders,
      nonDisableableProviderIds: [],
    },
    agentAvailability: {
      providerStatusMap,
      providerLoadingMap: {},
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: false,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  } as unknown as StoreState;
}

describe('provider-settings selectors', () => {
  it('should return the active provider id', () => {
    const state = mockState({}, 'codex');
    expect(selectActiveProviderId.select(state)).toBe('codex');
  });

  it('should report whether a provider is active', () => {
    const state = mockState({}, 'codex');
    expect(selectIsProviderActive.select(state, 'codex')).toBe(true);
    expect(selectIsProviderActive.select(state, 'auggie')).toBe(false);
  });

  describe('enabled provider selectors', () => {
    it('should return the enabledProviders map', () => {
      const state = mockState({ 'claude-code': true, codex: false });
      expect(selectEnabledProviders.select(state)).toEqual({
        'claude-code': true,
        codex: false,
      });
    });

    it('should return true for enabled provider', () => {
      const state = mockState({ 'claude-code': true });
      expect(selectIsProviderEnabled.select(state, 'claude-code')).toBe(true);
    });

    it('should return false for disabled provider', () => {
      const state = mockState({ 'claude-code': false });
      expect(selectIsProviderEnabled.select(state, 'claude-code')).toBe(false);
    });

    it('should treat unset providers as disabled (no default-provider exception)', () => {
      const state = mockState({}, 'codex');
      expect(selectIsProviderEnabled.select(state, 'auggie')).toBe(false);
    });

    it('should return false for unset disableable providers', () => {
      const state = mockState({});
      expect(selectIsProviderEnabled.select(state, 'claude-code')).toBe(false);
    });

    it('should respect an explicit false for auggie', () => {
      const state = mockState({ auggie: false }, 'codex');
      expect(selectIsProviderEnabled.select(state, 'auggie')).toBe(false);
    });

    it('should respect an explicit true for auggie', () => {
      const state = mockState({ auggie: true }, 'codex');
      expect(selectIsProviderEnabled.select(state, 'auggie')).toBe(true);
    });

    it('should not include an unset provider in enabled ids when not active', () => {
      const state = mockState({}, 'codex');
      expect(selectEnabledProviderIds.select(state)).not.toContain('auggie');
    });

    it('should exclude an explicitly disabled provider when not active', () => {
      const state = mockState({ auggie: false }, 'codex');
      expect(selectEnabledProviderIds.select(state)).not.toContain('auggie');
    });

    it('should re-include a provider when explicitly re-enabled', () => {
      const state = mockState({ auggie: true }, 'codex');
      expect(selectEnabledProviderIds.select(state)).toContain('auggie');
    });

    it('should include explicitly enabled providers', () => {
      const state = mockState({ 'claude-code': true });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).toContain('claude-code');
      // The active provider is always included.
      expect(ids).toContain('auggie');
    });

    it('should not include explicitly disabled providers', () => {
      const state = mockState({ 'claude-code': false });
      const ids = selectEnabledProviderIds.select(state);
      expect(ids).not.toContain('claude-code');
    });

    it('should include the active provider even when explicitly disabled', () => {
      const state = mockState({ 'claude-code': false }, 'claude-code');
      expect(selectEnabledProviderIds.select(state)).toContain('claude-code');
    });
  });

  describe('availability-gated selectors', () => {
    it('removes signed-out Antigravity from model access without changing the saved preference', () => {
      const signedIn = mockState({ antigravity: true }, 'antigravity', {
        antigravity: { available: true, authenticated: true },
      });
      expect(selectModelFetchProviderIds.select(signedIn)).toContain('antigravity');
      const signedOut = {
        ...signedIn,
        agentAvailability: agentAvailabilityReducer(
          signedIn.agentAvailability,
          checkSingleProviderSuccess('antigravity', { available: true, authenticated: false }),
        ),
      };
      expect(selectIsProviderModelAccessAllowed.select(signedOut, 'antigravity')).toBe(false);
      expect(selectModelFetchProviderIds.select(signedOut)).not.toContain('antigravity');
      expect(selectActiveProviderId.select(signedOut)).toBe('antigravity');
      expect(selectEnabledProviderIds.select(signedOut)).toContain('antigravity');
    });
    it.each([undefined, false, true])(
      'requires confirmed Antigravity auth=%s before offering or fetching models',
      (authenticated) => {
        for (const hasCheckedOnce of [false, true]) {
          const state = mockState({ antigravity: true, codex: true }, 'antigravity', {
            antigravity: { available: true, authenticated },
            codex: { available: true },
          });
          state.agentAvailability.hasCheckedOnce = hasCheckedOnce;
          expect(selectAvailableEnabledProviderIds.select(state).includes('antigravity')).toBe(
            authenticated === true,
          );
          expect(selectModelFetchProviderIds.select(state).includes('antigravity')).toBe(
            authenticated === true,
          );
          expect(selectIsProviderModelAccessAllowed.select(state, 'antigravity')).toBe(
            authenticated === true,
          );
          expect(selectAvailableEnabledProviderIds.select(state)).toContain('codex');
          expect(selectActiveProviderId.select(state)).toBe('antigravity');
          expect(selectEnabledProviderIds.select(state)).toContain('antigravity');
        }
      },
    );

    it('blocks Antigravity on an empty status map, including per-agent and pre-check access', () => {
      const state = mockState({ antigravity: true, codex: true }, 'antigravity');
      expect(selectModelFetchProviderIds.select(state)).toEqual(['codex']);
      expect(selectIsProviderModelAccessAllowed.select(state, 'antigravity')).toBe(false);
      expect(selectIsProviderModelAccessAllowed.select(state, 'codex')).toBe(true);
    });

    it('should exclude enabled-but-unavailable providers', () => {
      const state = mockState({ 'claude-code': true }, 'auggie', {
        auggie: { available: true },
        'claude-code': { available: false },
      });
      const ids = selectAvailableEnabledProviderIds.select(state);
      expect(ids).toContain('auggie');
      expect(ids).not.toContain('claude-code');
    });

    it('should exclude hidden providers even when reported available', () => {
      const state = mockState({}, 'auggie', {
        auggie: { available: true },
        mock: { available: true },
      });
      const ids = selectAvailableEnabledProviderIds.select(state);
      expect(ids).not.toContain('mock');
    });

    it('should include available and enabled providers', () => {
      const state = mockState({ 'claude-code': true }, 'auggie', {
        auggie: { available: true },
        'claude-code': { available: true },
      });
      const ids = selectAvailableEnabledProviderIds.select(state);
      expect(ids).toContain('auggie');
      expect(ids).toContain('claude-code');
    });

    it('should report the active provider as available when it is in the available set', () => {
      const state = mockState({}, 'auggie', { auggie: { available: true } });
      expect(selectIsActiveProviderAvailable.select(state)).toBe(true);
    });

    it('should report the active provider as unavailable when it is not in the available set', () => {
      const state = mockState({}, 'auggie', { auggie: { available: false } });
      expect(selectIsActiveProviderAvailable.select(state)).toBe(false);
    });

    it('should report the active provider as unavailable when nothing has been checked yet', () => {
      const state = mockState({}, 'auggie');
      expect(selectIsActiveProviderAvailable.select(state)).toBe(false);
    });
  });
});

describe("install-mid-onboarding regression (false 'No provider available' on step 4)", () => {
  // Reproduces the reported flow against the real reducers: a truthful
  // all-unavailable first sweep, the user installs claude mid-onboarding, a
  // recheck detects it, the user picks it on step 3 — ModelPicker's gate on
  // step 4 must then see claude-code as available+enabled.
  const providerIds = Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID);
  const allLoading = Object.fromEntries(providerIds.map((id) => [id, true]));

  function buildState(
    agentAvailability: typeof agentAvailabilityInitialState,
    providerSettings: typeof providerSettingsInitialState,
    model: typeof modelInitialState = modelInitialState,
  ): StoreState {
    return {
      providerCatalog,
      agentAvailability,
      providerSettings,
      model,
    } as unknown as StoreState;
  }

  it('keeps the freshly detected pick available through a racing stale sweep', () => {
    let settings = providerSettingsReducer(
      providerSettingsInitialState,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    );
    let model = modelReducer(modelInitialState, providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    // (a) First bulk sweep: truthful empty machine — every probe lands
    // available:false at epoch 1.
    let availability = agentAvailabilityReducer(
      agentAvailabilityInitialState,
      setAllProvidersLoading(allLoading),
    );
    for (const id of providerIds) {
      availability = agentAvailabilityReducer(
        availability,
        checkSingleProviderSuccess(id, { available: false }, 1),
      );
    }
    availability = agentAvailabilityReducer(availability, checkAllProvidersComplete());
    expect(selectHasCheckedOnce.select(buildState(availability, settings))).toBe(true);
    expect(selectAvailableEnabledProviderIds.select(buildState(availability, settings))).toEqual(
      [],
    );

    // (b) User installs claude in a terminal; returning focus starts a bulk
    // re-check (epoch 2 for every provider) whose probes are slow.
    availability = agentAvailabilityReducer(availability, setAllProvidersLoading(allLoading));

    // (c) The user hits the card's "Check again" — a manual single check
    // (epoch 3) that resolves quickly with available:true.
    availability = agentAvailabilityReducer(
      availability,
      checkSingleProviderRequested('claude-code'),
    );
    availability = agentAvailabilityReducer(
      availability,
      checkSingleProviderSuccess('claude-code', { available: true, authenticated: true }, 3),
    );

    // (d) The user picks claude-code on step 3 (AgentGrid's
    // handleSelectProvider dispatch sequence; the model slice mirrors
    // setActiveProvider into its defaultProviderId/normalization).
    settings = providerSettingsReducer(
      settings,
      setProviderEnabled({ providerId: 'claude-code', enabled: true }),
    );
    settings = providerSettingsReducer(settings, setActiveProvider('claude-code'));
    model = modelReducer(model, setActiveProvider('claude-code'));

    // Step 4's gate: claude-code is available+enabled, so ModelPicker's
    // hasNoAvailableProvider condition is false.
    let state = buildState(availability, settings, model);
    expect(selectAvailableEnabledProviderIds.select(state)).toContain('claude-code');
    expect(selectIsActiveProviderAvailable.select(state)).toBe(true);
    expect(selectHasCheckedOnce.select(state)).toBe(true);
    // Enhance-prompt gate (auggie-only): the pick must resolve as the
    // effective default provider — never the catalogIds[0] ('auggie')
    // fallback — so isEnhancePromptAvailable is false and the button hides.
    expect(selectEffectiveDefaultProviderId.select(state)).toBe('claude-code');

    // (d') The daemon echoes the persisted pick back via settings:changed
    // (model.defaultProvider / providers.enabled hydration) — the echo must
    // not wipe or displace the pick.
    settings = providerSettingsReducer(
      settings,
      loadEnabledProvidersFromStorage({ 'claude-code': true }),
    );
    model = modelReducer(model, hydrateDefaultProvider('claude-code'));
    state = buildState(availability, settings, model);
    expect(selectActiveProviderId.select(state)).toBe('claude-code');
    expect(selectEffectiveDefaultProviderId.select(state)).toBe('claude-code');

    // (e) The focus sweep's slow claude-code probe (epoch 2, started before
    // the install finished) settles LAST with available:false — it is stale
    // and must not clobber the fresh detection.
    availability = agentAvailabilityReducer(
      availability,
      checkSingleProviderSuccess('claude-code', { available: false }, 2),
    );
    availability = agentAvailabilityReducer(availability, checkAllProvidersComplete());
    state = buildState(availability, settings, model);
    expect(selectAvailableEnabledProviderIds.select(state)).toContain('claude-code');
    expect(selectIsActiveProviderAvailable.select(state)).toBe(true);
    expect(selectEffectiveDefaultProviderId.select(state)).toBe('claude-code');
  });

  it('still reports nothing available on a genuinely empty machine', () => {
    let availability = agentAvailabilityReducer(
      agentAvailabilityInitialState,
      setAllProvidersLoading(allLoading),
    );
    for (const id of providerIds) {
      availability = agentAvailabilityReducer(
        availability,
        checkSingleProviderSuccess(id, { available: false }, 1),
      );
    }
    availability = agentAvailabilityReducer(availability, checkAllProvidersComplete());
    const settings = providerSettingsReducer(
      providerSettingsInitialState,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    );
    const state = buildState(availability, settings);
    expect(selectHasCheckedOnce.select(state)).toBe(true);
    expect(selectAvailableEnabledProviderIds.select(state)).toEqual([]);
  });
});
