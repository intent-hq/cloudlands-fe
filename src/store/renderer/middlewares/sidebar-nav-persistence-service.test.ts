import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSidebarNavPersistenceMiddleware } from "./sidebar-nav-persistence-service";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreApi, Dispatch } from "@augmentcode/ag-redux-toolkit/types";
import type { StoreState } from "../types";
import {
  setPinnedWorkspaceIds,
  pinWorkspace,
  unpinWorkspace,
  togglePinWorkspace,
  setAllSpacesViewMode,
  setPanelWidth,
  openPanel,
  closePanel,
  togglePanel,
  closeAll,
  closeHoverCards,
  setCardPinned,
  toggleCardPinned,
  setChiefActiveAgentId,
  setMultiSelectSidebarTabOrder,
  hydrateSidebarNav,
  PINNED_WORKSPACES_KEY,
  VIEW_MODE_KEY,
  PANEL_WIDTH_KEY,
  PANEL_ITEM_KEY,
  CARD_PINNED_KEY,
  CHIEF_ACTIVE_AGENT_ID_KEY,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  initialState as sidebarNavInitialState,
} from "../slices/sidebar-nav/sidebar-nav-slice";

vi.mock("$lib/utils/safe-storage", () => ({
  safeLocalStorage: {
    getItem: vi.fn(),
    getJSON: vi.fn(),
    setJSON: vi.fn(),
  },
}));

