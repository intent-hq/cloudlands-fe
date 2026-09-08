import { describe, expect, it } from 'vitest';
import {
  enablementPersistRejected,
  ensureEnabledIfUnset,
  initialState as bareInitialState,
  loadEnabledProvidersFromStorage,
  providerSettingsReducer,
  setProviderEnabled,
  toggleProvider,
  type ProviderSettingsState,
} from './provider-settings-slice';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';

// Most cases exercise the slice after catalog hydration (boot-time contract:
// the provider-catalog seeder lands before any user toggles).
const initialState = providerSettingsReducer(
  bareInitialState,
  providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
);

describe('providerSettingsReducer', () => {
  it('should return initial state', () => {
    const state = providerSettingsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(bareInitialState);
  });

  // The default-provider (active provider) state moved to the model slice —
  // its guarded hydration/rejection behavior is covered in model-slice.test.ts.

  describe('enabled providers actions', () => {
    it('should enable a provider', () => {
      const state = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      );
      expect(state.enabledProviders['claude-code']).toBe(true);
    });

    it('should disable a provider', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { 'claude-code': true },
      };
      const state = providerSettingsReducer(
        prev,
        setProviderEnabled({ providerId: 'claude-code', enabled: false }),
      );
      expect(state.enabledProviders['claude-code']).toBe(false);
    });

    it('should not mutate previous state when setting provider enabled', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { 'claude-code': true },
      };
      providerSettingsReducer(
        prev,
        setProviderEnabled({ providerId: 'claude-code', enabled: false }),
      );
      expect(prev.enabledProviders['claude-code']).toBe(true);
    });

    it('should toggle from false to true', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { 'claude-code': false },
      };
      const state = providerSettingsReducer(prev, toggleProvider('claude-code'));
      expect(state.enabledProviders['claude-code']).toBe(true);
    });

    it('should toggle from true to false', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { 'claude-code': true },
      };
      const state = providerSettingsReducer(prev, toggleProvider('claude-code'));
      expect(state.enabledProviders['claude-code']).toBe(false);
    });

    it('should toggle an unset provider to true', () => {
      const state = providerSettingsReducer(initialState, toggleProvider('claude-code'));
      expect(state.enabledProviders['claude-code']).toBe(true);
    });

    it('should enable provider if unset', () => {
      const state = providerSettingsReducer(initialState, ensureEnabledIfUnset('claude-code'));
      expect(state.enabledProviders['claude-code']).toBe(true);
    });

    it('should not change provider if already set', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { 'claude-code': false },
      };
      const state = providerSettingsReducer(prev, ensureEnabledIfUnset('claude-code'));
      expect(state).toBe(prev);
    });

    it('should bulk load providers', () => {
      const providers = { 'claude-code': true, codex: false };
      const state = providerSettingsReducer(
        initialState,
        loadEnabledProvidersFromStorage(providers),
      );
      expect(state.enabledProviders).toEqual(providers);
    });

    it('should set enabled state for auggie (disableable)', () => {
      const state = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: 'auggie', enabled: false }),
      );
      expect(state.enabledProviders['auggie']).toBe(false);
    });

    it('should toggle unset auggie on (no default-provider enabled-if-unset exception)', () => {
      const state = providerSettingsReducer(initialState, toggleProvider('auggie'));
      expect(state.enabledProviders['auggie']).toBe(true);
    });

    it('should toggle auggie back on from an explicit false', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        enabledProviders: { auggie: false },
      };
      const state = providerSettingsReducer(prev, toggleProvider('auggie'));
      expect(state.enabledProviders['auggie']).toBe(true);
    });
  });

  describe('boot settings hydration vs local intent (monorepo#1986)', () => {
    it('keeps a just-enabled provider when a stale boot snapshot hydrates afterwards', () => {
      const clicked = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      );
      const hydrated = providerSettingsReducer(
        clicked,
        loadEnabledProvidersFromStorage({ auggie: true }),
      );
      expect(hydrated.enabledProviders).toEqual({ auggie: true, 'claude-code': true });
    });

    it('keeps a just-toggled provider when a stale boot snapshot hydrates afterwards', () => {
      const toggled = providerSettingsReducer(initialState, toggleProvider('claude-code'));
      expect(toggled.enabledProviders['claude-code']).toBe(true);
      const hydrated = providerSettingsReducer(toggled, loadEnabledProvidersFromStorage({}));
      expect(hydrated.enabledProviders['claude-code']).toBe(true);
    });

    it('keeps newer local intent over a conflicting hydration until the daemon confirms', () => {
      const clicked = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      );
      const conflicting = providerSettingsReducer(
        clicked,
        loadEnabledProvidersFromStorage({ 'claude-code': false }),
      );
      expect(conflicting.enabledProviders['claude-code']).toBe(true);
    });

    it('applies a daemon-originated change once a prior hydration confirmed the local intent', () => {
      const clicked = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      );
      // The persisted write echoes back — the daemon now agrees.
      const confirmed = providerSettingsReducer(
        clicked,
        loadEnabledProvidersFromStorage({ 'claude-code': true }),
      );
      expect(confirmed.enabledProviders['claude-code']).toBe(true);
      // A later daemon-originated disable (another window) applies verbatim.
      const disabled = providerSettingsReducer(
        confirmed,
        loadEnabledProvidersFromStorage({ 'claude-code': false }),
      );
      expect(disabled.enabledProviders['claude-code']).toBe(false);
    });

    it('retires the pending override on daemon rejection so later hydrations apply verbatim', () => {
      const clicked = providerSettingsReducer(
        initialState,
        setProviderEnabled({ providerId: 'claude-code', enabled: true }),
      );
      expect(clicked.pendingEnablementOverrides).toEqual({ 'claude-code': true });
      // The daemon rejected the write — the saga retires the override. The
      // local map keeps the click's value until the next hydration.
      const rejected = providerSettingsReducer(clicked, enablementPersistRejected('claude-code'));
      expect(rejected.pendingEnablementOverrides).toEqual({});
      expect(rejected.enabledProviders['claude-code']).toBe(true);
      // A daemon-originated hydration (e.g. another window's change) now
      // applies verbatim instead of being masked by the rejected click.
      const hydrated = providerSettingsReducer(
        rejected,
        loadEnabledProvidersFromStorage({ 'claude-code': false }),
      );
      expect(hydrated.enabledProviders['claude-code']).toBe(false);
    });

    it('ignores a rejection for a provider with no pending override', () => {
      const prev = providerSettingsReducer(
        initialState,
        loadEnabledProvidersFromStorage({ 'claude-code': true }),
      );
      const state = providerSettingsReducer(prev, enablementPersistRejected('claude-code'));
      expect(state).toBe(prev);
    });

    it('hydrates verbatim when a non-disableable provider click was a reducer no-op', () => {
      const prev: ProviderSettingsState = {
        ...initialState,
        nonDisableableProviderIds: ['claude-code'],
      };
      const clicked = providerSettingsReducer(
        prev,
        setProviderEnabled({ providerId: 'claude-code', enabled: false }),
      );
      const hydrated = providerSettingsReducer(
        clicked,
        loadEnabledProvidersFromStorage({ auggie: true }),
      );
      expect(hydrated.enabledProviders).toEqual({ auggie: true });
    });
  });
});
