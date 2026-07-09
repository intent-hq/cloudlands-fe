import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seams: the renderer auth client (linear.authStatus probe) and the
// AppClient settings domain (daemon keyring path) are stubbed so no IPC
// happens. The service runs against the REAL configured store so the
// middleware wiring and the state-setting dispatches are exercised end to end.
vi.mock("$features/linear-auth/renderer/linear-auth.client", () => ({
  linearAuthClient: {
    getAuthState: vi.fn(),
  },
}));
vi.mock("$lib/client", () => ({
  appClient: {
    settings: {
      update: vi.fn(() => Promise.resolve([])),
      reset: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

import { linearAuthClient } from "$features/linear-auth/renderer/linear-auth.client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  connectLinear,
  logoutLinear,
  setLinearAuthState,
  setLinearError,
} from "$store/renderer/slices/linear-auth/linear-auth-slice";
import {
  connectLinearFlow,
  initializeLinearAuthFlow,
  logoutLinearFlow,
  LINEAR_TOKEN_SETTING_PATH,
} from "./linear-auth-store-service";

const api = linearAuthClient as unknown as Record<string, ReturnType<typeof vi.fn>>;
const settings = appClient.settings as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const state = () => appStore.state.linearAuth;

describe("linearAuthStoreService (fake seams, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    settings.update.mockResolvedValue([] as never);
    settings.reset.mockResolvedValue(null as never);
    appStore.dispatch(setLinearAuthState(false, false, null));
    appStore.dispatch(setLinearError(null));
  });

  it("initialize fetches auth state (force-refresh) and hydrates the store", async () => {
    api.getAuthState.mockResolvedValueOnce({
      isAuthenticated: true,
      requiresAugmentAuth: false,
    });

    await initializeLinearAuthFlow();

    expect(api.getAuthState).toHaveBeenCalledWith(true);
    expect(state().isAuthenticated).toBe(true);
  });

  it("connect stores the key under linear.token (daemon keyring path) and re-probes", async () => {
    api.getAuthState.mockResolvedValueOnce({ isAuthenticated: true, requiresAugmentAuth: false });

    await connectLinearFlow("lin_api_abc123");

    expect(settings.update).toHaveBeenCalledWith([
      { path: LINEAR_TOKEN_SETTING_PATH, value: "lin_api_abc123" },
    ]);
    expect(api.getAuthState).toHaveBeenCalledWith(true);
    expect(state().isAuthenticated).toBe(true);
    expect(state().isAuthenticating).toBe(false);
    expect(state().error).toBeNull();
  });

  it("connect surfaces a rejected key when the probe stays unauthenticated", async () => {
    api.getAuthState.mockResolvedValueOnce({ isAuthenticated: false, requiresAugmentAuth: false });

    await connectLinearFlow("lin_api_bad");

    expect(state().isAuthenticated).toBe(false);
    expect(state().error).toMatch(/rejected the API key/);
    expect(state().isAuthenticating).toBe(false);
  });

  it("connect surfaces the daemon settings error visibly (e.g. unknown setting)", async () => {
    settings.update.mockRejectedValueOnce(new Error("unknown setting: linear.token") as never);

    await connectLinearFlow("lin_api_x");

    expect(state().error).toBe("unknown setting: linear.token");
    expect(state().isAuthenticating).toBe(false);
    expect(api.getAuthState).not.toHaveBeenCalled();
  });

  it("connect rejects an empty key without touching the seam", async () => {
    await connectLinearFlow("   ");

    expect(settings.update).not.toHaveBeenCalled();
    expect(state().error).toBe("Enter a Linear API key");
  });

  it("logout resets linear.token and reflects the re-probe result", async () => {
    appStore.dispatch(setLinearAuthState(true, false, null));
    api.getAuthState.mockResolvedValueOnce({ isAuthenticated: false, requiresAugmentAuth: false });

    await logoutLinearFlow();

    expect(settings.reset).toHaveBeenCalledWith(LINEAR_TOKEN_SETTING_PATH);
    expect(state().isAuthenticated).toBe(false);
  });

  it("logout warns when the daemon env key still authenticates after the clear", async () => {
    api.getAuthState.mockResolvedValueOnce({ isAuthenticated: true, requiresAugmentAuth: false });

    await logoutLinearFlow();

    expect(state().isAuthenticated).toBe(true);
    expect(state().error).toMatch(/LINEAR_API_KEY/);
  });

  it("dispatching connectLinear invokes the flow (middleware wiring)", async () => {
    api.getAuthState.mockResolvedValue({ isAuthenticated: true, requiresAugmentAuth: false });

    appStore.dispatch(connectLinear("lin_api_via_action"));
    await flush();

    expect(settings.update).toHaveBeenCalledWith([
      { path: LINEAR_TOKEN_SETTING_PATH, value: "lin_api_via_action" },
    ]);
  });

  it("dispatching logoutLinear invokes the flow (middleware wiring)", async () => {
    api.getAuthState.mockResolvedValue({ isAuthenticated: false, requiresAugmentAuth: false });

    appStore.dispatch(logoutLinear());
    await flush();

    expect(settings.reset).toHaveBeenCalledWith(LINEAR_TOKEN_SETTING_PATH);
  });
});
