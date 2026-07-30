import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE transport: the WSS seam is replaced by the scripted MockBackendTransport
// so no request reaches a real daemon. The REAL configured store is exercised:
// PROTOCOL-shaped events.event notifications drive the hud slice end to end.
vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../../test/mocks/backend-transport.mock");
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from "../../test/mocks/backend-transport.mock";
import { store as appStore } from "$store/renderer/store";
import {
  selectHudActive,
  selectHudFeed,
  selectHudAttentionByWorkspaceId,
  selectHudSystem,
  selectHudUsage,
  selectHudUsageError,
} from "$store/renderer/slices/hud/hud-selectors";
import { HUD_REPLACE_GROUP, startHudSubscription } from "./hud-subscription";
import { HUD_FEED_EVENT_TYPES } from "./hud-feed-mapper";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "ws-sub-7";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Zeroed §5.36 UsageTotals with overrides. */
function totals(overrides: Partial<Record<string, number>> = {}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  };
}

/** PROTOCOL §5.36-shaped stats.getUsage result (arrays elided to shape). */
function usageResult() {
  return {
    totals: totals({ inputTokens: 130, outputTokens: 45 }),
    runs: 3,
    sessions: 1,
    longestRunMs: 9000,
    linesAdded: 10,
    linesDeleted: 3,
    byModel: [{ model: "Opus 4.8", runs: 2, ...totals({ inputTokens: 100, outputTokens: 40 }) }],
    byProvider: [
      { provider: "claude-code", runs: 2, ...totals({ inputTokens: 100, outputTokens: 40 }) },
    ],
    byHourOfDay: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      ...totals(i === 23 ? { inputTokens: 130, outputTokens: 45 } : {}),
    })),
    byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...totals() })),
    availablePeriods: { months: ["2026-07"], years: ["2026"] },
  };
}

function scriptHappyBackend(backend: MockBackendHandle) {
  backend.onSubscribe(() => ({ subscriptionId: SUB_ID }));
  backend.onRequest("stats.getUsage", () => usageResult());
  backend.onRequest("system.status", () => ({
    running: true,
    listenMode: "uds",
    transports: ["uds"],
    clients: 1,
    agents: 2,
    maxAgents: 8,
    version: "1.2.3",
    uptimeSeconds: 4200,
    fingerprint: "fp",
    protocolVersion: 3,
  }));
}

describe("HUD subscription (mock backend, real store)", () => {
  let backend: MockBackendHandle;
  let stop: (() => void) | undefined;

  beforeAll(() => appStore.init());
  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    resetMockBackend();
  });

  it("issues the global events.subscribe with replaceGroup and no workspaceId (PROTOCOL §6.1)", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    expect(backend.subscribes).toEqual([
      { eventTypes: [...HUD_FEED_EVENT_TYPES], replaceGroup: HUD_REPLACE_GROUP },
    ]);
    expect(selectHudActive.select(appStore.state)).toBe(true);
  });

  it("fetches the 24h stats.getUsage rollup and system.status on start", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    const statsCall = backend.requests.find((r) => r.method === "stats.getUsage");
    expect(statsCall?.params).toEqual({
      period: "24h",
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const usage = selectHudUsage.select(appStore.state);
    expect(usage?.totals).toEqual(totals({ inputTokens: 130, outputTokens: 45 }));
    expect(usage?.runs).toBe(3);
    expect(usage?.rateSamples).toHaveLength(24);
    expect(usage?.rateSamples[23]).toEqual({ hour: 23, tokens: 175 });

    const system = selectHudSystem.select(appStore.state);
    expect(system.online).toBe(true);
    expect(system.uptimeSeconds).toBe(4200);
    expect(system.version).toBe("1.2.3");
  });

  it("maps a PROTOCOL-shaped agent:failed event into an err feed row, newest first", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: "agent:started",
      workspaceId: WS_ID,
      id: "evt-1",
      subscriptionId: SUB_ID,
      data: { agentId: "agent-1", agentName: "Implementor" },
    });
    backend.pushEvent({
      type: "agent:failed",
      workspaceId: WS_ID,
      id: "evt-2",
      subscriptionId: SUB_ID,
      data: { agentId: "agent-1", error: "spawn failed", turnId: "turn-1" },
    });
    await flush();

    const feed = selectHudFeed.select(appStore.state);
    expect(feed.map((e) => e.id)).toEqual(["evt-2", "evt-1"]);
    expect(feed[0]).toMatchObject({
      colorClass: "err",
      source: WS_ID,
      kind: "agent:failed",
      text: "agent-1: spawn failed",
    });
    expect(feed[1]).toMatchObject({ colorClass: "info", text: "Implementor" });
  });

  it("drops notifications tagged with a foreign subscriptionId (§6.3 fan-out dedupe)", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: "agent:started",
      workspaceId: WS_ID,
      id: "evt-foreign",
      subscriptionId: "ws-sub-other",
      data: { agentId: "agent-1", agentName: "Other" },
    });
    await flush();

    expect(selectHudFeed.select(appStore.state)).toEqual([]);
  });

  it("folds workspace:attention-changed into the live attention map ('none' clears)", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: "workspace:attention-changed",
      workspaceId: WS_ID,
      id: "evt-att-1",
      subscriptionId: SUB_ID,
      data: { workspaceId: WS_ID, attention: "review_required" },
    });
    await flush();
    expect(selectHudAttentionByWorkspaceId.select(appStore.state)).toEqual({
      [WS_ID]: "review_required",
    });

    backend.pushEvent({
      type: "workspace:attention-changed",
      workspaceId: WS_ID,
      id: "evt-att-2",
      subscriptionId: SUB_ID,
      data: { workspaceId: WS_ID, attention: "none" },
    });
    await flush();
    expect(selectHudAttentionByWorkspaceId.select(appStore.state)).toEqual({});
  });

  it("surfaces a stats.getUsage failure as usageError (no fabricated zeros)", async () => {
    backend.onSubscribe(() => ({ subscriptionId: SUB_ID }));
    backend.onRequest("stats.getUsage", () => {
      throw new Error("daemon offline");
    });
    backend.onRequest("system.status", () => {
      throw new Error("daemon offline");
    });
    stop = startHudSubscription();
    await flush();

    expect(selectHudUsage.select(appStore.state)).toBeNull();
    expect(selectHudUsageError.select(appStore.state)).toContain("daemon offline");
    expect(selectHudSystem.select(appStore.state).online).toBe(false);
  });

  it("re-issues the subscribe and refetches rollups on reconnect (RESUB-1)", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.triggerReconnect();
    await flush();

    expect(backend.subscribes).toHaveLength(2);
    expect(backend.requests.filter((r) => r.method === "stats.getUsage")).toHaveLength(2);
    expect(backend.requests.filter((r) => r.method === "system.status")).toHaveLength(2);
  });

  it("stop() unsubscribes, removes listeners, and clears the slice (no leaks)", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();
    expect(backend.notificationHandlerCount).toBe(1);
    expect(backend.reconnectHandlerCount).toBe(1);

    stop();
    stop = undefined;
    await flush();

    expect(backend.unsubscribes).toEqual([SUB_ID]);
    expect(backend.notificationHandlerCount).toBe(0);
    expect(backend.reconnectHandlerCount).toBe(0);
    expect(selectHudActive.select(appStore.state)).toBe(false);
    expect(selectHudFeed.select(appStore.state)).toEqual([]);
  });
});
