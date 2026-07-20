import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { goto } from "$app/navigation";

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockState, mockIsElectron, mockPlayNotificationSound } = vi.hoisted(() => {
  const mockState = {
    userPreferences: {
      enabled: true,
      soundEnabled: true,
      soundOnlyWhenUnfocused: false,
      volume: 0.5,
    },
  };
  return {
    mockState,
    mockAppStore: { state: mockState, dispatch: vi.fn() },
    mockIsElectron: vi.fn(() => true),
    mockPlayNotificationSound: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("$store/renderer/store", () => ({
  store: mockAppStore,
}));

vi.mock("$lib/electron-bridge", () => ({
  isElectron: mockIsElectron,
}));

vi.mock("$lib/utils/notification-sound", () => ({
  playNotificationSound: mockPlayNotificationSound,
}));

// Import after mocking
import { createNotificationIpcMiddleware } from "./notification-ipc-service";

describe("createNotificationIpcMiddleware", () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;

  const setupMiddleware = () => {
    const middleware = createNotificationIpcMiddleware();
    middleware({} as any)(next);
    const showHandler = mockOn.mock.calls.find((c) => c[0] === "notification:show")?.[1];
    const navigateHandler = mockOn.mock.calls.find((c) => c[0] === "notification:navigate")?.[1];
    return { showHandler, navigateHandler };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    mockState.userPreferences.soundEnabled = true;
    mockState.userPreferences.soundOnlyWhenUnfocused = false;
    mockState.userPreferences.volume = 0.5;
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => "listener-id-123");
    (window as any).electronAPI = { on: mockOn };
    hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
    delete (window as any).electronAPI;
  });

  it("registers notification:show and notification:navigate listeners on creation", () => {
    setupMiddleware();

    expect(mockOn).toHaveBeenCalledWith("notification:show", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("notification:navigate", expect.any(Function));
  });

  it("does not register listeners outside Electron", () => {
    mockIsElectron.mockReturnValue(false);
    setupMiddleware();

    expect(mockOn).not.toHaveBeenCalled();
  });

  describe("notification:show (sound gate)", () => {
    it("plays the sound at the configured volume when sound is enabled", async () => {
      mockState.userPreferences.volume = 0.8;
      const { showHandler } = setupMiddleware();

      await showHandler({ title: "Agent", body: "Finished", timestamp: "t" });

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.8);
    });

    it("does not play the sound when soundEnabled is off", async () => {
      mockState.userPreferences.soundEnabled = false;
      const { showHandler } = setupMiddleware();

      await showHandler({ title: "Agent", body: "Finished", timestamp: "t" });

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it("does not play the sound when soundOnlyWhenUnfocused is on and document has focus", async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(true);
      const { showHandler } = setupMiddleware();

      await showHandler({ title: "Agent", body: "Finished", timestamp: "t" });

      expect(mockPlayNotificationSound).not.toHaveBeenCalled();
    });

    it("plays the sound when soundOnlyWhenUnfocused is on and document is unfocused", async () => {
      mockState.userPreferences.soundOnlyWhenUnfocused = true;
      hasFocusSpy.mockReturnValue(false);
      const { showHandler } = setupMiddleware();

      await showHandler({ title: "Agent", body: "Finished", timestamp: "t" });

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it("plays the sound while focused when soundOnlyWhenUnfocused is off", async () => {
      hasFocusSpy.mockReturnValue(true);
      const { showHandler } = setupMiddleware();

      await showHandler({ title: "Agent", body: "Finished", timestamp: "t" });

      expect(mockPlayNotificationSound).toHaveBeenCalledWith(0.5);
    });

    it("swallows sound playback failures", async () => {
      mockPlayNotificationSound.mockRejectedValueOnce(new Error("boom"));
      const { showHandler } = setupMiddleware();

      await expect(showHandler({ title: "Agent" })).resolves.toBeUndefined();
    });
  });

  describe("notification:navigate", () => {
    it("navigates to the emitting workspace", async () => {
      const { navigateHandler } = setupMiddleware();

      await navigateHandler({ workspaceId: "ws-123" });

      expect(goto).toHaveBeenCalledWith("/workspace/ws-123");
    });

    it("ignores payloads without a workspaceId", async () => {
      const { navigateHandler } = setupMiddleware();

      await navigateHandler({});
      await navigateHandler(undefined);
      await navigateHandler(null);

      expect(goto).not.toHaveBeenCalled();
    });

    it("swallows navigation failures", async () => {
      vi.mocked(goto).mockRejectedValueOnce(new Error("nav failed"));
      const { navigateHandler } = setupMiddleware();

      await expect(navigateHandler({ workspaceId: "ws-123" })).resolves.toBeUndefined();
    });
  });

  it("passes through all actions", () => {
    const middleware = createNotificationIpcMiddleware();
    const chain = middleware({} as any)(next);

    const action = { type: "test/action" };
    const result = chain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
