import type { KnownRepo } from "$shared/types/known-repo";
import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "../../utils/collection-utils";
import { initialState } from "./known-repos-slice";
import {
  selectKnownRepos,
  selectKnownReposCollection,
  selectKnownReposLoaded,
} from "./known-repos-selectors";

const mockRepo: KnownRepo = {
  path: "/repo/intent",
  name: "intent",
  owner: "augmentcode",
  addedAt: "2026-03-18T00:00:00.000Z",
  lastUsedAt: "2026-03-18T00:00:00.000Z",
};

function mockState(overrides = {}): StoreState {
  return {
    knownRepos: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe("known-repos selectors", () => {
  it("returns the known repos collection", () => {
    const repos = createCollection<KnownRepo, "path">("path", [mockRepo]);

    expect(selectKnownReposCollection.select(mockState({ repos }))).toEqual(repos);
  });

  it("returns the known repos list", () => {
    expect(
      selectKnownRepos.select(
        mockState({ repos: createCollection<KnownRepo, "path">("path", [mockRepo]) })
      )
    ).toEqual([mockRepo]);
  });

  it("returns whether known repos have been loaded", () => {
    expect(selectKnownReposLoaded.select(mockState({ loaded: false }))).toBe(false);
    expect(selectKnownReposLoaded.select(mockState({ loaded: true }))).toBe(true);
  });
});