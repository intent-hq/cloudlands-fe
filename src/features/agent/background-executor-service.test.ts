import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so `agent.completeOnce` routes through an
// in-memory stub (no Electron). `vi.hoisted` keeps the spy visible to the
// hoisted `vi.mock` factory.
const { completeOnceSpy } = vi.hoisted(() => ({ completeOnceSpy: vi.fn() }));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown, options?: unknown) => {
    if (method === "agent.completeOnce") return completeOnceSpy(params, options);
    // Every other read (settings.list, workspace lists, ...) resolves empty so
    // boot-time hydration middlewares do not perturb the slices under test.
    return Promise.resolve({});
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-bg-executor-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

// Context preparation reaches for git status/diffs; stub it so the test
// asserts the wire call, not the git plumbing.
const { prepareContextSpy } = vi.hoisted(() => ({ prepareContextSpy: vi.fn() }));
vi.mock(
  "$store/renderer/slices/background-agent-executor/utils/context-preparation",
  () => ({ prepareContext: prepareContextSpy }),
);

// The service lazily imports svelte-sonner for error toasts.
const { toastErrorSpy } = vi.hoisted(() => ({ toastErrorSpy: vi.fn() }));
vi.mock("svelte-sonner", () => ({
  toast: { error: toastErrorSpy, warning: vi.fn(), success: vi.fn() },
}));

import { store as appStore } from "$store/renderer/store";
import {
  cancelExecution,
  executeBackgroundAgent,
} from "$store/renderer/slices/background-agent-executor/background-agent-executor-slice";
import { backgroundExecutorSaga } from "./background-executor-service";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import { setTypeOverride } from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";
import commitMessageInstruction from "./instructions/background/commit-message";
import { BackendError } from "$lib/client/live/backend-transport-types";
import type { Workspace } from "$shared/types";

const WS = "ws-bg-exec-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let stopBackgroundExecutorSaga: (() => void) | undefined;

function readExecutor(executorType: string) {
  return appStore.state.bgExecutor.byWorkspaceId[WS]?.executors[executorType];
}

/** Wait until the executor leaves the transient statuses (the service's
 *  lazy dynamic imports resolve on vitest's real module pipeline, so a
 *  fixed zero-delay flush is not enough). */
async function waitForSettled(executorType: string, statuses: string[]): Promise<void> {
  await vi.waitFor(() => {
    const status = readExecutor(executorType)?.status;
    expect(statuses).toContain(status);
  });
}

describe("background-executor-service (PROTOCOL §5.32 agent.completeOnce wire)", () => {
  beforeAll(() => {
    appStore.init();
    stopBackgroundExecutorSaga = appStore.runSaga(backgroundExecutorSaga);
    appStore.dispatch(
      setWorkspaceEntity({
        id: WS,
        title: "WS",
        branch: "main",
        status: "active",
        archived: false,
        repositoryPath: "/tmp/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        changesets: [],
        timeline: [],
        conversationInfo: [],
      } as unknown as Workspace),
    );
  });

  afterAll(() => {
    stopBackgroundExecutorSaga?.();
    stopBackgroundExecutorSaga = undefined;
  });

  beforeEach(async () => {
    await flush();
    completeOnceSpy.mockReset();
    toastErrorSpy.mockReset();
    prepareContextSpy.mockReset();
    prepareContextSpy.mockResolvedValue("PREPARED PROMPT");
  });

  it("sends the §5.32 request and lands the tagged result as success", async () => {
    completeOnceSpy.mockResolvedValueOnce({
      text: "preamble <<<COMMIT_MESSAGE>>>feat: add thing<<</COMMIT_MESSAGE>>> trailer",
    });

    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["success", "error"]);

    expect(completeOnceSpy).toHaveBeenCalledTimes(1);
    const [params] = completeOnceSpy.mock.calls[0];
    expect(params).toEqual({
      prompt: "PREPARED PROMPT",
      workspaceId: WS,
      timeoutMs: 120_000,
      systemPrompt: commitMessageInstruction,
    });

    const executor = readExecutor("commit");
    expect(executor).toMatchObject({
      status: "success",
      result: "feat: add thing",
      error: null,
      progress: 100,
    });
    expect(executor?.agentId).toBeNull();
  });

  it("forwards the per-type model override on the wire", async () => {
    appStore.dispatch(setTypeOverride({ type: "commit", model: "auggie:sonnet4.5" }));
    completeOnceSpy.mockResolvedValueOnce({
      text: "<<<COMMIT_MESSAGE>>>fix: x<<</COMMIT_MESSAGE>>>",
    });

    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["success", "error"]);

    const [params] = completeOnceSpy.mock.calls[0];
    expect(params).toMatchObject({ model: "auggie:sonnet4.5" });
    appStore.dispatch(setTypeOverride({ type: "commit", model: "" }));
  });

  it("surfaces the { available: false, reason } provider gate as a visible error", async () => {
    completeOnceSpy.mockResolvedValueOnce({
      available: false,
      reason: "completeOnce requires a decidable effective default provider",
    });

    appStore.dispatch(executeBackgroundAgent(WS, "pr"));
    await waitForSettled("pr", ["error"]);

    expect(readExecutor("pr")).toMatchObject({
      status: "error",
      error: "completeOnce requires a decidable effective default provider",
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces the -32603 data.detail instead of the generic 'Internal error'", async () => {
    // The daemon maps Error::Internal to message "Internal error" with the
    // actionable cause in `data` (PROTOCOL §5.32 Errors); the transport
    // normalizes it onto BackendError.data.detail (json-rpc-errors.ts).
    completeOnceSpy.mockRejectedValueOnce(
      new BackendError({
        code: "INTERNAL_ERROR",
        message: "Internal error",
        data: { code: "INTERNAL_ERROR", detail: "auggie: auggie CLI not found in PATH" },
        rpcCode: -32603,
      }),
    );

    appStore.dispatch(executeBackgroundAgent(WS, "review"));
    await waitForSettled("review", ["error"]);

    expect(readExecutor("review")).toMatchObject({
      status: "error",
      error: "auggie: auggie CLI not found in PATH",
      progress: 0,
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
    expect(toastErrorSpy.mock.calls[0][1]).toMatchObject({
      description: "auggie: auggie CLI not found in PATH",
    });
  });

  it("falls back to the -32603 message when the error carries no data detail", async () => {
    completeOnceSpy.mockRejectedValueOnce(
      new BackendError({ code: "INTERNAL_ERROR", message: "Internal error", rpcCode: -32603 }),
    );

    appStore.dispatch(executeBackgroundAgent(WS, "pr"));
    await waitForSettled("pr", ["error"]);

    expect(readExecutor("pr")).toMatchObject({ status: "error", error: "Internal error" });
  });

  it("lands plain transport errors as a visible error state with a toast", async () => {
    completeOnceSpy.mockRejectedValueOnce(new Error("auggie CLI not found"));

    appStore.dispatch(executeBackgroundAgent(WS, "review"));
    await waitForSettled("review", ["error"]);

    expect(readExecutor("review")).toMatchObject({
      status: "error",
      error: "auggie CLI not found",
      progress: 0,
    });
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("errors when the expected result tag is missing from the reply", async () => {
    completeOnceSpy.mockResolvedValueOnce({ text: "no tags here" });

    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["error"]);

    const executor = readExecutor("commit");
    expect(executor?.status).toBe("error");
    expect(executor?.result).toBeNull();
    expect(executor?.error).toContain("COMMIT_MESSAGE");
  });

  it("accepts the untagged JSON reply for the walkthrough executor", async () => {
    const json = '{"title":"T","overview":"O","annotations":[]}';
    completeOnceSpy.mockResolvedValueOnce({ text: json });

    appStore.dispatch(executeBackgroundAgent(WS, "walkthrough"));
    await waitForSettled("walkthrough", ["success"]);

    expect(readExecutor("walkthrough")).toMatchObject({
      status: "success",
      result: json,
    });
  });

  it("cancelExecution marks the executor cancelled and discards the in-flight result", async () => {
    let resolveCompletion: (value: unknown) => void = () => {};
    completeOnceSpy.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCompletion = resolve)),
    );

    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["running"]);

    appStore.dispatch(cancelExecution(WS, "commit"));
    expect(readExecutor("commit")?.status).toBe("cancelled");

    resolveCompletion({ text: "<<<COMMIT_MESSAGE>>>late<<</COMMIT_MESSAGE>>>" });
    await flush();
    await flush();

    // The stale response must not overwrite the cancelled state.
    expect(readExecutor("commit")).toMatchObject({ status: "cancelled", result: null });
  });

  it("discards a stale result when a newer execution supersedes it", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    completeOnceSpy
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ text: "<<<COMMIT_MESSAGE>>>new<<</COMMIT_MESSAGE>>>" });

    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["running"]);
    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["success"]);

    resolveFirst({ text: "<<<COMMIT_MESSAGE>>>stale<<</COMMIT_MESSAGE>>>" });
    await flush();
    await flush();

    expect(readExecutor("commit")).toMatchObject({ status: "success", result: "new" });
  });

  it("marks the executor error when context preparation fails (e.g. nothing staged)", async () => {
    prepareContextSpy.mockRejectedValueOnce(
      new Error("No files are staged for commit. Please stage some files first."),
    );

    appStore.dispatch(executeBackgroundAgent(WS, "commit"));
    await waitForSettled("commit", ["error"]);

    expect(completeOnceSpy).not.toHaveBeenCalled();
    expect(readExecutor("commit")).toMatchObject({
      status: "error",
      error: "No files are staged for commit. Please stage some files first.",
    });
  });
});
