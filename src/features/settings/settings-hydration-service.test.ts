import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so the seam routes settings.list through an
// in-memory stub (no Electron). `vi.hoisted` keeps the spy visible to the
// hoisted vi.mock factory.
const { listSpy } = vi.hoisted(() => ({ listSpy: vi.fn() }));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === "settings.list") return listSpy(params);
    return Promise.resolve(undefined);
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-set-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import {
  __resetSettingsHydrationForTests,
  applySettingsChanges,
  createSettingsHydrationMiddleware,
} from "./settings-hydration-service";
import { setAgentStreaming } from "$store/renderer/slices/agent-session/agent-session-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("settings-hydration-service (boot read + applySettingsChanges)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    listSpy.mockReset();
    __resetSettingsHydrationForTests();
  });

  afterEach(() => vi.clearAllMocks());

  it("registers and lazily fires settings.list on the first dispatched action", async () => {
    listSpy.mockResolvedValueOnce({ settings: [] });

    // Calling the factory does NOT trigger I/O — only a dispatch does.
    createSettingsHydrationMiddleware();
    expect(listSpy).not.toHaveBeenCalled();

    appStore.dispatch(setAgentStreaming("agent-x", false));
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("hydrates the provider-settings slice from providers.active / providers.enabled", async () => {
    applySettingsChanges([
      { path: "providers.active", value: "auggie" },
      { path: "providers.enabled", value: { auggie: true, codex: false } },
    ]);
    const state = appStore.state as {
      providerSettings: {
        activeProviderId: string;
        enabledProviders: Record<string, boolean>;
      };
    };
    expect(state.providerSettings.activeProviderId).toBe("auggie");
    expect(state.providerSettings.enabledProviders).toEqual({ auggie: true, codex: false });
  });

  it("hydrates the mcp-settings slice from mcp.servers + mcp.disabledServers + mcp.enableUserServers", async () => {
    const servers = [
      { name: "github", type: "http" as const, url: "https://mcp.github.com/mcp" },
    ];
    applySettingsChanges([
      { path: "mcp.servers", value: servers },
      { path: "mcp.disabledServers", value: { filesystem: true } },
      { path: "mcp.enableUserServers", value: true },
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

  it("hydrates the background-agent-settings slice as a single bundle", async () => {
    applySettingsChanges([
      { path: "backgroundAgents.defaultModel", value: "claude-sonnet" },
      { path: "backgroundAgents.typeOverrides", value: { commit: "fast-1" } },
    ]);
    const state = appStore.state as {
      backgroundAgentSettings: {
        defaultModel: string;
        typeOverrides: Record<string, string>;
      };
    };
    expect(state.backgroundAgentSettings.defaultModel).toBe("claude-sonnet");
    expect(state.backgroundAgentSettings.typeOverrides.commit).toBe("fast-1");
    // Missing fields fall back to empty strings, matching the slice's initial state.
    expect(state.backgroundAgentSettings.typeOverrides.pr).toBe("");
  });

  it("silently skips unknown paths so BE-side schema additions never crash the FE", () => {
    expect(() =>
      applySettingsChanges([{ path: "completely.unknown.path", value: 42 }]),
    ).not.toThrow();
  });
});
