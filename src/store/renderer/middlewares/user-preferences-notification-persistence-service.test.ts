/**
 * Tests for notification-settings persistence middleware — validates daemon
 * settings.update calls on action dispatch and real-mode boot hydration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUserPreferencesNotificationPersistenceMiddleware } from "./user-preferences-notification-persistence-service";
import {
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
  resetNotificationSettings,
} from "../slices/user-preferences/user-preferences-slice";
import type { StoreState } from "../types";
import { backendRequest } from "$lib/client/live/backend-transport";

vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

describe("userPreferencesNotificationPersistenceMiddleware", () => {
  let middleware: ReturnType<typeof createUserPreferencesNotificationPersistenceMiddleware>;
  let mockApi: {
    dispatch: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    middleware = createUserPreferencesNotificationPersistenceMiddleware();
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
    it("hydrates notification settings from daemon on first action", async () => {
      vi.mocked(backendRequest).mockImplementation(async (method, params) => {
        if (method === "settings.get") {
          const path = (params as { path: string }).path;
          if (path === "notifications.enabled") return { value: true };
          if (path === "notifications.soundEnabled") return { value: false };
          if (path === "notifications.soundOnlyWhenUnfocused") return { value: true };
          if (path === "notifications.volume") return { value: 0.7 };
        }
        return {};
      });

      const action = { type: "any/action" };
      middleware(mockApi)(mockNext)(action);

      await vi.waitFor(() => {
        expect(backendRequest).toHaveBeenCalledWith("settings.get", {
          path: "notifications.enabled",
        });
        expect(backendRequest).toHaveBeenCalledWith("settings.get", {
          path: "notifications.soundEnabled",
        });
        expect(mockApi.dispatch).toHaveBeenCalledWith(setNotificationEnabled(true));
        expect(mockApi.dispatch).toHaveBeenCalledWith(setSoundEnabled(false));
        expect(mockApi.dispatch).toHaveBeenCalledWith(setSoundOnlyWhenUnfocused(true));
        expect(mockApi.dispatch).toHaveBeenCalledWith(setVolume(0.7));
      });
    });

    it("only hydrates once on first action", async () => {
      vi.mocked(backendRequest).mockResolvedValue({ value: true });

      middleware(mockApi)(mockNext)({ type: "first/action" });
      middleware(mockApi)(mockNext)({ type: "second/action" });

      await vi.waitFor(() => {
        // Should be called 4 times for first action (one per setting path), not again for second
        expect(backendRequest).toHaveBeenCalledTimes(4);
      });
    });

    it("logs warning and continues if hydration fails", async () => {
      vi.mocked(backendRequest).mockRejectedValue(new Error("IPC failed"));

      const action = { type: "any/action" };
      middleware(mockApi)(mockNext)(action);

      await new Promise((resolve) => setTimeout(resolve, 50));
      // Should not dispatch anything on hydration failure
      expect(mockApi.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("daemon settings.update persistence", () => {
    const mockState: Partial<StoreState> = {
      userPreferences: {
        enabled: true,
        soundEnabled: false,
        soundOnlyWhenUnfocused: true,
        volume: 0.3,
      } as StoreState["userPreferences"],
    };

    beforeEach(() => {
      mockApi.getState.mockReturnValue(mockState);
      // Reset mocks to clear hydration calls
      vi.clearAllMocks();
    });

    it("persists all four notification paths on setNotificationEnabled", async () => {
      const action = setNotificationEnabled(false);
      const chain = middleware(mockApi)(mockNext);
      chain(action);

      await vi.waitFor(() => {
        expect(backendRequest).toHaveBeenCalledWith("settings.update", {
          changes: [
            { path: "notifications.enabled", value: true },
            { path: "notifications.soundEnabled", value: false },
            { path: "notifications.soundOnlyWhenUnfocused", value: true },
            { path: "notifications.volume", value: 0.3 },
          ],
        });
      }, { timeout: 200 });
    });

    it("persists all four notification paths on setSoundEnabled", async () => {
      const action = setSoundEnabled(true);
      const chain = middleware(mockApi)(mockNext);
      chain(action);

      await vi.waitFor(() => {
        expect(backendRequest).toHaveBeenCalledWith("settings.update", {
          changes: [
            { path: "notifications.enabled", value: true },
            { path: "notifications.soundEnabled", value: false },
            { path: "notifications.soundOnlyWhenUnfocused", value: true },
            { path: "notifications.volume", value: 0.3 },
          ],
        });
      }, { timeout: 200 });
    });

    it("persists all four paths on resetNotificationSettings", async () => {
      const action = resetNotificationSettings();
      const chain = middleware(mockApi)(mockNext);
      chain(action);

      await vi.waitFor(() => {
        expect(backendRequest).toHaveBeenCalledWith("settings.update", {
          changes: expect.arrayContaining([
            expect.objectContaining({ path: "notifications.enabled" }),
            expect.objectContaining({ path: "notifications.soundEnabled" }),
            expect.objectContaining({ path: "notifications.soundOnlyWhenUnfocused" }),
            expect.objectContaining({ path: "notifications.volume" }),
          ]),
        });
      }, { timeout: 200 });
    });

    it("debounces multiple rapid updates (100ms)", async () => {
      // Create a fresh middleware instance to trigger hydration first
      const freshMiddleware = createUserPreferencesNotificationPersistenceMiddleware();
      vi.mocked(backendRequest).mockResolvedValue({ value: true });

      const chain = freshMiddleware(mockApi)(mockNext);

      // Trigger hydration with first action
      chain({ type: "init" });

      // Wait for hydration to complete
      await vi.waitFor(() => {
        expect(backendRequest).toHaveBeenCalledTimes(4);
      });

      // Now clear mocks and test debouncing
      vi.clearAllMocks();

      chain(setSoundEnabled(true));
      chain(setVolume(0.8));
      chain(setSoundOnlyWhenUnfocused(false));

      await new Promise((resolve) => setTimeout(resolve, 50));
      // Should still be in debounce window
      expect(backendRequest).not.toHaveBeenCalled();

      await vi.waitFor(() => {
        // After debounce, should have persisted once with final state
        expect(backendRequest).toHaveBeenCalledTimes(1);
      }, { timeout: 200 });
    });
  });
});
