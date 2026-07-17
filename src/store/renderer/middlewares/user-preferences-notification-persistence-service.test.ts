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
    vi.useFakeTimers();
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
    vi.useRealTimers();
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

      await vi.runAllTimersAsync();
      // Should not dispatch anything on hydration failure
      expect(mockApi.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("daemon settings.update persistence", () => {
    const initialState: Partial<StoreState> = {
      userPreferences: {
        enabled: true,
        soundEnabled: false,
        soundOnlyWhenUnfocused: true,
        volume: 0.3,
      } as StoreState["userPreferences"],
    };

    beforeEach(async () => {
      // Mock settings.get to return defaults (for hydration)
      vi.mocked(backendRequest).mockImplementation(async (method) => {
        if (method === "settings.get") return { value: true };
        return {};
      });

      mockApi.getState.mockReturnValue(initialState);

      // Trigger hydration on a dummy action so it completes before each test
      const chain = middleware(mockApi)(mockNext);
      chain({ type: "init" });
      await vi.runAllTimersAsync();

      // Reset mocks to clear hydration calls
      vi.clearAllMocks();
    });

    it("persists all four notification paths on setNotificationEnabled", async () => {
      const action = setNotificationEnabled(false);
      const chain = middleware(mockApi)(mockNext);

      // Mock the reducer updating the state after the action
      mockApi.getState.mockReturnValue({
        userPreferences: {
          enabled: false, // Changed by reducer
          soundEnabled: false,
          soundOnlyWhenUnfocused: true,
          volume: 0.3,
        },
      } as Partial<StoreState>);

      chain(action);
      await vi.advanceTimersByTimeAsync(100);

      expect(backendRequest).toHaveBeenCalledWith("settings.update", {
        changes: [
          { path: "notifications.enabled", value: false }, // Post-reducer value
          { path: "notifications.soundEnabled", value: false },
          { path: "notifications.soundOnlyWhenUnfocused", value: true },
          { path: "notifications.volume", value: 0.3 },
        ],
      });
    });

    it("persists all four notification paths on setSoundEnabled", async () => {
      const action = setSoundEnabled(true);
      const chain = middleware(mockApi)(mockNext);

      // Mock the reducer updating the state after the action
      mockApi.getState.mockReturnValue({
        userPreferences: {
          enabled: true,
          soundEnabled: true, // Changed by reducer
          soundOnlyWhenUnfocused: true,
          volume: 0.3,
        },
      } as Partial<StoreState>);

      chain(action);
      await vi.advanceTimersByTimeAsync(100);

      expect(backendRequest).toHaveBeenCalledWith("settings.update", {
        changes: [
          { path: "notifications.enabled", value: true },
          { path: "notifications.soundEnabled", value: true }, // Post-reducer value
          { path: "notifications.soundOnlyWhenUnfocused", value: true },
          { path: "notifications.volume", value: 0.3 },
        ],
      });
    });

    it("persists all four paths on resetNotificationSettings", async () => {
      const action = resetNotificationSettings();
      const chain = middleware(mockApi)(mockNext);

      // Mock the reducer resetting to defaults
      mockApi.getState.mockReturnValue({
        userPreferences: {
          enabled: true,
          soundEnabled: true,
          soundOnlyWhenUnfocused: false,
          volume: 0.5,
        },
      } as Partial<StoreState>);

      chain(action);
      await vi.advanceTimersByTimeAsync(100);

      expect(backendRequest).toHaveBeenCalledWith("settings.update", {
        changes: expect.arrayContaining([
          expect.objectContaining({ path: "notifications.enabled" }),
          expect.objectContaining({ path: "notifications.soundEnabled" }),
          expect.objectContaining({ path: "notifications.soundOnlyWhenUnfocused" }),
          expect.objectContaining({ path: "notifications.volume" }),
        ]),
      });
    });

    it("debounces multiple rapid updates (100ms)", async () => {
      // Create a fresh middleware instance to trigger hydration first
      const freshMiddleware = createUserPreferencesNotificationPersistenceMiddleware();
      vi.mocked(backendRequest).mockResolvedValue({ value: true });

      const chain = freshMiddleware(mockApi)(mockNext);

      // Trigger hydration with first action
      chain({ type: "init" });

      // Wait for hydration to complete
      await vi.runAllTimersAsync();

      // Clear mocks and test debouncing
      vi.clearAllMocks();

      // Simulate rapid updates with evolving state
      mockApi.getState.mockReturnValue({
        userPreferences: {
          enabled: true,
          soundEnabled: true, // Changed
          soundOnlyWhenUnfocused: true,
          volume: 0.3,
        },
      } as Partial<StoreState>);
      chain(setSoundEnabled(true));

      await vi.advanceTimersByTimeAsync(50);
      // Should still be in debounce window
      expect(backendRequest).not.toHaveBeenCalled();

      mockApi.getState.mockReturnValue({
        userPreferences: {
          enabled: true,
          soundEnabled: true,
          soundOnlyWhenUnfocused: true,
          volume: 0.8, // Changed
        },
      } as Partial<StoreState>);
      chain(setVolume(0.8));

      mockApi.getState.mockReturnValue({
        userPreferences: {
          enabled: true,
          soundEnabled: true,
          soundOnlyWhenUnfocused: false, // Changed
          volume: 0.8,
        },
      } as Partial<StoreState>);
      chain(setSoundOnlyWhenUnfocused(false));

      await vi.advanceTimersByTimeAsync(100);
      // After debounce, should have persisted once with final state
      expect(backendRequest).toHaveBeenCalledTimes(1);
      expect(backendRequest).toHaveBeenCalledWith("settings.update", {
        changes: [
          { path: "notifications.enabled", value: true },
          { path: "notifications.soundEnabled", value: true },
          { path: "notifications.soundOnlyWhenUnfocused", value: false },
          { path: "notifications.volume", value: 0.8 },
        ],
      });
    });

    it("does not persist actions dispatched during hydration (no echo-write)", async () => {
      // Create a fresh middleware instance that will hydrate on first action
      const freshMiddleware = createUserPreferencesNotificationPersistenceMiddleware();
      vi.mocked(backendRequest).mockImplementation(async (method, params) => {
        if (method === "settings.get") {
          const path = (params as { path: string }).path;
          if (path === "notifications.enabled") return { value: false };
          if (path === "notifications.soundEnabled") return { value: true };
          if (path === "notifications.soundOnlyWhenUnfocused") return { value: false };
          if (path === "notifications.volume") return { value: 0.6 };
        }
        return {};
      });

      // Wire mockApi.dispatch to route actions back through the middleware chain
      // so hydration-dispatched actions actually traverse the middleware
      const chain = freshMiddleware(mockApi)(mockNext);
      mockApi.dispatch.mockImplementation((action) => {
        chain(action);
        return action;
      });

      // Trigger hydration
      chain({ type: "init" });

      // Wait for hydration promise to settle (flush microtasks, not timers)
      await vi.waitFor(() => {
        expect(backendRequest).toHaveBeenCalledTimes(4);
      });

      // Verify: 4 settings.get calls (hydration), 0 settings.update calls (no echo-write)
      expect(backendRequest).toHaveBeenCalledWith("settings.get", expect.any(Object));
      expect(backendRequest).not.toHaveBeenCalledWith("settings.update", expect.any(Object));
      expect(backendRequest).toHaveBeenCalledTimes(4);
    });
  });
});
