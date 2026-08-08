import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === 'settings.update') return updateSpy(params);
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
import {
  applySettingsChanges,
  BG_MODEL_MIGRATION_MARKER_KEY,
} from './settings-hydration-service';

describe('settings-hydration-service (boot read + applySettingsChanges)', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    updateSpy.mockReset();
    updateSpy.mockResolvedValue({ applied: [] });
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
    };
    expect(state.providerSettings.activeProviderId).toBe('auggie');
    expect(state.providerSettings.enabledProviders).toEqual({ auggie: true, codex: false });
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

  describe("legacy haiku4.5 background-model migration", () => {
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
      vi.mocked(localStorage.getItem).mockImplementation(
        (key: string) => storage.get(key) ?? null,
      );
      vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
        storage.set(key, String(value));
      });
      vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
        storage.delete(key);
      });
    });

    it("migrates legacy persisted haiku4.5 (default + overrides) to '' and persists the migration", () => {
      applySettingsChanges([
        { path: "quickActions.defaultModel", value: "haiku4.5" },
        {
          path: "quickActions.typeOverrides",
          value: { commit: "haiku4.5", pr: "pr-model", review: "", fast: "" },
        },
      ]);

      const state = appStore.state as BgState;
      expect(state.backgroundAgentSettings.defaultModel).toBe("");
      expect(state.backgroundAgentSettings.typeOverrides.commit).toBe("");
      // Non-legacy overrides pass through untouched.
      expect(state.backgroundAgentSettings.typeOverrides.pr).toBe("pr-model");

      // The normalized values are written back to the daemon settings catalog.
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        changes: [
          { path: "quickActions.defaultModel", value: "" },
          {
            path: "quickActions.typeOverrides",
            value: { commit: "", pr: "pr-model", review: "", fast: "" },
          },
        ],
      });
      expect(localStorage.getItem(BG_MODEL_MIGRATION_MARKER_KEY)).toBe("1");
    });

    it("passes any other persisted model id through untouched (and never writes back)", () => {
      applySettingsChanges([
        { path: "quickActions.defaultModel", value: "claude-sonnet" },
        {
          path: "quickActions.typeOverrides",
          value: { commit: "fast-1", pr: "", review: "", fast: "" },
        },
      ]);

      const state = appStore.state as BgState;
      expect(state.backgroundAgentSettings.defaultModel).toBe("claude-sonnet");
      expect(state.backgroundAgentSettings.typeOverrides.commit).toBe("fast-1");
      expect(updateSpy).not.toHaveBeenCalled();
      // The marker is still set so later hydrations skip the migration check.
      expect(localStorage.getItem(BG_MODEL_MIGRATION_MARKER_KEY)).toBe("1");
    });

    it("does not re-run: a deliberate post-migration re-pick of haiku4.5 hydrates verbatim", () => {
      // First hydration runs (and completes) the migration.
      applySettingsChanges([
        { path: "quickActions.defaultModel", value: "haiku4.5" },
        { path: "quickActions.typeOverrides", value: { commit: "", pr: "", review: "", fast: "" } },
      ]);
      expect((appStore.state as BgState).backgroundAgentSettings.defaultModel).toBe("");
      updateSpy.mockClear();

      // The user re-picks haiku4.5; the daemon echoes it back via settings:changed.
      applySettingsChanges([
        { path: "quickActions.defaultModel", value: "haiku4.5" },
      ]);

      const state = appStore.state as BgState;
      expect(state.backgroundAgentSettings.defaultModel).toBe("haiku4.5");
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});
