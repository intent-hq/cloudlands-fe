import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// REAL store: the ui-layout persistence middleware is already registered in the
// configured store, so dispatching each restored trigger exercises the wiring,
// localStorage read/write, and store convergence end to end. `test-setup.ts`
// replaces `window.localStorage` with inert vi.fn() stubs, so back them with an
// in-memory Map here to make persistence observable; keys are unique per test
// and the Map is cleared after each.
import { store as appStore } from "$store/renderer/store";
import { safeLocalStorage } from "$lib/utils/safe-storage";

const mem = new Map<string, string>();
function installMemoryLocalStorage(): void {
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (key: string) => mem.get(key) ?? null
  );
  vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
    mem.set(key, String(value));
  });
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
}
import {
  requestCollapsiblePanelCollapsed,
  requestResizablePanelGroupLayout,
  requestResizablePanelSize,
  setCollapsiblePanelCollapsed,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
  type ResizablePanelGroupLayoutState,
} from "$store/renderer/slices/ui-layout/ui-layout-slice";

describe("uiLayoutPersistenceService (real store)", () => {
  beforeAll(() => {
    installMemoryLocalStorage();
    appStore.init();
  });
  afterEach(() => mem.clear());

  it("persists resizable panel size on set* (dynamic key === storage key)", () => {
    appStore.dispatch(setResizablePanelSize("panel:size:a", 42));
    expect(safeLocalStorage.getItem("panel:size:a")).toBe("42");
  });

  it("hydrates resizable panel size from localStorage on request*", () => {
    safeLocalStorage.setItem("panel:size:b", "73");
    appStore.dispatch(requestResizablePanelSize("panel:size:b"));
    expect(appStore.state.uiLayout.resizablePanelSizes["panel:size:b"]).toBe(73);
  });

  it("leaves state untouched when request* finds nothing stored", () => {
    appStore.dispatch(requestResizablePanelSize("panel:size:missing"));
    expect(
      appStore.state.uiLayout.resizablePanelSizes["panel:size:missing"]
    ).toBeUndefined();
  });

  it("ignores a non-numeric stored panel size", () => {
    safeLocalStorage.setItem("panel:size:bad", "not-a-number");
    appStore.dispatch(requestResizablePanelSize("panel:size:bad"));
    expect(
      appStore.state.uiLayout.resizablePanelSizes["panel:size:bad"]
    ).toBeUndefined();
  });

  it("persists + hydrates a resizable panel group layout as JSON", () => {
    const layout: ResizablePanelGroupLayoutState = {
      sizes: [30, 70],
      collapsed: ["left"],
    };
    appStore.dispatch(setResizablePanelGroupLayout("group:c", layout));
    expect(safeLocalStorage.getJSON("group:c")).toEqual(layout);

    safeLocalStorage.setJSON("group:d", layout);
    appStore.dispatch(requestResizablePanelGroupLayout("group:d"));
    expect(
      appStore.state.uiLayout.resizablePanelGroupLayouts["group:d"]
    ).toEqual(layout);
  });

  it("ignores a malformed stored group layout", () => {
    safeLocalStorage.setJSON("group:bad", { sizes: "nope" });
    appStore.dispatch(requestResizablePanelGroupLayout("group:bad"));
    expect(
      appStore.state.uiLayout.resizablePanelGroupLayouts["group:bad"]
    ).toBeUndefined();
  });

  it("persists + hydrates collapsible panel collapsed as a boolean string", () => {
    appStore.dispatch(setCollapsiblePanelCollapsed("collapse:e", true));
    expect(safeLocalStorage.getItem("collapse:e")).toBe("true");

    safeLocalStorage.setItem("collapse:f", "false");
    appStore.dispatch(requestCollapsiblePanelCollapsed("collapse:f"));
    expect(
      appStore.state.uiLayout.collapsiblePanelCollapsed["collapse:f"]
    ).toBe(false);
  });

  it("ignores a non-boolean stored collapsed value", () => {
    safeLocalStorage.setItem("collapse:bad", "maybe");
    appStore.dispatch(requestCollapsiblePanelCollapsed("collapse:bad"));
    expect(
      appStore.state.uiLayout.collapsiblePanelCollapsed["collapse:bad"]
    ).toBeUndefined();
  });
});
