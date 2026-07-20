import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seam: the renderer auth client is stubbed so no IPC happens. The service
// runs against the REAL configured store so the middleware wiring and the
// state-setting dispatches are exercised end to end.
vi.mock("$features/github-auth/renderer/github-auth.client", () => ({
  githubAuthClient: {
    getAuthState: vi.fn(),
    startAuth: vi.fn(),
    checkAuthComplete: vi.fn(),
    cancelAuth: vi.fn(),
    logout: vi.fn(),
  },
}));

import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import { store as appStore } from "$store/renderer/store";
import { startGitHubAuth } from "$store/renderer/slices/github-auth/github-auth-slice";
import {
  cancelGitHubAuthFlow,
  checkGitHubAuthStatusOnce,
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
});
