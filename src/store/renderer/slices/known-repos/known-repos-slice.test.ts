import type { KnownRepo } from "$shared/types/known-repo";
import {
  describe,
  expect,
  it,
} from "vitest";
import { createCollection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import {
  initialState,
  knownReposReducer,
  removeRepo,
  setRepos,
} from "./known-repos-slice";

const mockRepo = (path: string, name = "intent"): KnownRepo => ({
  path,
  name,
  owner: "augmentcode",
  addedAt: "2026-03-18T00:00:00.000Z",
  lastUsedAt: "2026-03-18T00:00:00.000Z",
});

describe("knownReposReducer", () => {
  it("returns the initial state", () => {
    expect(knownReposReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores fetched repos and marks the slice as loaded", () => {
    const repos = [mockRepo("/repo/intent"), mockRepo("/repo/augment", "augment")];

    expect(knownReposReducer(initialState, setRepos(repos))).toEqual({
      repos: createCollection<KnownRepo, "path">("path", repos),
      loaded: true,
    });
  });

  it("removes a repo by path without mutating other entries", () => {
    const previousState = {
      repos: createCollection<KnownRepo, "path">("path", [
        mockRepo("/repo/intent"),
        mockRepo("/repo/augment", "augment"),
      ]),
      loaded: true,
    };

    expect(knownReposReducer(previousState, removeRepo("/repo/intent"))).toEqual({
      repos: createCollection<KnownRepo, "path">("path", [
        mockRepo("/repo/augment", "augment"),
      ]),
      loaded: true,
    });
  });
});