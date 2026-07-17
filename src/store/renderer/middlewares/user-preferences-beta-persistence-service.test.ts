/**
 * Tests for beta-updates persistence middleware — validates channel switch on
 * action dispatch and real-mode boot hydration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUserPreferencesBetaPersistenceMiddleware } from "./user-preferences-beta-persistence-service";
import {
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
    it("hydrates betaUpdatesEnabled from main process on first action", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "beta",
        status: "idle",
      });

      const action = { type: "any/action" };
      middleware(mockApi)(mockNext)(action);

      // Wait for async hydration
      await vi.waitFor(() => {
        expect(autoUpdateClient.getState).toHaveBeenCalled();
        expect(mockApi.dispatch).toHaveBeenCalledWith(setBetaUpdatesEnabled(true));
      });
    });

    it("hydrates false when main process channel is stable", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "stable",
        status: "idle",
      });

      const action = { type: "any/action" };
      middleware(mockApi)(mockNext)(action);

      await vi.waitFor(() => {
        expect(mockApi.dispatch).toHaveBeenCalledWith(setBetaUpdatesEnabled(false));
      });
    });

    it("logs warning and continues if getState fails", async () => {
      vi.mocked(autoUpdateClient.getState).mockRejectedValue(new Error("IPC failed"));

      const action = { type: "any/action" };
      middleware(mockApi)(mockNext)(action);

      // Hydration should not throw or crash the middleware
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockApi.dispatch).not.toHaveBeenCalled();
    });

    it("only hydrates once on first action", async () => {
      vi.mocked(autoUpdateClient.getState).mockResolvedValue({
        channel: "beta",
        status: "idle",
      });

      middleware(mockApi)(mockNext)({ type: "first/action" });
      middleware(mockApi)(mockNext)({ type: "second/action" });

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

    beforeEach(() => {
      mockApi.getState.mockReturnValue(mockState);
      // Ensure hydration already ran
      middleware(mockApi)(mockNext)({ type: "init" });
    });

    it("calls setChannel(beta) when setBetaUpdatesEnabled(true)", async () => {
      const action = setBetaUpdatesEnabled(true);
      middleware(mockApi)(mockNext)(action);

      await vi.waitFor(() => {
        expect(autoUpdateClient.setChannel).toHaveBeenCalledWith("beta");
      });
    });

    it("calls setChannel(stable) when setBetaUpdatesEnabled(false)", async () => {
      mockApi.getState.mockReturnValue({
        userPreferences: { betaUpdatesEnabled: false },
      } as StoreState);

      const action = setBetaUpdatesEnabled(false);
      middleware(mockApi)(mockNext)(action);

      await vi.waitFor(() => {
        expect(autoUpdateClient.setChannel).toHaveBeenCalledWith("stable");
      });
    });

    it("calls setChannel on toggleBetaUpdates", async () => {
      const action = toggleBetaUpdates();
      middleware(mockApi)(mockNext)(action);

      await vi.waitFor(() => {
        expect(autoUpdateClient.setChannel).toHaveBeenCalled();
      });
    });

    it("does not call setChannel for unrelated actions", () => {
      const action = { type: "some/otherAction" };
      middleware(mockApi)(mockNext)(action);

      expect(autoUpdateClient.setChannel).not.toHaveBeenCalled();
    });
  });
});