describe("sidebar-nav-persistence-service", () => {
  let mockApi: StoreApi;
  let mockNext: Dispatch;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(safeLocalStorage.getItem).mockReturnValue(null);
    dispatchSpy = vi.fn();
    mockApi = {
      dispatch: dispatchSpy,
      getState: () => ({
        sidebarNav: sidebarNavInitialState,
      } as StoreState),
    } as unknown as StoreApi;
    mockNext = vi.fn((action) => action);
  });

  describe("hydration on boot", () => {
    it("dispatches hydrateSidebarNav with stored pinnedWorkspaceIds", () => {
      vi.mocked(safeLocalStorage.getJSON).mockImplementation((key) => {
        if (key === PINNED_WORKSPACES_KEY) return ["ws-1", "ws-2"];
        return undefined;
      });

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).toHaveBeenCalledWith(
        hydrateSidebarNav({ pinnedWorkspaceIds: ["ws-1", "ws-2"] })
      );
    });

    it("dispatches hydrateSidebarNav with all stored fields", () => {
      vi.mocked(safeLocalStorage.getItem).mockImplementation((key) => {
        if (key === VIEW_MODE_KEY) return JSON.stringify("repo");
        return null;
      });
      vi.mocked(safeLocalStorage.getJSON).mockImplementation((key) => {
        if (key === PINNED_WORKSPACES_KEY) return ["ws-1"];
        if (key === PANEL_WIDTH_KEY) return 320;
        if (key === PANEL_ITEM_KEY) return "chief";
        if (key === CARD_PINNED_KEY) return true;
        if (key === CHIEF_ACTIVE_AGENT_ID_KEY) return "agent-123";
        if (key === MULTISELECT_SIDEBAR_TAB_ORDER_KEY) return ["context", "overview"];
        return undefined;
      });

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).toHaveBeenCalledWith(
        hydrateSidebarNav({
          pinnedWorkspaceIds: ["ws-1"],
          allSpacesViewMode: "repo",
          panelWidth: 320,
          panelItem: "chief",
          isCardPinned: true,
          chiefActiveAgentId: "agent-123",
          multiSelectTabOrder: ["context", "overview"],
        })
      );
    });

    it("skips hydration when no valid data is stored", () => {
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue(undefined);

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it("tolerates corrupt JSON by skipping invalid fields", () => {
      vi.mocked(safeLocalStorage.getItem).mockImplementation((key) => {
        if (key === VIEW_MODE_KEY) return JSON.stringify("invalid-mode");
        return null;
      });
      vi.mocked(safeLocalStorage.getJSON).mockImplementation((key) => {
        if (key === PINNED_WORKSPACES_KEY) return "not-an-array";
        if (key === PANEL_WIDTH_KEY) return "not-a-number";
        if (key === CARD_PINNED_KEY) return "not-a-boolean";
        return undefined;
      });

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it("hydrates from a legacy raw-string view mode and migrates it to JSON", () => {
      vi.mocked(safeLocalStorage.getItem).mockImplementation((key) => {
        if (key === VIEW_MODE_KEY) return "repo";
        return null;
      });
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue(undefined);

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).toHaveBeenCalledWith(
        hydrateSidebarNav({ allSpacesViewMode: "repo" })
      );
      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(VIEW_MODE_KEY, "repo");
    });

    it("does not rewrite an already-JSON view mode value", () => {
      vi.mocked(safeLocalStorage.getItem).mockImplementation((key) => {
        if (key === VIEW_MODE_KEY) return JSON.stringify("status");
        return null;
      });
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue(undefined);

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).toHaveBeenCalledWith(
        hydrateSidebarNav({ allSpacesViewMode: "status" })
      );
      expect(safeLocalStorage.setJSON).not.toHaveBeenCalled();
    });

    it("ignores a legacy raw-string value that is not a valid view mode", () => {
      vi.mocked(safeLocalStorage.getItem).mockImplementation((key) => {
        if (key === VIEW_MODE_KEY) return "bogus";
        return null;
      });
      vi.mocked(safeLocalStorage.getJSON).mockReturnValue(undefined);

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(safeLocalStorage.setJSON).not.toHaveBeenCalled();
    });

    it("filters non-string ids from pinnedWorkspaceIds array", () => {
      vi.mocked(safeLocalStorage.getJSON).mockImplementation((key) => {
        if (key === PINNED_WORKSPACES_KEY) return ["ws-1", 123, null, "ws-2"];
        return undefined;
      });

      const middleware = createSidebarNavPersistenceMiddleware();
      middleware(mockApi);

      expect(dispatchSpy).toHaveBeenCalledWith(
        hydrateSidebarNav({ pinnedWorkspaceIds: ["ws-1", "ws-2"] })
      );
    });
  });

  describe("persistence on action", () => {
    it("persists pinnedWorkspaceIds after setPinnedWorkspaceIds", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, pinnedWorkspaceIds: ["ws-1", "ws-2"] },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(setPinnedWorkspaceIds(["ws-1", "ws-2"]));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        PINNED_WORKSPACES_KEY,
        ["ws-1", "ws-2"]
      );
    });

    it("persists pinnedWorkspaceIds after pinWorkspace", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, pinnedWorkspaceIds: ["ws-1"] },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(pinWorkspace("ws-1"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        PINNED_WORKSPACES_KEY,
        ["ws-1"]
      );
    });

    it("persists pinnedWorkspaceIds after unpinWorkspace", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, pinnedWorkspaceIds: [] },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(unpinWorkspace("ws-1"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        PINNED_WORKSPACES_KEY,
        []
      );
    });

    it("persists pinnedWorkspaceIds after togglePinWorkspace", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, pinnedWorkspaceIds: ["ws-1"] },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(togglePinWorkspace("ws-1"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        PINNED_WORKSPACES_KEY,
        ["ws-1"]
      );
    });

    it("persists allSpacesViewMode after setAllSpacesViewMode", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, allSpacesViewMode: "repo" },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(setAllSpacesViewMode("repo"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(VIEW_MODE_KEY, "repo");
    });

    it("persists panelWidth after setPanelWidth", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelWidth: 320 },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(setPanelWidth(320));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_WIDTH_KEY, 320);
    });

    it("persists panelItem after openPanel", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: "chief" },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(openPanel("chief"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, "chief");
    });

    it("persists panelItem after closePanel", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: null },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(closePanel());

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, null);
    });

    it("persists panelItem after togglePanel", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: "chief" },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(togglePanel("chief"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, "chief");
    });

    it("persists isCardPinned after setCardPinned", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, isCardPinned: true },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(setCardPinned(true));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, true);
    });

    it("persists isCardPinned after toggleCardPinned", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, isCardPinned: true },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(toggleCardPinned());

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, true);
    });

    it("persists both panelItem and isCardPinned after closeAll", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: null, isCardPinned: false },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(closeAll(false));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, null);
      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, false);
    });

    it("persists isCardPinned after closeHoverCards", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, isCardPinned: false },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(closeHoverCards());

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, false);
    });

    it("persists both panelItem and isCardPinned after openPanel", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: "workspace-context", isCardPinned: false },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(openPanel("workspace-context"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, "workspace-context");
      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, false);
    });

    it("persists both panelItem and isCardPinned after closePanel", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: null, isCardPinned: false },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(closePanel());

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, null);
      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, false);
    });

    it("persists both panelItem and isCardPinned after togglePanel", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, panelItem: "chief", isCardPinned: false },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(togglePanel("chief"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(PANEL_ITEM_KEY, "chief");
      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(CARD_PINNED_KEY, false);
    });

    it("persists chiefActiveAgentId after setChiefActiveAgentId", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, chiefActiveAgentId: "agent-123" },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(setChiefActiveAgentId("agent-123"));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        CHIEF_ACTIVE_AGENT_ID_KEY,
        "agent-123"
      );
    });

    it("persists multiSelectTabOrder after setMultiSelectSidebarTabOrder", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      const newState = {
        sidebarNav: { ...sidebarNavInitialState, multiSelectTabOrder: ["context", "overview"] },
      } as StoreState;
      mockApi.getState = () => newState;

      chain(setMultiSelectSidebarTabOrder(["context", "overview"]));

      expect(safeLocalStorage.setJSON).toHaveBeenCalledWith(
        MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
        ["context", "overview"]
      );
    });

    it("does not persist on unrelated actions", () => {
      const middleware = createSidebarNavPersistenceMiddleware();
      const chain = middleware(mockApi)(mockNext);

      chain({ type: "unrelated/action" });

      expect(safeLocalStorage.setJSON).not.toHaveBeenCalled();
    });
  });
});

