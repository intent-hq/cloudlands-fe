import {
  describe,
  expect,
  it,
} from "vitest";
import {
  createCollection,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { GithubRepoItem } from "../github-repos/github-repos-slice";
import {
  clearGithubRepoSearch,
  githubRepoSearchReducer,
  initialState,
  setGithubRepoSearchError,
  setGithubRepoSearchLoading,
  setGithubRepoSearchResults,
} from "./github-repo-search-slice";

const mockRepo = (owner: string, name: string): GithubRepoItem => ({
  id: `${owner}/${name}`,
  owner,
  name,
  defaultBranch: "main",
});

describe("githubRepoSearchReducer", () => {
  it("returns the initial state", () => {
    expect(githubRepoSearchReducer(undefined, { type: "@@INIT" })).toEqual(
      initialState,
    );
  });

  it("records the active query and flips loading while searching", () => {
    const previous = {
      ...initialState,
      error: "stale error",
    };

    const next = githubRepoSearchReducer(
      previous,
      setGithubRepoSearchLoading("svelte"),
    );

    expect(next).toEqual({
      ...previous,
      loading: true,
      error: null,
      lastQuery: "svelte",
    });
  });

  it("stores results as a Collection keyed by owner/name", () => {
    const loading = {
      ...initialState,
      loading: true,
      lastQuery: "svelte",
    };

    const repos = [
      mockRepo("sveltejs", "svelte"),
      mockRepo("sveltejs", "kit"),
    ];

    const next = githubRepoSearchReducer(
      loading,
      setGithubRepoSearchResults("svelte", repos),
    );

    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.lastQuery).toBe("svelte");
    expect(getItems(next.results)).toEqual(repos);
  });

  it("records an error, clears loading, and drops previous results", () => {
    const populated = {
      ...initialState,
      results: createCollection<GithubRepoItem, "id">("id", [
        mockRepo("sveltejs", "svelte"),
      ]),
      loading: true,
      lastQuery: "svelte",
    };

    const next = githubRepoSearchReducer(
      populated,
      setGithubRepoSearchError("svelte", "rate limited"),
    );

    expect(next.loading).toBe(false);
    expect(next.error).toBe("rate limited");
    expect(next.lastQuery).toBe("svelte");
    expect(getItems(next.results)).toEqual([]);
  });

  it("resets to initial state on clear", () => {
    const populated = {
      results: createCollection<GithubRepoItem, "id">("id", [
        mockRepo("sveltejs", "svelte"),
      ]),
      loading: false,
      error: null,
      lastQuery: "svelte",
    };

    expect(githubRepoSearchReducer(populated, clearGithubRepoSearch())).toEqual(
      initialState,
    );
  });
});
