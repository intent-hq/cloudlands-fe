import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GitFileStatus } from "$shared/types";
import type { GitStatus } from "$shared/types";

// FAKE seam: appClient.git.* are stubbed so no daemon call (and never a
// mutation) happens. The service runs against the REAL configured store so the
// loadGitStatus middleware, refresh dedup, and git-subscribe consumer are
// exercised end to end. READ-ONLY: only `status` and `subscribe` are stubbed.
vi.mock("$lib/client", () => ({
  appClient: {
    git: {
      status: vi.fn(() => Promise.resolve(null as GitStatus | null)),
      subscribe: vi.fn(() => () => {}),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { setGitStatus, loadGitStatus } from "$store/renderer/slices/git/git-slice";
import { selectGitStatus } from "$store/renderer/slices/git/git-selectors";
import { setActiveWorkspaceId } from "$store/renderer/slices/workspace/workspace-slice";
import { refreshGitStatus } from "./git-read-service";
import { startGitStatusSubscription } from "./git-status-subscription";

const gitApi = appClient.git as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-git-read-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: "main",
    ahead: 0,
    behind: 0,
    diverged: false,
    files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: false }],
    hasUncommittedChanges: true,
    hasUntrackedFiles: false,
    ...overrides,
  };
}

describe("gitReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    gitApi.status.mockResolvedValue(null as never);
    gitApi.subscribe.mockReturnValue(() => {});
  });

  it("refreshGitStatus fetches via the seam and converges the store", async () => {
    gitApi.status.mockResolvedValueOnce(makeStatus({ branch: "fetched" }) as never);

    await refreshGitStatus(WS);

    expect(gitApi.status).toHaveBeenCalledWith(WS);
    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("fetched");
  });

  it("leaves the prior status intact when the read fails", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus({ branch: "prior" })));
    gitApi.status.mockRejectedValueOnce(new Error("boom") as never);

    await refreshGitStatus(WS);

    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("prior");
  });

  it("coalesces concurrent refreshes for the same workspace into one fetch", async () => {
    gitApi.status.mockResolvedValue(makeStatus({ branch: "shared" }) as never);

    await Promise.all([refreshGitStatus(WS), refreshGitStatus(WS), refreshGitStatus(WS)]);

    expect(gitApi.status).toHaveBeenCalledTimes(1);
  });

  it("dispatching loadGitStatus triggers a refresh (middleware wiring)", async () => {
    gitApi.status.mockResolvedValueOnce(makeStatus({ branch: "via-action" }) as never);

    appStore.dispatch(loadGitStatus(WS, true));
    await flush();

    expect(gitApi.status).toHaveBeenCalledWith(WS);
    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("via-action");
  });

  it("rapid loadGitStatus dispatches do not double-apply (deduped to one fetch)", async () => {
    gitApi.status.mockResolvedValue(makeStatus({ branch: "deduped" }) as never);

    appStore.dispatch(loadGitStatus(WS, true));
    appStore.dispatch(loadGitStatus(WS, true));
    await flush();

    expect(gitApi.status).toHaveBeenCalledTimes(1);
  });
});

describe("git status subscription (Part B, fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    gitApi.status.mockResolvedValue(null as never);
    gitApi.subscribe.mockReturnValue(() => {});
  });

  it("a git:status-changed signal triggers exactly one refresh of the active workspace", async () => {
    appStore.dispatch(setActiveWorkspaceId(WS));
    gitApi.status.mockResolvedValue(makeStatus({ branch: "from-event" }) as never);

    startGitStatusSubscription();
    const handler = gitApi.subscribe.mock.calls[0][0] as () => void;
    handler();
    await flush();

    expect(gitApi.subscribe).toHaveBeenCalledTimes(1);
    expect(gitApi.status).toHaveBeenCalledTimes(1);
    expect(gitApi.status).toHaveBeenCalledWith(WS);
    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("from-event");
  });

  it("does not refresh when there is no active workspace", async () => {
    appStore.dispatch(setActiveWorkspaceId(WS));
    startGitStatusSubscription();
    const handler = gitApi.subscribe.mock.calls[0][0] as () => void;
    vi.clearAllMocks();
    gitApi.status.mockResolvedValue(null as never);
    // Re-run with no active workspace selected.
    appStore.dispatch(setActiveWorkspaceId(""));
    handler();
    await flush();

    expect(gitApi.status).not.toHaveBeenCalled();
  });

  it("coexists with a write-service reconcile without double-applying", async () => {
    appStore.dispatch(setActiveWorkspaceId(WS));
    // Simulate the write-service self-reconcile result landing first.
    appStore.dispatch(setGitStatus(WS, makeStatus({ branch: "from-write" })));
    gitApi.status.mockResolvedValue(makeStatus({ branch: "from-event" }) as never);

    startGitStatusSubscription();
    const handler = gitApi.subscribe.mock.calls[0][0] as () => void;
    handler();
    await flush();

    expect(gitApi.status).toHaveBeenCalledTimes(1);
    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("from-event");
  });
});
