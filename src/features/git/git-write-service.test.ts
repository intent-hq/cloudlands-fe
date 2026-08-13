import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GitFileStatus } from "$shared/types";
import type { GitStatus } from "$shared/types";

// FAKE seam: appClient.git.* are stubbed so no mutation reaches the daemon. The
// service runs against the REAL configured store so optimistic dispatch, reconcile
// (status refetch), and rollback are exercised end to end.
vi.mock("$lib/client", () => ({
  appClient: {
    git: {
      stage: vi.fn(() => Promise.resolve({ success: true })),
      unstage: vi.fn(() => Promise.resolve({ success: true })),
      discard: vi.fn(() => Promise.resolve({ success: true })),
      commit: vi.fn(() => Promise.resolve({ success: true })),
      status: vi.fn(() => Promise.resolve(null as GitStatus | null)),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { setGitStatus } from "$store/renderer/slices/git/git-slice";
import { selectGitStatus } from "$store/renderer/slices/git/git-selectors";
import { setChanges } from "$store/renderer/slices/changes/changes-slice";
import { selectFileTrackingChanges } from "$store/renderer/slices/changes/changes-selectors";
import { ChangeStage } from "$features/file-tracking/types";
import type { TrackedChange } from "$features/file-tracking/types";
import { commit, discardFiles, stageFiles, unstageFiles } from "./git-write-service";

const gitApi = appClient.git as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-git-1";

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

function makeTracked(path: string, stage: ChangeStage): TrackedChange {
  return {
    id: `tracked:${stage}:${path}`,
    file: path,
    relativePath: path,
    stage,
    stats: { additions: 3, deletions: 1 },
    attribution: { manual: true, timestamp: 42 },
  };
}

describe("gitWriteService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    gitApi.stage.mockResolvedValue({ success: true } as never);
    gitApi.unstage.mockResolvedValue({ success: true } as never);
    gitApi.discard.mockResolvedValue({ success: true } as never);
    gitApi.commit.mockResolvedValue({ success: true } as never);
    gitApi.status.mockResolvedValue(null as never);
  });

  it("stages optimistically (flips staged) and keeps it when reconcile is empty", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));

    const result = await stageFiles(WS, ["a.ts"]);

    expect(gitApi.stage).toHaveBeenCalledWith(WS, ["a.ts"]);
    expect(result).toEqual({ success: true });
    const file = selectGitStatus.select(appStore.state, WS)?.files.find((f) => f.path === "a.ts");
    expect(file?.staged).toBe(true);
  });

  it("reconciles the store from the refetched status on success", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.status.mockResolvedValueOnce(makeStatus({ branch: "reconciled", files: [] }) as never);

    await stageFiles(WS, ["a.ts"]);

    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("reconciled");
  });

  it("rolls back to the pre-stage snapshot when staging fails", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.stage.mockResolvedValueOnce({ success: false, error: "no" } as never);

    const result = await stageFiles(WS, ["a.ts"]);

    expect(result.success).toBe(false);
    const file = selectGitStatus.select(appStore.state, WS)?.files.find((f) => f.path === "a.ts");
    expect(file?.staged).toBe(false);
  });

  it("unstages optimistically (flips staged off) and keeps it when reconcile is empty", async () => {
    appStore.dispatch(
      setGitStatus(WS, makeStatus({ files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: true }] })),
    );

    const result = await unstageFiles(WS, ["a.ts"]);

    expect(gitApi.unstage).toHaveBeenCalledWith(WS, ["a.ts"]);
    expect(result).toEqual({ success: true });
    const file = selectGitStatus.select(appStore.state, WS)?.files.find((f) => f.path === "a.ts");
    expect(file?.staged).toBe(false);
  });

  it("unstage reconciles the store from the refetched status on success", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.status.mockResolvedValueOnce(makeStatus({ branch: "reconciled", files: [] }) as never);

    await unstageFiles(WS, ["a.ts"]);

    expect(selectGitStatus.select(appStore.state, WS)?.branch).toBe("reconciled");
  });

  it("rolls back to the pre-unstage snapshot when unstaging fails", async () => {
    appStore.dispatch(
      setGitStatus(WS, makeStatus({ files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: true }] })),
    );
    gitApi.unstage.mockResolvedValueOnce({ success: false, error: "no" } as never);

    const result = await unstageFiles(WS, ["a.ts"]);

    expect(result.success).toBe(false);
    const file = selectGitStatus.select(appStore.state, WS)?.files.find((f) => f.path === "a.ts");
    expect(file?.staged).toBe(true);
  });

  it("converges the changes slice to the fresh status before stageFiles resolves", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    appStore.dispatch(setChanges(WS, [makeTracked("a.ts", ChangeStage.Unstaged)]));
    gitApi.status.mockResolvedValueOnce(
      makeStatus({ files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: true }] }) as never,
    );

    await stageFiles(WS, ["a.ts"]);

    const rows = selectFileTrackingChanges.select(appStore.state, WS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      relativePath: "a.ts",
      stage: ChangeStage.Staged,
      // Enriched from the pre-existing tracked row, not rebuilt from scratch.
      stats: { additions: 3, deletions: 1 },
    });
  });

  it("converges the changes slice to the fresh status before unstageFiles resolves", async () => {
    appStore.dispatch(
      setGitStatus(WS, makeStatus({ files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: true }] })),
    );
    appStore.dispatch(setChanges(WS, [makeTracked("a.ts", ChangeStage.Staged)]));
    gitApi.status.mockResolvedValueOnce(
      makeStatus({ files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: false }] }) as never,
    );

    await unstageFiles(WS, ["a.ts"]);

    const rows = selectFileTrackingChanges.select(appStore.state, WS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      relativePath: "a.ts",
      stage: ChangeStage.Unstaged,
      stats: { additions: 3, deletions: 1 },
    });
  });

  it("leaves the changes slice untouched when staging fails", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    const seeded = [makeTracked("a.ts", ChangeStage.Unstaged)];
    appStore.dispatch(setChanges(WS, seeded));
    gitApi.stage.mockResolvedValueOnce({ success: false, error: "no" } as never);

    const result = await stageFiles(WS, ["a.ts"]);

    expect(result.success).toBe(false);
    expect(gitApi.status).not.toHaveBeenCalled();
    expect(selectFileTrackingChanges.select(appStore.state, WS)).toBe(seeded);
  });

  it("leaves the changes slice untouched when unstaging fails", async () => {
    appStore.dispatch(
      setGitStatus(WS, makeStatus({ files: [{ path: "a.ts", status: GitFileStatus.Modified, staged: true }] })),
    );
    const seeded = [makeTracked("a.ts", ChangeStage.Staged)];
    appStore.dispatch(setChanges(WS, seeded));
    gitApi.unstage.mockResolvedValueOnce({ success: false, error: "no" } as never);

    const result = await unstageFiles(WS, ["a.ts"]);

    expect(result.success).toBe(false);
    expect(gitApi.status).not.toHaveBeenCalled();
    expect(selectFileTrackingChanges.select(appStore.state, WS)).toBe(seeded);
  });

  it("leaves the changes slice untouched when the status refetch returns null", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    const seeded = [makeTracked("a.ts", ChangeStage.Unstaged)];
    appStore.dispatch(setChanges(WS, seeded));

    await stageFiles(WS, ["a.ts"]);

    expect(selectFileTrackingChanges.select(appStore.state, WS)).toBe(seeded);
  });

  it("discard forwards paths and reconciles the store on success", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.status.mockResolvedValueOnce(makeStatus({ files: [], hasUncommittedChanges: false }) as never);

    const result = await discardFiles(WS, ["a.ts"]);

    expect(gitApi.discard).toHaveBeenCalledWith(WS, ["a.ts"]);
    expect(result).toEqual({ success: true });
    expect(selectGitStatus.select(appStore.state, WS)?.files).toEqual([]);
  });

  it("discard returns a failed result and still reconciles when the seam rejects", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.discard.mockResolvedValueOnce({ success: false, error: "boom" } as never);

    const result = await discardFiles(WS, ["a.ts"]);

    expect(result).toEqual({ success: false, error: "boom" });
    expect(gitApi.status).toHaveBeenCalledWith(WS);
  });

  it("commit forwards params and reconciles the store on success", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.status.mockResolvedValueOnce(makeStatus({ files: [], hasUncommittedChanges: false }) as never);

    const result = await commit(WS, { message: "msg", userRequested: true });

    expect(gitApi.commit).toHaveBeenCalledWith(WS, { message: "msg", userRequested: true });
    expect(result).toEqual({ success: true });
    expect(selectGitStatus.select(appStore.state, WS)?.files).toEqual([]);
  });

  it("commit returns a failed result and still reconciles when the seam rejects", async () => {
    appStore.dispatch(setGitStatus(WS, makeStatus()));
    gitApi.commit.mockResolvedValueOnce({ success: false, error: "boom" } as never);

    const result = await commit(WS, { message: "msg", userRequested: true });

    expect(result).toEqual({ success: false, error: "boom" });
    expect(gitApi.status).toHaveBeenCalledWith(WS);
  });
});
