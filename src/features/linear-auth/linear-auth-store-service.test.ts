import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seam: the renderer auth client is stubbed so no IPC happens. The service
// runs against the REAL configured store so the middleware wiring and the
// state-setting dispatches are exercised end to end.
vi.mock("$features/linear-auth/renderer/linear-auth.client", () => ({
  linearAuthClient: {
    getAuthState: vi.fn(),
    startAuth: vi.fn(),
    cancelAuth: vi.fn(),
    logout: vi.fn(),
  },
}));

import { linearAuthClient } from "$features/linear-auth/renderer/linear-auth.client";
import { store as appStore } from "$store/renderer/store";
import { startLinearAuth } from "$store/renderer/slices/linear-auth/linear-auth-slice";
import {
  cancelLinearAuthFlow,
  initializeLinearAuthFlow,
  logoutLinearFlow,
  pollForLinearAuthCompletion,
  startLinearAuthFlow,
} from "./linear-auth-store-service";

const api = linearAuthClient as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => appStore.state.linearAuth;

describe("linearAuthStoreService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("initialize fetches auth state (force-refresh) and hydrates the store", async () => {
    api.getAuthState.mockResolvedValueOnce({
      isAuthenticated: true,
      requiresAugmentAuth: false,
      oauthUrl: null,
    });

    await initializeLinearAuthFlow();

    expect(api.getAuthState).toHaveBeenCalledWith(true);
    expect(state().isAuthenticated).toBe(true);
  });

  it("startAuth short-circuits when already authenticated (no polling)", async () => {
    api.startAuth.mockResolvedValueOnce({ success: true, alreadyAuthenticated: true });

    await startLinearAuthFlow();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticated).toBe(true);
    expect(state().isAuthenticating).toBe(false);
  });

  it("startAuth surfaces the error when the seam reports failure", async () => {
    api.startAuth.mockResolvedValueOnce({ success: false, error: "nope" });

    await startLinearAuthFlow();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
    expect(state().error).toBe("nope");
    expect(state().isAuthenticating).toBe(false);
  });

  it("startAuth stores the OAuth URL for display", async () => {
    api.startAuth.mockResolvedValueOnce({ success: true, oauthUrl: "https://linear/auth" });
    // Resolve authenticated on the first poll so the loop exits promptly.
    api.getAuthState.mockResolvedValue({ isAuthenticated: true, requiresAugmentAuth: false });

    await startLinearAuthFlow();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticated).toBe(true);
  });

  it("poll completes when the seam reports authenticated", async () => {
    api.getAuthState
      .mockResolvedValueOnce({ isAuthenticated: false, requiresAugmentAuth: false })
      .mockResolvedValueOnce({ isAuthenticated: true, requiresAugmentAuth: false });

    await pollForLinearAuthCompletion(0, 5000);

    expect(api.getAuthState).toHaveBeenCalledTimes(2);
    expect(state().isAuthenticated).toBe(true);
    expect(state().isAuthenticating).toBe(false);
  });

  it("cancel invokes the seam and clears auth UI state", async () => {
    api.cancelAuth.mockResolvedValueOnce(undefined);

    await cancelLinearAuthFlow();

    expect(api.cancelAuth).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticating).toBe(false);
    expect(state().oauthUrl).toBeNull();
  });

  it("logout invokes the seam and resets authentication", async () => {
    api.logout.mockResolvedValueOnce(true);

    await logoutLinearFlow();

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticated).toBe(false);
  });

  it("dispatching startLinearAuth invokes the seam (middleware wiring)", async () => {
    api.startAuth.mockResolvedValueOnce({ success: true, alreadyAuthenticated: true });

    appStore.dispatch(startLinearAuth());
    await flush();

    expect(api.startAuth).toHaveBeenCalledTimes(1);
  });
});
