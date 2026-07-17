import { beforeEach, describe, expect, it, vi } from "vitest";
import { setZoomFactor } from "../slices/user-preferences/user-preferences-slice";

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockDispatch } = vi.hoisted(() => {
  const mockDispatch = vi.fn();
  return {
    mockDispatch,
    mockAppStore: { dispatch: mockDispatch },
  };
});

vi.mock("$store/renderer/store", () => ({
  store: mockAppStore,
}));

vi.mock("$lib/electron-bridge", () => ({
  isElectron: vi.fn(() => true),
}));

// Import after mocking
import { createZoomSyncMiddleware } from "./zoom-sync-service";

describe("createZoomSyncMiddleware", () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let mockOff: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => "listener-id-123");
    mockOff = vi.fn();

    // Mock window.electronAPI
    (global as any).window = {
      electronAPI: {
        on: mockOn,
        off: mockOff,
      },
    };
  });

  it("registers window:zoom-changed listener on creation", () => {
    const middleware = createZoomSyncMiddleware();
    const apiStub = {} as any;
    middleware(apiStub)(next);

    expect(mockOn).toHaveBeenCalledWith("window:zoom-changed", expect.any(Function));
  });

  it("dispatches setZoomFactor when valid zoom event is received", () => {
    const middleware = createZoomSyncMiddleware();
    const apiStub = {} as any;
    middleware(apiStub)(next);

    // Get the registered handler
    const handler = mockOn.mock.calls[0][1];

    // Simulate zoom event
    handler({ payload: { zoomFactor: 1.5 } });

    expect(mockDispatch).toHaveBeenCalledWith(setZoomFactor(1.5));
  });

  it("does not dispatch for invalid zoom factor (negative)", () => {
    const middleware = createZoomSyncMiddleware();
    const apiStub = {} as any;
    middleware(apiStub)(next);

    const handler = mockOn.mock.calls[0][1];
    handler({ payload: { zoomFactor: -1 } });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch for invalid zoom factor (zero)", () => {
    const middleware = createZoomSyncMiddleware();
    const apiStub = {} as any;
    middleware(apiStub)(next);

    const handler = mockOn.mock.calls[0][1];
    handler({ payload: { zoomFactor: 0 } });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch for invalid zoom factor (non-number)", () => {
    const middleware = createZoomSyncMiddleware();
    const apiStub = {} as any;
    middleware(apiStub)(next);

    const handler = mockOn.mock.calls[0][1];
    handler({ payload: { zoomFactor: "1.5" as any } });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("passes through all actions", () => {
    const middleware = createZoomSyncMiddleware();
    const apiStub = {} as any;
    const middlewareChain = middleware(apiStub)(next);

    const action = { type: "test/action" };
    const result = middlewareChain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });
});
