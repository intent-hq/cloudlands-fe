/**
 * Regression tests for intent-hq/monorepo#1672 at the IPC boundary.
 *
 * Runs the REAL configured store (full middleware chain) against the mock IPC
 * router and asserts, in order:
 *   1. Boot with main-process channel "beta" hydrates Redux
 *      `betaUpdatesEnabled` to true without any user action.
 *   2. Hydration (middleware boot path AND the settings-integrations seeder)
 *      produces ZERO `auto-update:set-channel` IPC calls — the original bug
 *      echoed hydration back into a channel write.
 *   3. A user toggle produces EXACTLY ONE `auto-update:set-channel` call with
 *      the requested channel.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

// Mock backend transport so unrelated middlewares/seeder probes resolve quietly
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-beta-reg-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { AUTO_UPDATE_CHANNELS } from "$features/auto-update/types";
import { autoUpdateClient } from "$features/auto-update/auto-update.client";
import type { UpdateState } from "$features/auto-update/types";
import { store as appStore } from "$store/renderer/store";
import {
  initialState as userPreferencesInitialState,
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from "$store/renderer/slices/user-preferences/user-preferences-slice";
import { registerMockIpcHandler, addMockIpcListener } from "$shared/ipc-mock-router";
import { seedMockStore } from "$store/renderer/mock-bootstrap";
import "$store/renderer/seeders/settings-integrations-seeder";
import type { AppClient } from "$lib/client";

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const setChannelSpy = vi.fn();

// Minimal AppClient seam for the settings-integrations seeder; prefs claim
// betaUpdatesEnabled=false to prove the seeder no longer fights the
// middleware's main-process hydration (the channel is the source of truth).
const fakeClient = {
  settings: {
    getUserPreferences: async () => ({
      ...userPreferencesInitialState,
      betaUpdatesEnabled: false,
    }),
    getProviderSettings: async () => null,
    getMcpServers: async () => [],
    getBackgroundAgentSettings: async () => null,
    getWorkspaceSettings: async () => null,
  },
  workspaces: { list: async () => [] },
  integrations: {
    githubUser: async () => null,
    linearIssues: async () => [],
    sentryIssues: async () => [],
  },
} as unknown as AppClient;

// Wire window.electronAPI.on to the mock router so any middleware listener
// registration at store init works (same shim as auto-update-mutation tests)
beforeAll(() => {
  let listenerIdCounter = 0;
  (window as any).electronAPI = {
    ...((window as any).electronAPI || {}),
    on: vi.fn((channel: string, handler: (data: any) => void) => {
      addMockIpcListener(channel, handler);
      return ++listenerIdCounter;
    }),
    offById: vi.fn(),
  };
});

describe("beta-updates channel regression (intent-hq/monorepo#1672)", () => {
  beforeAll(async () => {
    const mainProcessState: UpdateState = {
      status: "idle",
      currentVersion: "2.19.0",
      updateInfo: null,
      progress: null,
      error: null,
      channel: "beta",
    };
    registerMockIpcHandler(AUTO_UPDATE_CHANNELS.GET_STATE, async () => ({
      success: true,
      data: mainProcessState,
    }));
    registerMockIpcHandler(AUTO_UPDATE_CHANNELS.SET_CHANNEL, async (request) => {
      setChannelSpy(request);
      return { success: true };
    });

    // Store init builds the middleware chain — the boot hydration path
    appStore.init();
    await flush();
  });

  it("boot with main-process channel beta hydrates Redux betaUpdatesEnabled=true without user action", async () => {
    await vi.waitFor(() => {
      expect(appStore.state.userPreferences?.betaUpdatesEnabled).toBe(true);
    });
  });

  it("boot hydration produces zero set-channel IPC calls", async () => {
    await flush();
    expect(setChannelSpy).not.toHaveBeenCalled();
  });

  it("settings seeder produces zero set-channel IPC calls and preserves the hydrated value", async () => {
    await seedMockStore(appStore, fakeClient);
    await flush();

    expect(setChannelSpy).not.toHaveBeenCalled();
    // Seeder prefs said false; the main-process channel remains authoritative
    expect(appStore.state.userPreferences?.betaUpdatesEnabled).toBe(true);
  });

  it("a user toggle off produces exactly one set-channel call with channel=stable", async () => {
    setChannelSpy.mockClear();

    appStore.dispatch(setBetaUpdatesEnabled(false));
    await vi.waitFor(() => {
      expect(setChannelSpy).toHaveBeenCalledTimes(1);
    });
    expect(setChannelSpy).toHaveBeenCalledWith({ channel: "stable" });

    // No delayed echo may follow the single persistence write
    await flush();
    expect(setChannelSpy).toHaveBeenCalledTimes(1);
  });

  it("toggleBetaUpdates produces exactly one set-channel call with channel=beta", async () => {
    setChannelSpy.mockClear();

    appStore.dispatch(toggleBetaUpdates());
    await vi.waitFor(() => {
      expect(setChannelSpy).toHaveBeenCalledTimes(1);
    });
    expect(setChannelSpy).toHaveBeenCalledWith({ channel: "beta" });

    await flush();
    expect(setChannelSpy).toHaveBeenCalledTimes(1);
  });

  it("a call site that direct-calls setChannel in addition to dispatching double-writes (why the single-writer guard exists)", async () => {
    setChannelSpy.mockClear();

    // Replays the pre-fix Settings-page handler sequence (await a direct
    // client setChannel, then dispatch) against the real store + middleware
    // chain: the middleware has no value-dedup — it fires on every
    // setBetaUpdatesEnabled — so the direct call adds a second SET_CHANNEL
    // write. Dispatch-only call sites are therefore mandatory.
    await autoUpdateClient.setChannel("beta");
    appStore.dispatch(setBetaUpdatesEnabled(true));

    await vi.waitFor(() => {
      expect(setChannelSpy).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * Single-writer guard: the beta-updates persistence middleware must be the
 * ONLY renderer call site of autoUpdateClient.setChannel. UI surfaces
 * (Settings toggle, settings proposals) dispatch setBetaUpdatesEnabled /
 * toggleBetaUpdates only — a direct setChannel there would duplicate the
 * middleware's write on every user toggle. Combined with the exactly-once
 * dispatch tests above, this proves the real UI path issues one write.
 */
