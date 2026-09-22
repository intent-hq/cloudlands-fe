import { describe, expect, it } from 'vitest';
import {
  checkPiMcpAdapterRequested,
  enablementPersistRejected,
  ensureEnabledIfUnset,
  initialState as bareInitialState,
  loadEnabledProvidersFromStorage,
  loadProviderPathsRequested,
  piMcpAdapterInstallFailed,
  piMcpAdapterStatusLoaded,
  providerPathChanged,
  providerPathSaved,
  providerPathSaveFailed,
  providerPathsLoaded,
  providerSettingsReducer,
  saveProviderPathRequested,
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

  describe('provider discovery and Pi adapter state', () => {
    it('stores provider paths and applies a saved path locally', () => {
      const loading = providerSettingsReducer(initialState, loadProviderPathsRequested());
      expect(loading.providerPathsLoading).toBe(true);

      const loaded = providerSettingsReducer(
        loading,
        providerPathsLoaded(
          { codex: '/custom/codex' },
          { codex: '/usr/bin/codex' },
          { unsloth: '/usr/bin/unsloth' },
        ),
      );
      expect(loaded.configuredPaths).toEqual({ codex: '/custom/codex' });
      expect(loaded.resolvedPaths).toEqual({ codex: '/usr/bin/codex' });
      expect(loaded.secondaryResolvedPaths).toEqual({ unsloth: '/usr/bin/unsloth' });
      expect(loaded.providerPathsLoading).toBe(false);

      const changed = providerSettingsReducer(loaded, providerPathChanged('codex', '/new/codex'));
      expect(changed.configuredPaths.codex).toBe('/new/codex');
    });

    it('tracks Pi adapter checks and installation failures', () => {
      const checking = providerSettingsReducer(initialState, checkPiMcpAdapterRequested());
      expect(checking.piMcpAdapterChecking).toBe(true);

      const loaded = providerSettingsReducer(checking, piMcpAdapterStatusLoaded(false));
      expect(loaded.piMcpAdapterInstalled).toBe(false);
      expect(loaded.piMcpAdapterChecking).toBe(false);

      const failed = providerSettingsReducer(loaded, piMcpAdapterInstallFailed('install failed'));
      expect(failed.piMcpAdapterInstalling).toBe(false);
      expect(failed.piMcpAdapterError).toBe('install failed');
    });

    it('ignores stale provider path save completions delivered after the latest request', () => {
      const first = saveProviderPathRequested('codex', '/old/codex', 'request-1');
      const second = saveProviderPathRequested('codex', '/new/codex', 'request-2');
      let state = providerSettingsReducer(initialState, first);
      state = providerSettingsReducer(state, second);

      const saved = providerSettingsReducer(
        state,
        providerPathSaved('codex', '/new/codex', 'request-2'),
      );
      expect(saved.configuredPaths.codex).toBe('/new/codex');
      expect(saved.providerPathSaving.codex).toBe(false);
      expect(saved.providerPathSaveRequestIds.codex).toBeUndefined();

      const staleSuccess = providerSettingsReducer(
        saved,
        providerPathSaved('codex', '/old/codex', 'request-1'),
      );
      expect(staleSuccess).toBe(saved);
      const staleFailure = providerSettingsReducer(
        saved,
        providerPathSaveFailed('codex', 'request-1', 'stale failure'),
      );
      expect(staleFailure).toBe(saved);
    });

    it('tracks independently generated request ids per provider', () => {
      const codexRequest = saveProviderPathRequested('codex', '/new/codex');
      const claudeRequest = saveProviderPathRequested('claude-code', '/new/claude');
      const state = providerSettingsReducer(
        providerSettingsReducer(initialState, codexRequest),
        claudeRequest,
      );

      expect(codexRequest.payload[2]).not.toBe(claudeRequest.payload[2]);
      expect(state.providerPathSaveRequestIds).toEqual({
        codex: codexRequest.payload[2],
        'claude-code': claudeRequest.payload[2],
      });
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
