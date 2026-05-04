import { describe, expect, it } from "vitest";
import {
  closePalette,
  hydratePaletteFileMru,
  hydratePaletteMruEntries,
  initialState,
  openGoToLine,
  openPalette,
  paletteReducer,
  recordPaletteFileMru,
  recordPaletteMruItem,
  togglePalette,
} from "./palette-slice";
import { getPaletteMruEntries } from "./palette-normalization";

describe("paletteReducer", () => {
  it("returns the initial state", () => {
    expect(paletteReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("updates open and query state", () => {
    expect(paletteReducer(initialState, openPalette())).toMatchObject({ isOpen: true, query: "" });
    expect(paletteReducer({ ...initialState, isOpen: true, query: "abc" }, closePalette())).toMatchObject({
      isOpen: false,
      query: "",
    });
    expect(paletteReducer(initialState, openGoToLine())).toMatchObject({ isOpen: true, query: ":" });
    expect(paletteReducer(initialState, togglePalette()).isOpen).toBe(true);
  });

  it("hydrates, records, deduplicates, and caps workspace-object MRU entries", () => {
    let state = paletteReducer(
      initialState,
      hydratePaletteMruEntries([
        { type: "note", id: "old", timestamp: 1 },
        { type: "note", id: "newer", timestamp: 3 },
        { type: "note", id: "old", timestamp: 2 },
      ])
    );

    expect(state.mruEntryIds).toEqual(["note:newer", "note:old"]);
    expect(state.mruEntriesByKey).toEqual({
      "note:newer": { type: "note", id: "newer", timestamp: 3 },
      "note:old": { type: "note", id: "old", timestamp: 2 },
    });
    expect(getPaletteMruEntries(state)).toEqual([
      { type: "note", id: "newer", timestamp: 3 },
      { type: "note", id: "old", timestamp: 2 },
    ]);

    for (let index = 0; index < 55; index += 1) {
      state = paletteReducer(state, recordPaletteMruItem("note", `note-${index}`, index));
    }
    state = paletteReducer(state, recordPaletteMruItem("note", "note-10", 100));

    const entries = getPaletteMruEntries(state);
    expect(state.mruEntryIds).toHaveLength(50);
    expect(entries[0]).toEqual({ type: "note", id: "note-10", timestamp: 100 });
    expect(entries.filter((entry) => entry.id === "note-10")).toHaveLength(1);
  });

  it("hydrates and caps file MRU entries", () => {
    let state = paletteReducer(initialState, hydratePaletteFileMru({ "/a": 1, "": 2, "/bad": Number.NaN }));

    expect(state.fileMru).toEqual({ "/a": 1 });

    for (let index = 0; index < 205; index += 1) {
      state = paletteReducer(state, recordPaletteFileMru(`/file-${index}`, index));
    }

    expect(state.fileMru["/file-204"]).toBe(204);
    expect(state.fileMru["/a"]).toBeUndefined();
    expect(Object.keys(state.fileMru)).toHaveLength(200);
  });
});
