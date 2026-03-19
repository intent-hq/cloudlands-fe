import { describe, expect, it } from "vitest";
import { createCollection } from "$lib/store/utils/collection-utils";
import type { StoreState } from "../../types";
import type { InstalledEditor } from "./external-editors-slice";
import {
  selectInstalledEditors,
  selectInstalledEditorsByCategory,
  selectInstalledEditorsCollection,
  selectInstalledEditorsFiltered,
  selectInstalledIdes,
  selectInstalledTerminals,
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

  it("returns the raw editors collection", () => {
    const state = mockState();

    expect(selectInstalledEditorsCollection.select(state)).toEqual(
      state.externalEditors.editors
    );
  });

  it("returns installed editors as an array", () => {
    const state = mockState();

    expect(selectInstalledEditors.select(state)).toEqual(mockEditors);
  });

  it("filters editors by category while keeping array output", () => {
    const state = mockState();

    expect(selectInstalledEditorsByCategory.select(state, "ide")).toEqual([
      mockEditors[0],
    ]);
    expect(selectInstalledIdes.select(state)).toEqual([mockEditors[0]]);
    expect(selectInstalledTerminals.select(state)).toEqual([mockEditors[1]]);
  });

  it("filters to installed editors only", () => {
    const state = mockState();

    expect(selectInstalledEditorsFiltered.select(state)).toEqual(
      mockEditors.slice(0, 2)
    );
  });

  it("returns the last fetched timestamp", () => {
    const state = mockState();
    expect(selectLastFetched.select(state)).toBe(123);
  });
});