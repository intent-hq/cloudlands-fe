import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSpy, catalogSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn(),
  catalogSpy: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === 'settings.update') return updateSpy(params);
    if (method === 'providers.catalog') return catalogSpy(params);
    return Promise.resolve(undefined);
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: 'sub-set-1' }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store as appStore } from '$store/renderer/store';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import { applySettingsChanges, BG_MODEL_MIGRATION_MARKER_KEY } from './settings-hydration-service';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  activeProviderPersistRejected,
  hydrateActiveProvider,
  loadEnabledProvidersFromStorage,
  setActiveProvider,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  loadProviderModelsFromStorage,
  setSelectedModel,
} from '$store/renderer/slices/model/model-slice';

describe('settings-hydration-service (boot read + applySettingsChanges)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    updateSpy.mockReset();
    updateSpy.mockResolvedValue({ applied: [] });
    catalogSpy.mockReset();
    catalogSpy.mockRejectedValue(new Error('no catalog in this test'));
    localStorage.removeItem(BG_MODEL_MIGRATION_MARKER_KEY);
  });

  afterEach(() => vi.clearAllMocks());

  it('hydrates the provider-settings slice from providers.active / providers.enabled', async () => {
    applySettingsChanges([
      { path: 'providers.active', value: 'auggie' },
      { path: 'providers.enabled', value: { auggie: true, codex: false } },
    ]);
    const state = appStore.state as {
      providerSettings: {
        activeProviderId: string;
        enabledProviders: Record<string, boolean>;
      };
      model: { defaultProviderId: string };
    };
    expect(state.providerSettings.activeProviderId).toBe('auggie');
    expect(state.providerSettings.enabledProviders).toEqual({ auggie: true, codex: false });
    expect(state.model.defaultProviderId).toBe('auggie');
  });

  it('keeps the model default synchronized with guarded active-provider hydration', () => {
    const state = () => appStore.state;
    appStore.dispatch(setActiveProvider('auggie'));
    applySettingsChanges([{ path: 'providers.active', value: 'auggie' }]);

    appStore.dispatch(setActiveProvider('claude-code'));
    applySettingsChanges([{ path: 'providers.active', value: 'auggie' }]);
    expect(state().providerSettings.activeProviderId).toBe('claude-code');
    expect(state().providerSettings.pendingActiveProviderId).toBe('claude-code');
    expect(state().model.defaultProviderId).toBe('claude-code');

    applySettingsChanges([{ path: 'providers.active', value: 'claude-code' }]);
    expect(state().providerSettings.activeProviderId).toBe('claude-code');
    expect(state().providerSettings.pendingActiveProviderId).toBeNull();
    expect(state().model.defaultProviderId).toBe('claude-code');

    appStore.dispatch(setActiveProvider('claude-code'));
    appStore.dispatch(activeProviderPersistRejected('claude-code'));
    applySettingsChanges([{ path: 'providers.active', value: 'auggie' }]);
    expect(state().providerSettings.activeProviderId).toBe('auggie');
    expect(state().providerSettings.pendingActiveProviderId).toBeNull();
    expect(state().model.defaultProviderId).toBe('auggie');
  });

  it('reconciles a cross-provider default selection through stale settings echoes', () => {
    applySettingsChanges([
      { path: 'providers.active', value: 'auggie' },
      { path: 'model.providerDefaults', value: { auggie: 'opus-4.8' } },
    ]);

    appStore.dispatch(setActiveProvider('claude-code'));
    appStore.dispatch(
      setSelectedModel({ providerId: 'claude-code', model: 'claude-code:sonnet-4.8' }),
    );
    applySettingsChanges([
      { path: 'providers.active', value: 'auggie' },
      { path: 'model.providerDefaults', value: { auggie: 'opus-4.8' } },
    ]);

    expect(appStore.state.providerSettings.activeProviderId).toBe('claude-code');
    expect(appStore.state.model.providerModels['claude-code']).toBe('sonnet-4.8');

    applySettingsChanges([
      { path: 'providers.active', value: 'claude-code' },
      {
        path: 'model.providerDefaults',
        value: { auggie: 'opus-4.8', 'claude-code': 'sonnet-4.8' },
      },
    ]);
    expect(appStore.state.providerSettings.pendingActiveProviderId).toBeNull();
    expect(appStore.state.model.pendingProviderModels).toEqual({});

    applySettingsChanges([
      { path: 'providers.active', value: 'auggie' },
      { path: 'model.providerDefaults', value: { auggie: 'opus-4.9' } },
    ]);
    expect(appStore.state.providerSettings.activeProviderId).toBe('auggie');
    expect(appStore.state.model.providerModels.auggie).toBe('opus-4.9');
  });

  it('hydrates the mcp-settings slice from mcp.servers + mcp.disabledServers + mcp.enableUserServers', async () => {
    const servers = [{ name: 'github', type: 'http' as const, url: 'https://mcp.github.com/mcp' }];
    applySettingsChanges([
      { path: 'mcp.servers', value: servers },
      { path: 'mcp.disabledServers', value: { filesystem: true } },
      { path: 'mcp.enableUserServers', value: true },
    ]);
    const state = appStore.state as {
      mcpSettings: {
        servers: typeof servers;
        disabledServers: Record<string, true>;
        enabled: boolean;
      };
    };
    expect(state.mcpSettings.servers).toEqual(servers);
    expect(state.mcpSettings.disabledServers).toEqual({ filesystem: true });
    expect(state.mcpSettings.enabled).toBe(true);
  });

  it('hydrates the background-agent-settings slice as a single bundle', async () => {
    applySettingsChanges([
      { path: 'quickActions.defaultModel', value: 'claude-sonnet' },
      { path: 'quickActions.typeOverrides', value: { commit: 'fast-1' } },
    ]);
    const state = appStore.state as {
      backgroundAgentSettings: {
        defaultModel: string;
        typeOverrides: Record<string, string>;
      };
    };
    expect(state.backgroundAgentSettings.defaultModel).toBe('claude-sonnet');
    expect(state.backgroundAgentSettings.typeOverrides.commit).toBe('fast-1');
    // Missing fields fall back to empty strings, matching the slice's initial state.
    expect(state.backgroundAgentSettings.typeOverrides.pr).toBe('');
  });

  it('hydrates model.defaultReasoningEffort into the model slice', () => {
    applySettingsChanges([{ path: 'model.defaultReasoningEffort', value: 'high' }]);
    const state = appStore.state as { model: { defaultReasoningEffort: string } };
    expect(state.model.defaultReasoningEffort).toBe('high');

    // Clearing to Default persists (and rehydrates) an empty string.
    applySettingsChanges([{ path: 'model.defaultReasoningEffort', value: '' }]);
    expect(
      (appStore.state as { model: { defaultReasoningEffort: string } }).model
        .defaultReasoningEffort,
    ).toBe('');
  });

  it('hydrates specialists.default into the specialists slice (string, trim, null-clear)', () => {
    applySettingsChanges([{ path: 'specialists.default', value: ' verifier ' }]);
    const specialists = () =>
      (appStore.state as { specialists: { defaultSpecialistId: string } }).specialists;
    expect(specialists().defaultSpecialistId).toBe('verifier');

    // Non-string garbage is ignored (except null, which clears).
    applySettingsChanges([{ path: 'specialists.default', value: 42 }]);
    expect(specialists().defaultSpecialistId).toBe('verifier');

    applySettingsChanges([{ path: 'specialists.default', value: null }]);
    expect(specialists().defaultSpecialistId).toBe('');
  });

  it('ignores non-string model.defaultReasoningEffort values', () => {
    applySettingsChanges([{ path: 'model.defaultReasoningEffort', value: 'medium' }]);
    applySettingsChanges([
      { path: 'model.defaultReasoningEffort', value: 42 },
      { path: 'model.defaultReasoningEffort', value: null },
      { path: 'model.defaultReasoningEffort', value: { level: 'low' } },
    ]);
    const state = appStore.state as { model: { defaultReasoningEffort: string } };
    expect(state.model.defaultReasoningEffort).toBe('medium');
  });

  it('silently skips unknown paths so BE-side schema additions never crash the FE', () => {
    expect(() =>
      applySettingsChanges([{ path: 'completely.unknown.path', value: 42 }]),
    ).not.toThrow();
  });

  it('preserves sibling backgroundAgents keys when partial delta contains only one', () => {
    // First hydrate with both keys
    applySettingsChanges([
      { path: 'quickActions.defaultModel', value: 'claude-sonnet' },
      {
        path: 'quickActions.typeOverrides',
        value: { commit: 'fast-1', pr: 'pr-model', review: '', fast: '' },
      },
    ]);

    const stateBefore = appStore.state as {
      backgroundAgentSettings: {
        defaultModel: string;
        typeOverrides: Record<string, string>;
      };
    };
    expect(stateBefore.backgroundAgentSettings.defaultModel).toBe('claude-sonnet');
    expect(stateBefore.backgroundAgentSettings.typeOverrides.pr).toBe('pr-model');

    // Now apply a partial delta with ONLY defaultModel (simulates daemon echo-back of a single-field update)
    applySettingsChanges([{ path: 'quickActions.defaultModel', value: 'new-model' }]);

    const stateAfter = appStore.state as {
      backgroundAgentSettings: {
        defaultModel: string;
        typeOverrides: Record<string, string>;
      };
    };

    // defaultModel should update
    expect(stateAfter.backgroundAgentSettings.defaultModel).toBe('new-model');
    // typeOverrides should NOT be dropped — it should fall back to the current slice state
    expect(stateAfter.backgroundAgentSettings.typeOverrides.pr).toBe('pr-model');
  });

  describe('legacy haiku4.5 background-model migration', () => {
    type BgState = {
      backgroundAgentSettings: {
        defaultModel: string;
        typeOverrides: Record<string, string>;
      };
    };

    // The global test-setup localStorage mock is a no-op stub; the migration's
    // run-once marker needs real read-back, so back it with an in-memory map.
    const storage = new Map<string, string>();
    beforeEach(() => {
      storage.clear();
      vi.mocked(localStorage.getItem).mockImplementation((key: string) => storage.get(key) ?? null);
      vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
        storage.set(key, String(value));
      });
      vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
        storage.delete(key);
      });
    });

    it("migrates legacy persisted haiku4.5 (default + overrides) to '' and persists the migration", () => {
      applySettingsChanges([
        { path: 'quickActions.defaultModel', value: 'haiku4.5' },
        {
          path: 'quickActions.typeOverrides',
          value: { commit: 'haiku4.5', pr: 'pr-model', review: '', fast: '' },
        },
      ]);

      const state = appStore.state as BgState;
      expect(state.backgroundAgentSettings.defaultModel).toBe('');
      expect(state.backgroundAgentSettings.typeOverrides.commit).toBe('');
      // Non-legacy overrides pass through untouched.
      expect(state.backgroundAgentSettings.typeOverrides.pr).toBe('pr-model');

      // The normalized values are written back to the daemon settings catalog.
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        changes: [
          { path: 'quickActions.defaultModel', value: '' },
          {
            path: 'quickActions.typeOverrides',
            value: { commit: '', pr: 'pr-model', review: '', fast: '' },
          },
        ],
      });
      expect(localStorage.getItem(BG_MODEL_MIGRATION_MARKER_KEY)).toBe('1');
    });

    it('passes any other persisted model id through untouched (and never writes back)', () => {
      applySettingsChanges([
        { path: 'quickActions.defaultModel', value: 'claude-sonnet' },
        {
          path: 'quickActions.typeOverrides',
          value: { commit: 'fast-1', pr: '', review: '', fast: '' },
        },
      ]);

      const state = appStore.state as BgState;
      expect(state.backgroundAgentSettings.defaultModel).toBe('claude-sonnet');
      expect(state.backgroundAgentSettings.typeOverrides.commit).toBe('fast-1');
      expect(updateSpy).not.toHaveBeenCalled();
      // The marker is still set so later hydrations skip the migration check.
      expect(localStorage.getItem(BG_MODEL_MIGRATION_MARKER_KEY)).toBe('1');
    });

    it('does not re-run: a deliberate post-migration re-pick of haiku4.5 hydrates verbatim', () => {
      // First hydration runs (and completes) the migration.
      applySettingsChanges([
        { path: 'quickActions.defaultModel', value: 'haiku4.5' },
        { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
      ]);
      expect((appStore.state as BgState).backgroundAgentSettings.defaultModel).toBe('');
      updateSpy.mockClear();

      // The user re-picks haiku4.5; the daemon echoes it back via settings:changed.
      applySettingsChanges([{ path: 'quickActions.defaultModel', value: 'haiku4.5' }]);

      const state = appStore.state as BgState;
      expect(state.backgroundAgentSettings.defaultModel).toBe('haiku4.5');
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('enablement seeding boot race (settings hydrate before connections:list)', () => {
    // Must run before any connectionsListReceived dispatch: the singleton
    // store's hasReceivedList only ever flips to true, so this file gets
    // exactly one shot at the pre-list boot window.
    it('defers the seed until connections:list lands and never seeds a remote backend', async () => {
      catalogSpy.mockResolvedValue({ providers: [] });
      // Stale renderer state from the local machine: active provider set, no
      // enablement entry — the shape that passed the old gate during boot.
      appStore.dispatch(hydrateActiveProvider(''));
      appStore.dispatch(loadEnabledProvidersFromStorage({}));
      appStore.dispatch(loadProviderModelsFromStorage({}));
      const connections = () =>
        (appStore.state as { connections: { hasReceivedList: boolean } }).connections;
      expect(connections().hasReceivedList).toBe(false);

      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: {} },
      ]);
      // Deferred: no wire traffic while the active backend is still unknown.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(catalogSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();

      // connections:list resolves on a remote backend — the re-run gate must
      // reject the seed instead of writing stale local state to the remote.
      appStore.dispatch(
        connectionsListReceived({
          connections: [],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
        }),
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(catalogSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(
        (appStore.state as { providerSettings: { enabledProviders: Record<string, boolean> } })
          .providerSettings.enabledProviders,
      ).toEqual({});
    });
  });

  describe('default-provider enablement seeding (monorepo#1947)', () => {
    type ProviderState = {
      providerSettings: { enabledProviders: Record<string, boolean> };
    };

    /** §5.38-shaped catalog: auggie disableable, claude-code not. */
    const CATALOG = {
      providers: [
        {
          id: 'auggie',
          displayName: 'Augment Auggie',
          shortName: 'Auggie',
          command: 'auggie',
          canBeDisabled: true,
          visible: true,
        },
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          shortName: 'Claude',
          command: 'claude',
          canBeDisabled: false,
          visible: true,
        },
      ],
    };

    const enabledProviders = () =>
      (appStore.state as ProviderState).providerSettings.enabledProviders;

    /** Let the fire-and-forget seed promise (if any) settle. */
    const flushAsync = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    beforeEach(() => {
      catalogSpy.mockResolvedValue(CATALOG);
      // Reset the slice map so no enablement state bleeds between tests (the
      // app store is a module singleton), and settle the connections list on
      // the local sidecar so the seed's boot-race defer path stays out of the
      // way (that path has its own describe above).
      appStore.dispatch(hydrateActiveProvider(''));
      appStore.dispatch(loadEnabledProvidersFromStorage({}));
      appStore.dispatch(loadProviderModelsFromStorage({}));
      appStore.dispatch(
        connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
      );
    });

    it('seeds an unset default provider to true and persists the map back (pre-2.17 upgrade)', async () => {
      // Existing-machine simulation: active provider auggie, enabled map
      // without an auggie entry (the pre-fe#759 unset⇒enabled special case
      // meant it was never written).
      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: { codex: true } },
      ]);

      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
      expect(enabledProviders()).toEqual({ codex: true, auggie: true });
      expect(updateSpy).toHaveBeenCalledWith({
        changes: [{ path: 'providers.enabled', value: { codex: true, auggie: true } }],
      });
    });

    it('seeds when providers.enabled hydrates as null (never-persisted install)', async () => {
      // The daemon returns null for the enabled map on installs that never
      // persisted one — the most common pre-2.17 upgrade shape. The seed gate
      // is path-keyed, so a null value still triggers it against the slice's
      // (empty) map even though applyOne skips the null dispatch.
      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: null },
      ]);

      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
      expect(enabledProviders()).toEqual({ auggie: true });
      expect(updateSpy).toHaveBeenCalledWith({
        changes: [{ path: 'providers.enabled', value: { auggie: true } }],
      });
    });

    it('seeds the sole persisted model provider when providers.active is unset', async () => {
      applySettingsChanges([
        { path: 'providers.active', value: null },
        { path: 'model.providerDefaults', value: { auggie: 'gpt5.6-sol' } },
        { path: 'providers.enabled', value: null },
      ]);

      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
      expect(enabledProviders()).toEqual({ auggie: true });
      expect(updateSpy).toHaveBeenCalledWith({
        changes: [{ path: 'providers.enabled', value: { auggie: true } }],
      });
    });

    it('leaves an unset active provider unresolved when persisted model providers are ambiguous', async () => {
      applySettingsChanges([
        { path: 'providers.active', value: null },
        {
          path: 'model.providerDefaults',
          value: { auggie: 'gpt5.6-sol', codex: 'gpt-5.3-codex/high' },
        },
        { path: 'providers.enabled', value: null },
      ]);

      await flushAsync();
      expect(enabledProviders()).toEqual({});
      expect(catalogSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('preserves an explicit persisted false (deliberate disable) without touching the wire', async () => {
      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: { auggie: false } },
      ]);

      await flushAsync();
      expect(enabledProviders()).toEqual({ auggie: false });
      expect(catalogSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('is idempotent: the seeded entry short-circuits every later hydration', async () => {
      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: {} },
      ]);
      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
      expect(enabledProviders()).toEqual({ auggie: true });
      updateSpy.mockClear();
      catalogSpy.mockClear();

      // The daemon echoes the persisted map back (and later boots re-hydrate it).
      applySettingsChanges([{ path: 'providers.enabled', value: { auggie: true } }]);

      await flushAsync();
      expect(catalogSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('never seeds a non-disableable provider (always enabled, needs no entry)', async () => {
      applySettingsChanges([
        { path: 'providers.active', value: 'claude-code' },
        { path: 'providers.enabled', value: {} },
      ]);

      await vi.waitFor(() => expect(catalogSpy).toHaveBeenCalledTimes(1));
      await flushAsync();
      expect(enabledProviders()).toEqual({});
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('never seeds a provider unknown to the catalog', async () => {
      applySettingsChanges([
        { path: 'providers.active', value: 'removed-provider' },
        { path: 'providers.enabled', value: {} },
      ]);

      await vi.waitFor(() => expect(catalogSpy).toHaveBeenCalledTimes(1));
      await flushAsync();
      expect(enabledProviders()).toEqual({});
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('skips the seed (and retries next hydration) when the catalog read fails', async () => {
      catalogSpy.mockRejectedValue(new Error('daemon unavailable'));
      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: {} },
      ]);

      await vi.waitFor(() => expect(catalogSpy).toHaveBeenCalledTimes(1));
      await flushAsync();
      expect(enabledProviders()).toEqual({});
      expect(updateSpy).not.toHaveBeenCalled();

      // The next hydration (e.g. next boot) retries and seeds.
      catalogSpy.mockResolvedValue(CATALOG);
      applySettingsChanges([{ path: 'providers.enabled', value: {} }]);
      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
      expect(enabledProviders()).toEqual({ auggie: true });
    });

    it('does not mutate renderer state when the daemon write fails (persist-first)', async () => {
      updateSpy.mockRejectedValue(new Error('write failed'));
      applySettingsChanges([
        { path: 'providers.active', value: 'auggie' },
        { path: 'providers.enabled', value: {} },
      ]);

      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
      await flushAsync();
      // Renderer stays faithful to the daemon (no entry ⇒ resolves disabled);
      // the seed retries on the next hydration.
      expect(enabledProviders()).toEqual({});

      updateSpy.mockResolvedValue({ applied: [] });
      applySettingsChanges([{ path: 'providers.enabled', value: {} }]);
      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
      expect(enabledProviders()).toEqual({ auggie: true });
    });

    it('never seeds on a remote backend, even when stale local state names a candidate', async () => {
      appStore.dispatch(
        connectionsListReceived({
          connections: [],
          activeId: 'remote-1',
          windowBackendId: 'remote-1',
        }),
      );
      try {
        // Stale renderer state from the local session: active provider set,
        // no enablement entry — the exact shape that would seed locally.
        applySettingsChanges([
          { path: 'providers.active', value: 'auggie' },
          { path: 'providers.enabled', value: {} },
        ]);

        await flushAsync();
        expect(enabledProviders()).toEqual({});
        expect(catalogSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
      } finally {
        appStore.dispatch(
          connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
        );
      }
    });
  });
});
