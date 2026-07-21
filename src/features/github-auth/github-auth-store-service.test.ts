import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seam: the renderer auth client is stubbed so no IPC happens. The service
// runs against the REAL configured store so the middleware wiring and the
// state-setting dispatches are exercised end to end.
vi.mock("$features/github-auth/renderer/github-auth.client", () => ({
  githubAuthClient: {
    getAuthState: vi.fn(),
    getUser: vi.fn(),
    startAuth: vi.fn(),
    checkAuthComplete: vi.fn(),
    cancelAuth: vi.fn(),
    logout: vi.fn(),
  },
}));

import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import { store as appStore } from "$store/renderer/store";
import {
  githubAuthChanged,
  startGitHubAuth,
} from "$store/renderer/slices/github-auth/github-auth-slice";
import {
  cancelGitHubAuthFlow,
  checkGitHubAuthStatusOnce,
  handleGitHubAuthChanged,
  initializeGitHubAuthFlow,
  logoutGitHubFlow,
  pollForGitHubAuthCompletion,
  startGitHubAuthFlow,
} from "./github-auth-store-service";

const api = githubAuthClient as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const ghState = () => appStore.state.githubAuth;

describe("githubAuthStoreService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("initialize fetches auth state via the seam and hydrates the store", async () => {
    api.getAuthState.mockResolvedValueOnce({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: { login: "octocat", name: null, email: null, avatar_url: "" },
      needsScopeUpdate: false,
      oauthUrl: null,
    });

    await initializeGitHubAuthFlow();

    expect(api.getAuthState).toHaveBeenCalledTimes(1);
    expect(ghState().isAuthenticated).toBe(true);
    expect(ghState().user?.login).toBe("octocat");
  });

  it("startAuth short-circuits when already authenticated (no polling)", async () => {
    api.startAuth.mockResolvedValueOnce({ success: true, alreadyAuthenticated: true });

    await startGitHubAuthFlow();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
    expect(api.checkAuthComplete).not.toHaveBeenCalled();
    expect(ghState().isAuthenticated).toBe(true);
    expect(ghState().isAuthenticating).toBe(false);
  });

  it("startAuth surfaces the error when the seam reports failure", async () => {
    api.startAuth.mockResolvedValueOnce({ success: false, error: "nope" });

    await startGitHubAuthFlow();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
    expect(ghState().error).toBe("nope");
    expect(ghState().isAuthenticating).toBe(false);
  });

  it("startAuth stores the OAuth URL then polls to completion", async () => {
    api.startAuth.mockResolvedValueOnce({ success: true, oauthUrl: "https://gh/auth" });
    api.checkAuthComplete.mockResolvedValueOnce({
      success: true,
      data: { user: { login: "poller", name: null, email: null, avatar_url: "" }, isComplete: true },
    });

    await startGitHubAuthFlow();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
    expect(api.checkAuthComplete).toHaveBeenCalled();
    expect(ghState().isAuthenticated).toBe(true);
    expect(ghState().user?.login).toBe("poller");
  });

  it("poll completes on a later tick and is cancellable", async () => {
    api.checkAuthComplete
      .mockResolvedValueOnce({ success: true, data: { user: null, isComplete: false } })
      .mockResolvedValueOnce({ success: true, data: { user: null, isComplete: true } });

    await pollForGitHubAuthCompletion(0, 5000);

    expect(api.checkAuthComplete).toHaveBeenCalledTimes(2);
    expect(ghState().isAuthenticated).toBe(true);
  });

  it("checkStatus completes auth when the seam reports complete", async () => {
    api.checkAuthComplete.mockResolvedValueOnce({
      success: true,
      data: { user: null, isComplete: true },
    });

    await checkGitHubAuthStatusOnce();

    expect(api.checkAuthComplete).toHaveBeenCalledTimes(1);
    expect(ghState().isAuthenticated).toBe(true);
  });

  it("cancel invokes the seam and clears the authenticating flag", async () => {
    api.cancelAuth.mockResolvedValueOnce(undefined);

    await cancelGitHubAuthFlow();

    expect(api.cancelAuth).toHaveBeenCalledTimes(1);
    expect(ghState().isAuthenticating).toBe(false);
  });

  it("logout invokes the seam and resets authentication", async () => {
    api.logout.mockResolvedValueOnce(undefined);

    await logoutGitHubFlow();

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(ghState().isAuthenticated).toBe(false);
    expect(ghState().user).toBeNull();
  });

  it("dispatching startGitHubAuth invokes the seam (middleware wiring)", async () => {
    api.startAuth.mockResolvedValueOnce({ success: true, alreadyAuthenticated: true });

    appStore.dispatch(startGitHubAuth());
    await flush();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
  });

  it("startAuth stores the device-flow codes from github.connect (§5.27)", async () => {
    api.startAuth.mockResolvedValueOnce({
      success: true,
      oauthUrl: "https://github.com/login/device",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 899,
      interval: 5,
    });
    // Capture the state as the first poll fires — the codes must already be
    // stored while the flow is pending.
    let deviceFlowDuringPoll: unknown = "unset";
    api.checkAuthComplete.mockImplementationOnce(async () => {
      deviceFlowDuringPoll = ghState().deviceFlow;
      return { success: true, data: { user: null, isComplete: true } };
    });

    await startGitHubAuthFlow();

    expect(deviceFlowDuringPoll).toEqual({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 899,
      interval: 5,
    });
    expect(ghState().isAuthenticated).toBe(true);
    // Terminal transition clears the codes.
    expect(ghState().deviceFlow).toBeNull();
  });

  it("initialize resumes a still-pending device flow after a refresh (§5.27)", async () => {
    api.getAuthState.mockResolvedValueOnce({
      isAuthenticated: false,
      requiresDaemonAuth: false,
      user: null,
      needsScopeUpdate: false,
      oauthUrl: "https://github.com/login/device",
      deviceFlow: {
        status: "pending",
        userCode: "RSME-4321",
        verificationUri: "https://github.com/login/device",
        expiresIn: 400,
        interval: 5,
      },
    });
    api.checkAuthComplete.mockResolvedValue({
      success: true,
      data: { user: null, isComplete: false },
    });

    await initializeGitHubAuthFlow();
    await flush();

    expect(ghState().deviceFlow?.userCode).toBe("RSME-4321");
    expect(ghState().isAuthenticating).toBe(true);
    expect(api.checkAuthComplete).toHaveBeenCalled();
    // Stop the resumed fallback poll so it does not leak into later tests.
    await cancelGitHubAuthFlow();
  });

  it("initialize does not resume a terminal device flow", async () => {
    api.getAuthState.mockResolvedValueOnce({
      isAuthenticated: false,
      requiresDaemonAuth: false,
      user: null,
      needsScopeUpdate: false,
      oauthUrl: null,
      deviceFlow: null,
    });

    await initializeGitHubAuthFlow();
    await flush();

    expect(ghState().deviceFlow).toBeNull();
    expect(api.checkAuthComplete).not.toHaveBeenCalled();
  });

  it("auth-changed authorized with a null identity re-hydrates via the boot path", async () => {
    api.getUser.mockResolvedValueOnce(null);
    api.getAuthState.mockResolvedValueOnce({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: { login: "rehydrated", name: null, email: null, avatar_url: "" },
      needsScopeUpdate: false,
      oauthUrl: null,
      deviceFlow: null,
    });

    await handleGitHubAuthChanged("authorized");
    await flush();

    expect(api.getAuthState).toHaveBeenCalledTimes(1);
    expect(ghState().user?.login).toBe("rehydrated");
  });

  it("auth-changed authorized fetches identity and completes (§6.5)", async () => {
    api.getUser.mockResolvedValueOnce({
      login: "eventuser",
      name: null,
      email: null,
      avatar_url: "",
    });

    await handleGitHubAuthChanged("authorized");

    expect(api.getUser).toHaveBeenCalledTimes(1);
    expect(ghState().isAuthenticated).toBe(true);
    expect(ghState().user?.login).toBe("eventuser");
    expect(ghState().deviceFlow).toBeNull();
  });

  it("auth-changed expired surfaces an error and clears the flow", async () => {
    await handleGitHubAuthChanged("expired");

    expect(ghState().error).toContain("expired");
    expect(ghState().isAuthenticating).toBe(false);
    expect(ghState().deviceFlow).toBeNull();
  });

  it("auth-changed denied surfaces an error", async () => {
    await handleGitHubAuthChanged("denied");

    expect(ghState().error).toContain("denied");
    expect(ghState().isAuthenticating).toBe(false);
  });

  it("auth-changed revoked resets to signed-out", async () => {
    api.getUser.mockResolvedValueOnce({ login: "x", name: null, email: null, avatar_url: "" });
    await handleGitHubAuthChanged("authorized");
    expect(ghState().isAuthenticated).toBe(true);

    await handleGitHubAuthChanged("revoked");

    expect(ghState().isAuthenticated).toBe(false);
    expect(ghState().user).toBeNull();
  });

  it("dispatching githubAuthChanged routes through the middleware", async () => {
    api.getUser.mockResolvedValueOnce({
      login: "mwuser",
      name: null,
      email: null,
      avatar_url: "",
    });

    appStore.dispatch(githubAuthChanged("authorized"));
    await flush();

    expect(api.getUser).toHaveBeenCalledTimes(1);
    expect(ghState().user?.login).toBe("mwuser");
  });
});
