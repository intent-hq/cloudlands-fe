import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("$lib/electron-bridge", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
  isElectron: () => true,
}));

const { capturedChannelSubscriptions } = vi.hoisted(() => ({
  capturedChannelSubscriptions: [] as Array<{ eventName: string; handler: any }>,
}));
vi.mock("../../../utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: function* (eventName: string, handler: any) {
    capturedChannelSubscriptions.push({ eventName, handler });
    return null as any;
  },
}));

// Import after mocks
import type { WorkspaceTokenUsageSnapshot } from "../../../../../features/token-usage/token-usage-types";
import {
  clearWorkspaceTokenUsage,
  fetchWorkspaceTokenUsage,
  tokenUsageFetchFailed,
  tokenUsageReceived,
} from "../token-usage-slice";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { TOKEN_USAGE_CHANNELS } from "$shared/ipc/channels";
import { handleTokenUsageChanged, tokenUsageSaga } from "./token-usage-saga";

const WS = "ws-1";

const snapshot: WorkspaceTokenUsageSnapshot = {
  workspaceId: WS,
  byAgentId: {},
  totals: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
  },
  byModel: {
    "model-a": {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    },
  },
  lastScanAt: 1000,
  status: "idle",
};

function makeState(activeWorkspaceId: string | null) {
  return { workspace: { activeWorkspaceId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedChannelSubscriptions.length = 0;
});

describe("token-usage-saga — fetch", () => {
  it("fetch success → tokenUsageReceived", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: snapshot });
    await expectSaga(tokenUsageSaga)
      .withState(makeState(null))
      .dispatch(fetchWorkspaceTokenUsage(WS))
      .put(tokenUsageReceived(WS, snapshot))
      .silentRun();
    expect(mockInvoke).toHaveBeenCalledWith(TOKEN_USAGE_CHANNELS.GET, {
      workspaceId: WS,
    });
  });

  it("fetch with success:false → tokenUsageFetchFailed", async () => {
    mockInvoke.mockResolvedValue({ success: false, error: "boom" });
    await expectSaga(tokenUsageSaga)
      .withState(makeState(null))
      .dispatch(fetchWorkspaceTokenUsage(WS))
      .put(tokenUsageFetchFailed(WS))
      .silentRun();
  });

  it("fetch rejection → tokenUsageFetchFailed", async () => {
    mockInvoke.mockRejectedValue(new Error("ipc down"));
    await expectSaga(tokenUsageSaga)
      .withState(makeState(null))
      .dispatch(fetchWorkspaceTokenUsage(WS))
      .put(tokenUsageFetchFailed(WS))
      .silentRun();
  });

  it("drops overlapping fetches for the same workspace", async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    await expectSaga(tokenUsageSaga)
      .withState(makeState(null))
      .dispatch(fetchWorkspaceTokenUsage(WS))
      .dispatch(fetchWorkspaceTokenUsage(WS))
      .silentRun();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("allows concurrent fetches for different workspaces", async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    await expectSaga(tokenUsageSaga)
      .withState(makeState(null))
      .dispatch(fetchWorkspaceTokenUsage(WS))
      .dispatch(fetchWorkspaceTokenUsage("ws-2"))
      .silentRun();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe("token-usage-saga — CHANGED push", () => {
  it("subscribes to the CHANGED electron channel", async () => {
    await expectSaga(tokenUsageSaga).withState(makeState(null)).silentRun();
    expect(capturedChannelSubscriptions).toEqual([
      { eventName: TOKEN_USAGE_CHANNELS.CHANGED, handler: handleTokenUsageChanged },
    ]);
  });

  it("handleTokenUsageChanged → tokenUsageReceived for the pushed workspace", () => {
    return expectSaga(handleTokenUsageChanged, snapshot)
      .put(tokenUsageReceived(WS, snapshot))
      .run();
  });
});

describe("token-usage-saga — lifecycle and polling", () => {
  it("refreshes the active workspace on start", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: snapshot });
    await expectSaga(tokenUsageSaga)
      .withState(makeState(WS))
      .put(fetchWorkspaceTokenUsage(WS))
      .silentRun();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when no workspace is active", async () => {
    await expectSaga(tokenUsageSaga).withState(makeState(null)).silentRun();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("prunes workspace state on workspaceUnmounted", async () => {
    await expectSaga(tokenUsageSaga)
      .withState(makeState(null))
      .dispatch(workspaceUnmounted(WS))
      .put(clearWorkspaceTokenUsage(WS))
      .silentRun();
  });

  it("skips refresh for an unmounted workspace and refetches on remount", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: snapshot });
    await expectSaga(tokenUsageSaga)
      .withState(makeState(WS))
      .delay(10)
      .dispatch(workspaceUnmounted(WS))
      .delay(10)
      .dispatch(workspaceMounted(WS))
      .delay(10)
      .silentRun();
    // Initial refresh + remount wake; the unmount wake itself must not refetch.
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