describe("setChannel single-writer source guard", () => {
  const SRC_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
  const ALLOWED = "store/renderer/middlewares/user-preferences-beta-persistence-service.ts";

  async function findSetChannelCallSites(dir: string, hits: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        await findSetChannelCallSites(full, hits);
      } else if (/\.(ts|svelte)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
        const content = await fs.readFile(full, "utf8");
        if (content.includes("autoUpdateClient.setChannel(")) {
          hits.push(path.relative(SRC_ROOT, full));
        }
      }
    }
  }

  it("the persistence middleware is the only renderer call site of autoUpdateClient.setChannel", async () => {
    const hits: string[] = [];
    await findSetChannelCallSites(SRC_ROOT, hits);
    expect(hits).toEqual([ALLOWED]);
  });

  it("Settings toggle and settings proposals dispatch the Redux action instead", async () => {
    const [settingsPage, proposalActions] = await Promise.all([
      fs.readFile(path.join(SRC_ROOT, "routes/settings/+page.svelte"), "utf8"),
      fs.readFile(
        path.join(SRC_ROOT, "lib/components/chat/proposals/settings-proposal-actions.ts"),
        "utf8",
      ),
    ]);
    expect(settingsPage).toContain("setBetaUpdatesEnabled(");
    expect(settingsPage).not.toContain("autoUpdateClient.setChannel");
    expect(proposalActions).toContain("setBetaUpdatesEnabled(");
    expect(proposalActions).not.toContain("autoUpdateClient.setChannel");
  });
});
