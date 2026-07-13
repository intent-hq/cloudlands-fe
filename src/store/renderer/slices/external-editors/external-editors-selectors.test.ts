import {
  describe,
  expect,
  it,
} from "vitest";
import { createCollection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { StoreState } from "../../types";
import type { InstalledEditor } from "./external-editors-slice";
import {
  selectInstalledEditors,
  selectInstalledEditorsFiltered,
  selectHiddenEditorIds,
  selectLastFetched,
  selectOpenAction,
} from "./external-editors-selectors";

const mockEditors: InstalledEditor[] = [
  {
    id: "vscode",
    name: "Visual Studio Code",
    shortLabel: "VS Code",
    appName: "Visual Studio Code",
    category: "ide",
    handlerType: "vscode",
    priority: 100,
    installed: true,
  },
  {
    id: "iterm2",
    name: "iTerm2",
    shortLabel: "iTerm",
    appName: "iTerm",
    category: "terminal",
    handlerType: "generic",
    priority: 50,
    installed: true,
  },
  {
    id: "finder",
    name: "Finder",
    shortLabel: "Finder",
    appName: "Finder",
    category: "finder",
    handlerType: "finder",
    priority: 0,
    installed: false,
  },
];

function mockState(editors: InstalledEditor[] = mockEditors): StoreState {
  return {
    externalEditors: {
      selectedAction: "cursor",
      editors: createCollection<InstalledEditor, "id">("id", editors),
      hiddenEditorIds: ["iterm2"],
      loading: false,
      error: null,
      lastFetched: 123,
    },
  } as unknown as StoreState;
}

describe("external-editors selectors", () => {
  it("returns the selected open action", () => {
    const state = mockState();
    expect(selectOpenAction.select(state)).toBe("cursor");
  });

  it("returns installed editors as an array", () => {
    const state = mockState();

    expect(selectInstalledEditors.select(state)).toEqual(mockEditors);
  });

  it("filters to installed editors only", () => {
    const state = mockState();

    expect(selectInstalledEditorsFiltered.select(state)).toEqual([mockEditors[0]]);
  });

  it("returns hidden editor ids", () => {
    const state = mockState();

    expect(selectHiddenEditorIds.select(state)).toEqual(["iterm2"]);
  });

  it("returns the last fetched timestamp", () => {
    const state = mockState();
    expect(selectLastFetched.select(state)).toBe(123);
  });
});