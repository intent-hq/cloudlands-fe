/**
 * Tests for beta-updates persistence middleware — validates channel switch on
 * action dispatch and real-mode boot hydration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUserPreferencesBetaPersistenceMiddleware } from "./user-preferences-beta-persistence-service";
import {
  loadBetaUpdatesSettings,
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from "../slices/user-preferences/user-preferences-slice";
import type { StoreState } from "../types";
import { autoUpdateClient } from "$features/auto-update/auto-update.client";

vi.mock("$features/auto-update/auto-update.client", () => ({
  autoUpdateClient: {
    setChannel: vi.fn(),
    getState: vi.fn(),
  },
}));

describe("userPreferencesBetaPersistenceMiddleware", () => {
  let middleware: ReturnType<typeof createUserPreferencesBetaPersistenceMiddleware>;
  let mockApi: {
    dispatch: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    middleware = createUserPreferencesBetaPersistenceMiddleware();
    mockApi = {
      dispatch: vi.fn(),
      getState: vi.fn(),
    };
    mockNext = vi.fn((action) => action);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("boot-time hydration", () => {
    it("hydrates betaUpdatesEnabled from main process at store init, without any action", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "beta",
        status: "idle",
      });

      // Chain construction alone (as Store.init() does) must trigger hydration
      middleware(mockApi);

      await vi.waitFor(() => {
        expect(autoUpdateClient.getState).toHaveBeenCalled();
        expect(mockApi.dispatch).toHaveBeenCalledWith(loadBetaUpdatesSettings(true));
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("hydrates false when main process channel is stable", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "stable",
        status: "idle",
      });

      middleware(mockApi);

      await vi.waitFor(() => {
        expect(mockApi.dispatch).toHaveBeenCalledWith(loadBetaUpdatesSettings(false));
      });
    });

    it("does not echo hydration back into setChannel", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "beta",
        status: "idle",
      });
      mockApi.getState.mockReturnValue({
        userPreferences: { betaUpdatesEnabled: true },
      } as StoreState);

      const chain = middleware(mockApi)(mockNext);
      chain({ type: "any/action" });

      await vi.waitFor(() => {
        expect(mockApi.dispatch).toHaveBeenCalledWith(loadBetaUpdatesSettings(true));
      });

      // Re-dispatch the hydration action through the middleware, as the real
      // store would — it must NOT trigger a channel switch / persistence write
      chain(loadBetaUpdatesSettings(true));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(autoUpdateClient.setChannel).not.toHaveBeenCalled();
    });

    it("logs warning and continues if getState fails", async () => {
      vi.mocked(autoUpdateClient.getState).mockRejectedValue(new Error("IPC failed"));

      middleware(mockApi);

      // Hydration should not throw or crash the middleware
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockApi.dispatch).not.toHaveBeenCalled();
    });

    it("hydrates once per store init regardless of dispatched actions", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "beta",
        status: "idle",
      });

      const chain = middleware(mockApi)(mockNext);
      chain({ type: "first/action" });
      chain({ type: "second/action" });

      await vi.waitFor(() => {
        expect(autoUpdateClient.getState).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("channel persistence", () => {
    const mockState: StoreState = {
      userPreferences: {
        betaUpdatesEnabled: true,
      },
    } as StoreState;

    let chain: (action: unknown) => unknown;

    beforeEach(() => {
      mockApi.getState.mockReturnValue(mockState);
      // Init-time hydration fires at chain construction; give it a benign state
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "stable",
        status: "idle",
      });
      chain = middleware(mockApi)(mockNext);
    });

    it("calls setChannel(beta) exactly once when setBetaUpdatesEnabled(true)", async () => {
      chain(setBetaUpdatesEnabled(true));

      await vi.waitFor(() => {
        expect(autoUpdateClient.setChannel).toHaveBeenCalledWith("beta");
      });
      expect(autoUpdateClient.setChannel).toHaveBeenCalledTimes(1);
    });

    it("calls setChannel(stable) exactly once when setBetaUpdatesEnabled(false)", async () => {
      mockApi.getState.mockReturnValue({
        userPreferences: { betaUpdatesEnabled: false },
      } as StoreState);

      chain(setBetaUpdatesEnabled(false));

      await vi.waitFor(() => {
        expect(autoUpdateClient.setChannel).toHaveBeenCalledWith("stable");
      });
      expect(autoUpdateClient.setChannel).toHaveBeenCalledTimes(1);
    });

    it("calls setChannel exactly once on toggleBetaUpdates", async () => {
      chain(toggleBetaUpdates());

      await vi.waitFor(() => {
        expect(autoUpdateClient.setChannel).toHaveBeenCalled();
      });
      expect(autoUpdateClient.setChannel).toHaveBeenCalledTimes(1);
    });

    it("does not call setChannel for unrelated actions", () => {
      chain({ type: "some/otherAction" });

      expect(autoUpdateClient.setChannel).not.toHaveBeenCalled();
    });
  });
});
