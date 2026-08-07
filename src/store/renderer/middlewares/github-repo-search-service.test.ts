import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE seam: the github-auth IPC client is stubbed so no daemon/IPC call happens.
// The search middleware is registered in the REAL configured store, so dispatching
// `searchGithubRepos` exercises the debounce, latest-wins, stale-response guard,
// and store convergence end to end.
vi.mock("$features/github-auth/renderer/github-auth.client", () => ({
  githubAuthClient: {
    listRepos: vi.fn(() => Promise.resolve([])),
    searchRepos: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  },
}));

import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import { store as appStore } from "$store/renderer/store";
import {
  clearGithubRepoSearch,
  searchGithubRepos,
} from "$store/renderer/slices/github-repo-search/github-repo-search-slice";
import { SEARCH_DEBOUNCE_MS } from "./github-repo-search-service";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";

type Fn = ReturnType<typeof vi.fn>;
const searchApi = githubAuthClient as unknown as { searchRepos: Fn };

const wireRepo = (owner: string, name: string) => ({
  owner,
  name,
  default_branch: "main",
});

const item = (owner: string, name: string) => ({
  id: `${owner}/${name}`,
  owner,
  name,
  defaultBranch: "main",
});

/** Successful seam envelope, matching `githubAuthClient.searchRepos`'s contract. */
const ok = (...repos: ReturnType<typeof wireRepo>[]) => ({ success: true, data: repos });

/** Resolve the microtask queue so fire-and-forget dispatches land. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("githubRepoSearchService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    vi.useFakeTimers();
    appStore.dispatch(clearGithubRepoSearch());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("debounces the search and coalesces rapid keystrokes into one call", async () => {
    appStore.dispatch(searchGithubRepos("sv"));
    appStore.dispatch(searchGithubRepos("sve"));
    appStore.dispatch(searchGithubRepos("svelte"));

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(searchApi.searchRepos).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(searchApi.searchRepos).toHaveBeenCalledTimes(1);
    expect(searchApi.searchRepos).toHaveBeenCalledWith("svelte");
  });

  it("stores the mapped results for the searched query", async () => {
    searchApi.searchRepos.mockResolvedValueOnce(
      ok(wireRepo("sveltejs", "svelte"), wireRepo("sveltejs", "kit")) as never,
    );

    appStore.dispatch(searchGithubRepos("  svelte  "));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();

    // The trimmed query is what reaches the wire and the slice.
    expect(searchApi.searchRepos).toHaveBeenCalledWith("svelte");
    expect(appStore.state.githubRepoSearch.lastQuery).toBe("svelte");
    expect(appStore.state.githubRepoSearch.loading).toBe(false);
    expect(appStore.state.githubRepoSearch.error).toBeNull();
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([
      item("sveltejs", "svelte"),
      item("sveltejs", "kit"),
    ]);
  });

  // The seam converts a daemon/IPC failure into `{ success: false, error }` rather
  // than throwing, so the unsuccessful envelope — not a rejection — is the real
  // failure path the middleware must surface.
  it("surfaces an unsuccessful search envelope via setGithubRepoSearchError", async () => {
    searchApi.searchRepos.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    } as never);

    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();

    expect(appStore.state.githubRepoSearch.error).toBe("rate limited");
    expect(appStore.state.githubRepoSearch.loading).toBe(false);
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([]);
  });

  it("falls back to a generic message when the failed envelope carries none", async () => {
    searchApi.searchRepos.mockResolvedValueOnce({ success: false } as never);

    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();

    expect(appStore.state.githubRepoSearch.error).toBe("Unknown error");
    expect(appStore.state.githubRepoSearch.loading).toBe(false);
  });

  it("clears the slice on an empty query without hitting the wire", async () => {
    searchApi.searchRepos.mockResolvedValueOnce(ok(wireRepo("sveltejs", "svelte")) as never);
    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    expect(getItems(appStore.state.githubRepoSearch.results)).toHaveLength(1);

    vi.clearAllMocks();
    appStore.dispatch(searchGithubRepos("   "));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();

    expect(searchApi.searchRepos).not.toHaveBeenCalled();
    expect(appStore.state.githubRepoSearch.lastQuery).toBe("");
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([]);
  });

  it("drops a stale response so it cannot clobber newer results", async () => {
    let resolveSlow: (envelope: unknown) => void = () => {};
    searchApi.searchRepos
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSlow = resolve as (e: unknown) => void)),
      )
      .mockResolvedValueOnce(ok(wireRepo("rich-harris", "degit")) as never);

    // First query goes in flight, then a second query supersedes it.
    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    appStore.dispatch(searchGithubRepos("degit"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();

    expect(appStore.state.githubRepoSearch.lastQuery).toBe("degit");
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([
      item("rich-harris", "degit"),
    ]);

    // The slow first search now settles — its results must be ignored.
    resolveSlow(ok(wireRepo("sveltejs", "svelte")));
    await flush();

    expect(appStore.state.githubRepoSearch.lastQuery).toBe("degit");
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([
      item("rich-harris", "degit"),
    ]);
  });

  // The guard is token-based, not query-based: two searches for the SAME string
  // (e.g. type "svelte", clear to "sv", type "svelte" again) must still order by
  // recency, so the older response cannot overwrite the newer one.
  it("drops a stale response for a repeated identical query", async () => {
    let resolveFirst: (envelope: unknown) => void = () => {};
    searchApi.searchRepos
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve as (e: unknown) => void)),
      )
      .mockResolvedValueOnce(ok(wireRepo("sveltejs", "kit")) as never);

    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

    // Same query dispatched again while the first request is still in flight.
    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();

    expect(searchApi.searchRepos).toHaveBeenCalledTimes(2);
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([item("sveltejs", "kit")]);

    resolveFirst(ok(wireRepo("sveltejs", "svelte")));
    await flush();

    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([item("sveltejs", "kit")]);
  });

  // Clearing must also invalidate an in-flight request, otherwise its response
  // repopulates the slice after the user emptied the input.
  it("drops an in-flight response that settles after the slice was cleared", async () => {
    let resolveSlow: (envelope: unknown) => void = () => {};
    searchApi.searchRepos.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve as (e: unknown) => void)),
    );

    appStore.dispatch(searchGithubRepos("svelte"));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(appStore.state.githubRepoSearch.loading).toBe(true);

    appStore.dispatch(searchGithubRepos(""));
    await flush();
    expect(appStore.state.githubRepoSearch.lastQuery).toBe("");

    resolveSlow(ok(wireRepo("sveltejs", "svelte")));
    await flush();

    expect(appStore.state.githubRepoSearch.lastQuery).toBe("");
    expect(appStore.state.githubRepoSearch.loading).toBe(false);
    expect(getItems(appStore.state.githubRepoSearch.results)).toEqual([]);
  });
});
