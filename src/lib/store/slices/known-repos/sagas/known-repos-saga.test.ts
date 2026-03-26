import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

import type { KnownRepo } from "$shared/types/known-repo";
import { invoke } from "$lib/electron-bridge";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import {
  loadKnownRepos,
  removeKnownRepo,
  removeRepo,
  setRepos,
} from "../known-repos-slice";
import {
  knownReposSaga,
  loadKnownReposSaga,
  removeKnownRepoSaga,
} from "./known-repos-saga";

const mockRepos: KnownRepo[] = [
  {
    path: "/repo/intent",
    name: "intent",
    owner: "augmentcode",
    addedAt: "2026-03-18T00:00:00.000Z",
    lastUsedAt: "2026-03-18T00:00:00.000Z",
  },
];

describe("knownReposSaga", () => {
  it("watches load and remove actions", () => {
    const iterator = knownReposSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.takeLatest(loadKnownRepos, loadKnownReposSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeLatest(removeKnownRepo, removeKnownRepoSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("loads repos from IPC", () => {
    const iterator = loadKnownReposSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(
        invoke,
        IPC_CHANNELS.WORKSPACE.GET_RECENT_REPOSITORIES,
        {}
      ),
      done: false,
    });
    expect(iterator.next({ success: true, data: mockRepos })).toEqual({
      value: sagaEffects.put(setRepos(mockRepos)),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("marks repos as loaded with an empty list when loading fails", () => {
    const iterator = loadKnownReposSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(
        invoke,
        IPC_CHANNELS.WORKSPACE.GET_RECENT_REPOSITORIES,
        {}
      ),
      done: false,
    });
    expect(iterator.throw(new Error("boom"))).toEqual({
      value: sagaEffects.put(setRepos([])),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("removes a repo from state after IPC confirmation", () => {
    const iterator = removeKnownRepoSaga(removeKnownRepo("/repo/intent"));

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(
        invoke,
        IPC_CHANNELS.WORKSPACE.REMOVE_RECENT_REPOSITORY,
        { repository: "/repo/intent" }
      ),
      done: false,
    });
    expect(iterator.next({ success: true, data: { removed: true } })).toEqual({
      value: sagaEffects.put(removeRepo("/repo/intent")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("swallows removal errors", () => {
    const iterator = removeKnownRepoSaga(removeKnownRepo("/repo/intent"));

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(
        invoke,
        IPC_CHANNELS.WORKSPACE.REMOVE_RECENT_REPOSITORY,
        { repository: "/repo/intent" }
      ),
      done: false,
    });
    expect(iterator.throw(new Error("boom"))).toEqual({ value: undefined, done: true });
  });
});