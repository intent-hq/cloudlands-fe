import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockIsElectron, mockNavigateToRoute, mockToastWarning, mockToastError } = vi.hoisted(() => ({
  mockIsElectron: vi.fn(() => true),
  mockNavigateToRoute: vi.fn(() => Promise.resolve()),
  mockToastWarning: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("$lib/electron-bridge", () => ({
  isElectron: mockIsElectron,
}));

vi.mock("$lib/utils/navigation.client", () => ({
  navigateToRoute: mockNavigateToRoute,
  isHudWindowRenderer: () => false,
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    warning: mockToastWarning,
    error: mockToastError,
  },
}));

// Import after mocking
import { createAgentEventsIpcMiddleware } from "./agent-events-ipc-service";

describe("createAgentEventsIpcMiddleware", () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  const initMiddleware = () => {
    const middleware = createAgentEventsIpcMiddleware();
    return middleware({} as any)(next);
  };

  const getHandler = (channel: string) => {
    const call = mockOn.mock.calls.find(([ch]) => ch === channel);
    expect(call, `expected a listener for ${channel}`).toBeDefined();
    return call![1] as (data: unknown) => Promise<void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => "listener-id-123");

    (global as any).window = {
      electronAPI: {
        on: mockOn,
        off: vi.fn(),
      },
    };
  });

  it("registers agent:auth-required and agent:plan-required listeners on creation", () => {
    initMiddleware();

    expect(mockOn).toHaveBeenCalledWith("agent:auth-required", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("agent:plan-required", expect.any(Function));
  });

  it("does not register listeners outside Electron", () => {
    mockIsElectron.mockReturnValue(false);
    initMiddleware();

    expect(mockOn).not.toHaveBeenCalled();
  });

  it("shows a warning toast on agent:auth-required", async () => {
    initMiddleware();

    await getHandler("agent:auth-required")({
      workspaceId: "ws-1",
      isRemote: true,
      message: "Please authenticate",
    });

    expect(mockToastWarning).toHaveBeenCalledWith("Agent Authentication Required", {
      description: "Please authenticate",
      duration: 15000,
      action: {
        label: "Open Terminal",
        onClick: expect.any(Function),
      },
    });
  });

  it("navigates to the workspace terminal panel when the toast action is clicked", async () => {
    initMiddleware();

    await getHandler("agent:auth-required")({
      workspaceId: "ws-1",
      isRemote: false,
      message: "Please authenticate",
    });

    const { action } = mockToastWarning.mock.calls[0][1];
    action.onClick();

    expect(mockNavigateToRoute).toHaveBeenCalledWith("/workspace/ws-1?panel=terminal");
  });

  it("does not navigate from the toast action when workspaceId is missing", async () => {
    initMiddleware();

    await getHandler("agent:auth-required")({ isRemote: true, message: "Please authenticate" });

    const { action } = mockToastWarning.mock.calls[0][1];
    action.onClick();

    expect(mockNavigateToRoute).not.toHaveBeenCalled();
  });

  it("shows an error toast on agent:plan-required", async () => {
    initMiddleware();

    await getHandler("agent:plan-required")({
      message: "Upgrade your plan",
      helpUrl: "https://example.com",
    });

    expect(mockToastError).toHaveBeenCalledWith("Intent: Plan Upgrade Required", {
      description: "Upgrade your plan",
      duration: 20000,
    });
  });

  it("swallows toast failures", async () => {
    mockToastWarning.mockImplementation(() => {
      throw new Error("toast unavailable");
    });
    mockToastError.mockImplementation(() => {
      throw new Error("toast unavailable");
    });
    initMiddleware();

    await expect(
      getHandler("agent:auth-required")({ isRemote: true, message: "m" }),
    ).resolves.toBeUndefined();
    await expect(getHandler("agent:plan-required")({ message: "m" })).resolves.toBeUndefined();
  });

  it("passes through all actions", () => {
    const middlewareChain = initMiddleware();

    const action = { type: "test/action" };
    const result = middlewareChain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
