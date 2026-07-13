import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContextItem } from "$features/context/types";

// FAKE seam: `appClient.workspaces.updateContext` is stubbed. The mutation
// middleware runs against the REAL configured store so we exercise the
// reducer → middleware → wire-call chain end to end.
const { updateContext } = vi.hoisted(() => ({
  updateContext: vi.fn(() => Promise.resolve([])),
}));
vi.mock("$lib/client", () => ({
  appClient: { workspaces: { updateContext } },
}));

import { store as appStore } from "$store/renderer/store";
import {
  addContextItem,
  hydrateContextItems,
  removeContextItem,
  updateContextItem,
} from "$store/renderer/slices/context/context-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const noteItem = (id: string): ContextItem => ({
  id,
  type: "note",
  title: id,
  provider: "internal",
  noteId: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("contextMutationService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("addContextItem forwards the new items list to workspace.updateContext", async () => {
    const ws = "ws-ctx-add";
    appStore.dispatch(addContextItem(ws, noteItem("n1")));
    await flush();

    expect(updateContext).toHaveBeenCalledWith(ws, [noteItem("n1")]);
  });

  it("removeContextItem forwards the trimmed items list", async () => {
    const ws = "ws-ctx-remove";
    appStore.dispatch(hydrateContextItems(ws, [noteItem("n1"), noteItem("n2")]));
    updateContext.mockClear();

    appStore.dispatch(removeContextItem(ws, "n1"));
    await flush();

    expect(updateContext).toHaveBeenCalledWith(ws, [noteItem("n2")]);
  });

  it("updateContextItem forwards the mutated items list", async () => {
    const ws = "ws-ctx-update";
    appStore.dispatch(hydrateContextItems(ws, [noteItem("n1")]));
    updateContext.mockClear();

    appStore.dispatch(updateContextItem(ws, "n1", { title: "renamed" }));
    await flush();

    expect(updateContext).toHaveBeenCalledWith(
      ws,
      expect.arrayContaining([expect.objectContaining({ id: "n1", title: "renamed" })]),
    );
  });

  it("does NOT forward hydrateContextItems (daemon-authoritative apply)", async () => {
    const ws = "ws-ctx-hydrate";
    appStore.dispatch(hydrateContextItems(ws, [noteItem("n1")]));
    await flush();

    expect(updateContext).not.toHaveBeenCalled();
  });

  it("coalesces a burst of mutations into a trailing update call", async () => {
    const ws = "ws-ctx-coalesce";
    // Stall the first call so the second dispatch collapses into a trailing sync.
    let resolveFirst: (v: ContextItem[]) => void = () => {};
    updateContext.mockImplementationOnce(
      () => new Promise<ContextItem[]>((r) => (resolveFirst = r)),
    );

    appStore.dispatch(addContextItem(ws, noteItem("a")));
    appStore.dispatch(addContextItem(ws, noteItem("b")));
    appStore.dispatch(addContextItem(ws, noteItem("c")));
    await flush();

    expect(updateContext).toHaveBeenCalledTimes(1);
    resolveFirst([]);
    await flush();
    await flush();

    // The trailing sync fires with the final items list.
    expect(updateContext).toHaveBeenCalledTimes(2);
    const lastCall = updateContext.mock.calls[updateContext.mock.calls.length - 1];
    expect(lastCall?.[1]).toEqual([noteItem("a"), noteItem("b"), noteItem("c")]);
  });
});
