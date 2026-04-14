import { describe, expect, it } from "vitest";
import { createCollection } from "../../utils/collection-utils";
import {
  clearGithubRepos,
  githubReposReducer,
  initialState,
  setGithubRepos,
  setGithubReposError,
  setGithubReposLoading,
  type GithubRepoItem,
} from "./github-repos-slice";

const mockRepo = (owner: string, name: string): GithubRepoItem => ({
  id: `${owner}/${name}`,
  owner,
  name,
  defaultBranch: "main",
});

describe("githubReposReducer", () => {
  it("returns the initial state", () => {
    expect(githubReposReducer(undefined, { type: "@@INIT" })).toEqual(
      initialState,
    );
  });

  it("sets loading flag and clears a previous error", () => {
    const previous = {
      ...initialState,
      error: "previous failure",
    };

    expect(githubReposReducer(previous, setGithubReposLoading())).toEqual({
      ...previous,
      loading: true,
      error: null,
    });
  });

  it("stores fetched repos as a Collection and marks the slice loaded", () => {
    const repos = [
      mockRepo("augmentcode", "intent"),
      mockRepo("augmentcode", "augment"),
    ];

    const loading = {
      ...initialState,
      loading: true,
    };

    expect(githubReposReducer(loading, setGithubRepos(repos))).toEqual({
      repos: createCollection<GithubRepoItem, "id">("id", repos),
      loading: false,
      loaded: true,
      error: null,
    });
  });

  it("records an error and clears loading", () => {
    const loading = { ...initialState, loading: true };

    expect(githubReposReducer(loading, setGithubReposError("boom"))).toEqual({
      ...initialState,
      loading: false,
      error: "boom",
    });
  });

  it("resets to initial state on clear", () => {
    const populated = {
      repos: createCollection<GithubRepoItem, "id">("id", [
        mockRepo("augmentcode", "intent"),
      ]),
      loading: false,
      loaded: true,
      error: null,
    };

    expect(githubReposReducer(populated, clearGithubRepos())).toEqual(
      initialState,
    );
  });
});
