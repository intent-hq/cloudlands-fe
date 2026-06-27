import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seam: the renderer auth client is stubbed so no IPC happens. The service
// runs against the REAL configured store so the middleware wiring and the
// state-setting dispatches are exercised end to end.
vi.mock("$features/sentry-auth/renderer/sentry-auth.client", () => ({
  sentryAuthClient: {
    getAuthState: vi.fn(),
    saveConfig: vi.fn(),
    fetchProjects: vi.fn(),
    logout: vi.fn(),
  },
}));

import { sentryAuthClient } from "$features/sentry-auth/renderer/sentry-auth.client";
import { store as appStore } from "$store/renderer/store";
import { connectSentry } from "$store/renderer/slices/sentry-auth/sentry-auth-slice";
import {
  connectSentryFlow,
  initializeSentryAuthFlow,
  logoutSentryFlow,
} from "./sentry-auth-store-service";

const api = sentryAuthClient as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => appStore.state.sentryAuth;

describe("sentryAuthStoreService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("initialize fetches auth state via the seam and hydrates the store", async () => {
    api.getAuthState.mockResolvedValueOnce({ isAuthenticated: true, organization: "acme", error: null });

    await initializeSentryAuthFlow();

    expect(api.getAuthState).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticated).toBe(true);
    expect(state().organization).toBe("acme");
  });

  it("connect saves config, marks connected, and fetches projects", async () => {
    api.saveConfig.mockResolvedValueOnce({ success: true });
    api.fetchProjects.mockResolvedValueOnce([{ id: "1", slug: "p1", name: "P1" }]);

    await connectSentryFlow("acme", "sntrys_token");

    expect(api.saveConfig).toHaveBeenCalledWith("acme", "sntrys_token");
    expect(api.fetchProjects).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticated).toBe(true);
    expect(state().organization).toBe("acme");
    expect(state().isConnecting).toBe(false);
    expect(state().projects.length).toBe(1);
  });

  it("connect surfaces the error and stops connecting on failure", async () => {
    api.saveConfig.mockResolvedValueOnce({ success: false, error: "bad token" });

    await connectSentryFlow("acme", "bad");

    expect(api.saveConfig).toHaveBeenCalledTimes(1);
    expect(api.fetchProjects).not.toHaveBeenCalled();
    expect(state().error).toBe("bad token");
    expect(state().isConnecting).toBe(false);
  });

  it("logout invokes the seam and resets the connected state", async () => {
    api.logout.mockResolvedValueOnce(undefined);

    await logoutSentryFlow();

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(state().isAuthenticated).toBe(false);
    expect(state().organization).toBeNull();
  });

  it("dispatching connectSentry invokes the seam (middleware wiring)", async () => {
    api.saveConfig.mockResolvedValueOnce({ success: true });
    api.fetchProjects.mockResolvedValueOnce([]);

    appStore.dispatch(connectSentry("acme", "tok"));
    await flush();
    await flush();

    expect(api.saveConfig).toHaveBeenCalledWith("acme", "tok");
  });
});
