import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setOpenAction,
  toggleHiddenEditor,
} from "../slices/external-editors/external-editors-slice";

// Use vi.hoisted to ensure mocks are available before module resolution
const { mockAppStore, mockAppClient, mockSafeLocalStorage } = vi.hoisted(() => {
  return {
    mockAppStore: {
      state: {
        externalEditors: {
          hiddenEditorIds: ["code", "vscode"],
        },
      },
      dispatch: vi.fn(),
    },
    mockAppClient: {
      settings: {
        get: vi.fn().mockResolvedValue({ value: ["code"] }),
        update: vi.fn().mockResolvedValue([{ path: "hiddenOpenInEditors", value: ["code", "vscode"] }]),
      },
    },
    mockSafeLocalStorage: {
      setItem: vi.fn(),
      getItem: vi.fn(),
      getItemWithStatus: vi.fn(() => ({ value: null, hadError: false })),
    },
  };
});

vi.mock("$lib/client", () => ({
  appClient: mockAppClient,
}));

vi.mock("$lib/utils/safe-storage", () => ({
  safeLocalStorage: mockSafeLocalStorage,
}));

vi.mock("$store/renderer/store", () => ({
  store: mockAppStore,
}));

// Import after mocking
import { createExternalEditorsPersistenceMiddleware } from "./external-editors-persistence-service";

describe("createExternalEditorsPersistenceMiddleware", () => {
  let next: ReturnType<typeof vi.fn>;
  let middlewareChain: ReturnType<ReturnType<ReturnType<typeof createExternalEditorsPersistenceMiddleware>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn((action) => action);

    const middleware = createExternalEditorsPersistenceMiddleware();
    const apiStub = {} as any;
    middlewareChain = middleware(apiStub)(next);
  });

  it("persists open action to localStorage on setOpenAction", () => {
    const action = setOpenAction("open");
    middlewareChain(action);

    expect(mockSafeLocalStorage.setItem).toHaveBeenCalledWith("open-combo-button-last-action", "open");
    expect(next).toHaveBeenCalledWith(action);
  });

  it("persists hidden editor IDs to daemon settings on toggleHiddenEditor", () => {
    const action = toggleHiddenEditor("atom");
    middlewareChain(action);

    expect(mockAppClient.settings.update).toHaveBeenCalledWith([
      { path: "hiddenOpenInEditors", value: ["code", "vscode"] },
    ]);
    expect(next).toHaveBeenCalledWith(action);
  });

  it("does not persist for unrelated actions", () => {
    const action = { type: "unrelated/action" };
    middlewareChain(action);

    expect(mockSafeLocalStorage.setItem).not.toHaveBeenCalled();
    expect(mockAppClient.settings.update).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(action);
  });
});
