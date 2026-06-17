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
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("@augmentcode/ag-redux-toolkit/utils/sagas/selector-channel-effects", () => ({
  takeLatestFromSelector: vi.fn(function* (_selector: any, _worker: any) {
    void _selector;
    void _worker;
    // test-only stub: yields a marker so the root-saga test can verify wiring
    yield sagaEffects.call(() => undefined);
  }),
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "$lib/electron-bridge";
import { GITHUB_AUTH_CHANNELS } from "$features/github-auth/constants";
import { selectGitHubAuthIsAuthenticated } from "../../github-auth/github-auth-selectors";
import {
  clearGithubRepos,
  loadGithubRepos,
  setGithubRepos,
  setGithubReposError,
  setGithubReposLoading,
  type GithubRepoItem,
} from "../github-repos-slice";
import {
  githubReposSaga,
  loadGithubReposSaga,
} from "./github-repos-saga";

const normalized: GithubRepoItem[] = [
  {
    id: "augmentcode/intent",
    owner: "augmentcode",
    name: "intent",
    defaultBranch: "main",
  },
];

const raw = [
  {
    owner: "augmentcode",
    name: "intent",
    default_branch: "main",
  },
];

describe("loadGithubReposSaga", () => {
  it("flips loading, fetches repos via IPC, and stores the normalized list", () => {
    const iterator = loadGithubReposSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.select(selectGitHubAuthIsAuthenticated.select),
      done: false,
    });

    expect(iterator.next(true)).toEqual({
      value: sagaEffects.put(setGithubReposLoading()),
      done: false,
    });

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(invoke, GITHUB_AUTH_CHANNELS.LIST_REPOS, {
        page: undefined,
      }),
      done: false,
    });

    expect(iterator.next({ success: true, data: raw })).toEqual({
      value: sagaEffects.select(selectGitHubAuthIsAuthenticated.select),
      done: false,
    });

    expect(iterator.next(true)).toEqual({
      value: sagaEffects.put(setGithubRepos(normalized)),
      done: false,
    });

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("surfaces the server error message when the response is unsuccessful", () => {
    const iterator = loadGithubReposSaga();

    iterator.next(); // select authenticated
    iterator.next(true); // setGithubReposLoading
    iterator.next(); // invoke

    expect(iterator.next({ success: false, error: "rate limited" })).toEqual({
      value: sagaEffects.put(setGithubReposError("rate limited")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("falls back to a generic error when the response has no data and no error", () => {
    const iterator = loadGithubReposSaga();

    iterator.next();
    iterator.next(true);
    iterator.next();

    expect(iterator.next({ success: false })).toEqual({
      value: sagaEffects.put(
        setGithubReposError("Failed to load repositories"),
      ),
      done: false,
    });
  });

  it("handles thrown IPC errors by dispatching a friendly error", () => {
    const iterator = loadGithubReposSaga();

    iterator.next();
    iterator.next(true);
    iterator.next();

    expect(iterator.throw(new Error("boom"))).toEqual({
      value: sagaEffects.put(setGithubReposError("boom")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("does not populate repos when auth flips false while the IPC call is in flight", () => {
    const iterator = loadGithubReposSaga();

    iterator.next(); // select authenticated
    iterator.next(true); // setGithubReposLoading
    iterator.next(); // invoke

    expect(iterator.next({ success: true, data: raw })).toEqual({
      value: sagaEffects.select(selectGitHubAuthIsAuthenticated.select),
      done: false,
    });
    expect(iterator.next(false)).toEqual({
      value: sagaEffects.put(clearGithubRepos()),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});

describe("githubReposSaga", () => {
  it("wires takeLatest(loadGithubRepos) and a selector channel for auth", () => {
    const iterator = githubReposSaga();

    const first = iterator.next().value as any;
    expect(first.type).toBe("FORK");
    expect(first.payload.args?.[0]).toBe(loadGithubRepos);
    expect(first.payload.args?.[1]).toBe(loadGithubReposSaga);

    // Second effect is the takeLatestFromSelector stub — presence is enough
    const second = iterator.next().value;
    expect(second).toBeDefined();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});
