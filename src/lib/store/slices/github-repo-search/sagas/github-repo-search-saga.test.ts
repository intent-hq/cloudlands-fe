import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  debounce: function* (ms: any, pattern: any, worker: any) {
    return yield sagaEffects.debounce(ms, pattern, worker);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "$lib/electron-bridge";
import { GITHUB_AUTH_CHANNELS } from "$features/github-auth/constants";
import type { GithubRepoItem } from "../../github-repos/github-repos-slice";
import {
  clearGithubRepoSearch,
  searchGithubRepos,
  setGithubRepoSearchError,
  setGithubRepoSearchLoading,
  setGithubRepoSearchResults,
} from "../github-repo-search-slice";
import {
  githubRepoSearchSaga,
  handleSearchGithubRepos,
  SEARCH_DEBOUNCE_MS,
} from "./github-repo-search-saga";

const normalized: GithubRepoItem[] = [
  {
    id: "sveltejs/svelte",
    owner: "sveltejs",
    name: "svelte",
    defaultBranch: "main",
  },
];

const raw = [
  {
    owner: "sveltejs",
    name: "svelte",
    default_branch: "main",
  },
];

describe("handleSearchGithubRepos", () => {
  it("short-circuits empty queries to a clear dispatch (no IPC call)", () => {
    const iterator = handleSearchGithubRepos(searchGithubRepos(""));

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(clearGithubRepoSearch()),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("short-circuits 1-character queries to a clear dispatch", () => {
    const iterator = handleSearchGithubRepos(searchGithubRepos("s"));

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(clearGithubRepoSearch()),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("trims, flips loading, calls IPC, and stores normalized results", () => {
    const iterator = handleSearchGithubRepos(searchGithubRepos("  svelte  "));

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(setGithubRepoSearchLoading("svelte")),
      done: false,
    });

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(invoke, GITHUB_AUTH_CHANNELS.SEARCH_REPOS, {
        query: "svelte",
      }),
      done: false,
    });

    expect(iterator.next({ success: true, data: raw })).toEqual({
      value: sagaEffects.put(setGithubRepoSearchResults("svelte", normalized)),
      done: false,
    });

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("surfaces the server error message when the response is unsuccessful", () => {
    const iterator = handleSearchGithubRepos(searchGithubRepos("svelte"));

    iterator.next(); // loading
    iterator.next(); // call

    expect(iterator.next({ success: false, error: "rate limited" })).toEqual({
      value: sagaEffects.put(
        setGithubRepoSearchError("svelte", "rate limited"),
      ),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("falls back to a generic error when the response has no data and no error", () => {
    const iterator = handleSearchGithubRepos(searchGithubRepos("svelte"));

    iterator.next();
    iterator.next();

    expect(iterator.next({ success: false })).toEqual({
      value: sagaEffects.put(setGithubRepoSearchError("svelte", "Search failed")),
      done: false,
    });
  });

  it("handles thrown IPC errors by dispatching a friendly error", () => {
    const iterator = handleSearchGithubRepos(searchGithubRepos("svelte"));

    iterator.next();
    iterator.next();

    expect(iterator.throw(new Error("boom"))).toEqual({
      value: sagaEffects.put(setGithubRepoSearchError("svelte", "boom")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});

describe("githubRepoSearchSaga", () => {
  it("wires a debounce(300ms) effect against searchGithubRepos", () => {
    const iterator = githubRepoSearchSaga();

    const first = iterator.next().value as any;
    expect(first.type).toBe("FORK");
    expect(first.payload.args?.[0]).toBe(SEARCH_DEBOUNCE_MS);
    expect(first.payload.args?.[1]).toBe(searchGithubRepos.type);
    expect(first.payload.args?.[2]).toBe(handleSearchGithubRepos);

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});
