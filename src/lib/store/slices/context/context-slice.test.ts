import {
  describe,
  it,
  expect,
} from "vitest";
import {
  getItem,
  getItems,
} from "../../utils/collection-utils";
import {
  contextReducer,
  initialState,
  emptyWorkspaceContextState,
  hydrateContextItems,
  addContextItem,
  removeContextItem,
  updateContextItem,
  getWorkspaceState,
} from "./context-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { ContextItem } from "$features/context/types";

const reduce = contextReducer;

const makeContextItem = (overrides: Partial<ContextItem> = {}): ContextItem =>
  ({
    id: "item-1",
    type: "note",
    title: "Test Note",
    provider: "internal",
    noteId: "note-1",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  }) as ContextItem;

describe("contextReducer", () => {
  it("should return initial state", () => {
    const state = reduce(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("hydrateContextItems", () => {
    it("should hydrate items for a workspace", () => {
      const items = [makeContextItem({ id: "a" }), makeContextItem({ id: "b" })];
      const state = reduce(initialState, hydrateContextItems("ws-1", items));
      const ws = getWorkspaceState(state, "ws-1");
      expect(getItems(ws.items)).toHaveLength(2);
      expect(ws.loading).toBe(false);
      expect(ws.error).toBeNull();
    });

    it("should replace existing items on re-hydrate", () => {
      const items1 = [makeContextItem({ id: "a" })];
      const items2 = [makeContextItem({ id: "b" }), makeContextItem({ id: "c" })];
      let state = reduce(initialState, hydrateContextItems("ws-1", items1));
      state = reduce(state, hydrateContextItems("ws-1", items2));
      const ws = getWorkspaceState(state, "ws-1");
      expect(getItems(ws.items)).toHaveLength(2);
      expect(getItem(ws.items, "a")).toBeUndefined();
      expect(getItem(ws.items, "b")).toBeDefined();
    });
  });

  describe("addContextItem", () => {
    it("should add an item to the workspace", () => {
      const item = makeContextItem({ id: "item-1" });
      const state = reduce(initialState, addContextItem("ws-1", item));
      const ws = getWorkspaceState(state, "ws-1");
      expect(getItems(ws.items)).toHaveLength(1);
      expect(getItem(ws.items, "item-1")).toEqual(item);
    });

    it("should append to existing items", () => {
      let state = reduce(initialState, addContextItem("ws-1", makeContextItem({ id: "a" })));
      state = reduce(state, addContextItem("ws-1", makeContextItem({ id: "b" })));
      expect(getItems(getWorkspaceState(state, "ws-1").items)).toHaveLength(2);
    });
  });

  describe("removeContextItem", () => {
    it("should remove an item by ID", () => {
      let state = reduce(initialState, addContextItem("ws-1", makeContextItem({ id: "a" })));
      state = reduce(state, addContextItem("ws-1", makeContextItem({ id: "b" })));
      state = reduce(state, removeContextItem("ws-1", "a"));
      const ws = getWorkspaceState(state, "ws-1");
      expect(getItems(ws.items)).toHaveLength(1);
      expect(getItem(ws.items, "a")).toBeUndefined();
      expect(getItem(ws.items, "b")).toBeDefined();
    });
  });

  describe("updateContextItem", () => {
    it("should partially update a context item", () => {
      const item = makeContextItem({ id: "item-1", title: "Old Title" });
      let state = reduce(initialState, addContextItem("ws-1", item));
      state = reduce(state, updateContextItem("ws-1", "item-1", { title: "New Title" }));
      const updated = getItem(getWorkspaceState(state, "ws-1").items, "item-1");
      expect(updated?.title).toBe("New Title");
      expect(updated?.id).toBe("item-1");
    });
  });

  it("should isolate workspaces", () => {
    let state = reduce(initialState, addContextItem("ws-1", makeContextItem({ id: "a" })));
    state = reduce(state, addContextItem("ws-2", makeContextItem({ id: "b" })));
    expect(getItems(getWorkspaceState(state, "ws-1").items)).toHaveLength(1);
    expect(getItems(getWorkspaceState(state, "ws-2").items)).toHaveLength(1);
  });

  it("should return empty workspace state for unknown workspace", () => {
    expect(getWorkspaceState(initialState, "unknown")).toEqual(emptyWorkspaceContextState);
  });

  it("workspaceUnmounted clears workspace state", () => {
    let state = reduce(initialState, addContextItem("ws-1", makeContextItem({ id: "a" })));
    state = reduce(state, addContextItem("ws-2", makeContextItem({ id: "b" })));

    const nextState = reduce(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});

