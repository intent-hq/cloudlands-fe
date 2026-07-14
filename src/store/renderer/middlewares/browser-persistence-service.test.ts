/**
 * Tests for browser persistence middleware — validates localStorage hydration on
 * workspace init and persistence after mutating actions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBrowserPersistenceMiddleware } from "./browser-persistence-service";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  initBrowserWorkspace,
  hydrateBrowserState,
  addRecentUrl,
  updateUrlMetadata,
  removeRecentUrl,
  clearRecentUrls,
} from "../slices/browser/browser-slice";
import type { StoreState } from "../types";
import type { RecentUrl } from "../slices/browser/browser-types";
import { storageKey } from "../slices/browser/browser-storage-utils";

vi.mock("$lib/utils/safe-storage", () => ({
  safeLocalStorage: {
    getJSON: vi.fn(),
    setJSON: vi.fn(),
  },
}));

describe("browserPersistenceMiddleware", () => {
  let middleware: ReturnType<typeof createBrowserPersistenceMiddleware>;
  let mockApi: {
    dispatch: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    middleware = createBrowserPersistenceMiddleware();
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

  describe("hydration on initBrowserWorkspace", () => {
    it("loads recent URLs from localStorage and dispatches hydrateBrowserState", () => {
      const workspaceId = "ws-123";
      const storedUrls: RecentUrl[] = [
        { url: "https://example.com", title: "Example", lastVisited: "2026-01-01T00:00:00Z" },
      ];
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue(storedUrls);

      const action = initBrowserWorkspace(workspaceId);
      middleware(mockApi)(mockNext)(action);

      expect(safeLocalStorage.getJSON).toHaveBeenCalledWith(storageKey(workspaceId));
      expect(mockApi.dispatch).toHaveBeenCalledWith(hydrateBrowserState(workspaceId, storedUrls));
    });

    it("dispatches empty array if localStorage has no data", () => {
      const workspaceId = "ws-456";
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue(null);

      const action = initBrowserWorkspace(workspaceId);
      middleware(mockApi)(mockNext)(action);

      expect(mockApi.dispatch).toHaveBeenCalledWith(hydrateBrowserState(workspaceId, []));
    });

    it("dispatches empty array if stored data is not an array", () => {
      const workspaceId = "ws-789";
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue({ invalid: "data" });

      const action = initBrowserWorkspace(workspaceId);
      middleware(mockApi)(mockNext)(action);

      expect(mockApi.dispatch).toHaveBeenCalledWith(hydrateBrowserState(workspaceId, []));
    });
  });

  describe("persistence after mutations", () => {
    const workspaceId = "ws-persist";
    const mockState: StoreState = {
      browser: {
        byWorkspaceId: {
          [workspaceId]: {
            recentUrls: [
              { url: "https://a.com", title: "A", lastVisited: "2026-01-01T00:00:00Z" },
              { url: "https://b.com", title: "B", lastVisited: "2026-01-02T00:00:00Z" },
            ],
            currentUrl: null,
            isLoading: false,
            pendingZoomByTabId: {},
          },
        },
      },
    } as StoreState;

    beforeEach(() => {
      mockApi.getState.mockReturnValue(mockState);
    });

    it("persists after addRecentUrl", () => {
      const action = addRecentUrl(workspaceId, "https://c.com", "C", undefined, "2026-01-03T00:00:00Z");
      middleware(mockApi)(mockNext)(action);

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        storageKey(workspaceId),
        mockState.browser.byWorkspaceId[workspaceId].recentUrls,
      );
    });

    it("persists after updateUrlMetadata", () => {
      const action = updateUrlMetadata(workspaceId, "https://a.com", "Updated A", "https://a.com/fav.ico");
      middleware(mockApi)(mockNext)(action);

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        storageKey(workspaceId),
        mockState.browser.byWorkspaceId[workspaceId].recentUrls,
      );
    });

    it("persists after removeRecentUrl", () => {
      const action = removeRecentUrl(workspaceId, "https://a.com");
      middleware(mockApi)(mockNext)(action);

      expect(safeLocalStorage.setJSON).toHaveBeenCalledOnce();
    });

    it("persists after clearRecentUrls", () => {
      const action = clearRecentUrls(workspaceId);
      middleware(mockApi)(mockNext)(action);

      expect(safeLocalStorage.setJSON).toHaveBeenCalledOnce();
    });

    it("does not persist for non-workspace actions", () => {
      const action = { type: "some/otherAction", payload: [workspaceId] };
      middleware(mockApi)(mockNext)(action);

      expect(safeLocalStorage.setJSON).not.toHaveBeenCalled();
    });
  });
});
