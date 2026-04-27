import { describe, expect, it, beforeEach, vi } from "vitest";
import { expectSaga, testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
}));

const { eventChannelMock } = vi.hoisted(() => ({
  eventChannelMock: vi.fn(),
}));

vi.mock("redux-saga", async () => {
  const actual = await vi.importActual<typeof import("redux-saga")>("redux-saga");
  return {
    ...actual,
    eventChannel: eventChannelMock,
  };
});

import { clearActiveWorkspace } from "$lib/store/slices/workspace/workspace-slice";
import {
  clearPendingDeepLinkAction,
  requestHomePageInitializer,
} from "../deep-links-slice";
import { initialState } from "../deep-links-slice";
import {
  deepLinksSaga,
  handleDeepLinkCreate,
  handleLocationChange,
  loadInitialPendingDeepLinkSaga,
  watchDeepLinkCreateSaga,
  watchDeepLinkIpcSaga,
  watchLocationSaga,
} from "./deep-links-saga";

function createMockChannel() {
  return {
    take: vi.fn(),
    close: vi.fn(),
  } as any;
}

describe("deepLinksSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.stubGlobal("window", {
      location: {
        pathname: "/",
        href: "http://localhost/",
      },
      history: {
        state: null,
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis);
  });

  it("forks the deep-link watchers after loading any initial pending action", () => {
    testSaga(deepLinksSaga)
      .next()
      .call(loadInitialPendingDeepLinkSaga)
      .next()
      .fork(watchDeepLinkIpcSaga)
      .next()
      .fork(watchLocationSaga)
      .next()
      .fork(watchDeepLinkCreateSaga)
      .next()
      .isDone();
  });

  it("handles create=true on the home route", async () => {
    await expectSaga(handleLocationChange, {
      pathname: "/",
      href: "http://localhost/?create=true",
    })
      .put(clearActiveWorkspace())
      .put(requestHomePageInitializer({ focus: true }))
      .run();

    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("handles deepLink query params on the home route", async () => {
    const deepLink = encodeURIComponent(
      JSON.stringify({
        type: "create",
        params: { repo: "/repo/intent", branch: "develop" },
      })
    );

    await expectSaga(handleLocationChange, {
      pathname: "/",
      href: `http://localhost/?deepLink=${deepLink}`,
    })
      .put(clearActiveWorkspace())
      .put(requestHomePageInitializer({ applyPrefill: true }))
      .run();

    expect(sessionStorage.getItem("workspace-prefill")).toBe(
      JSON.stringify({ repoPath: "/repo/intent", branch: "develop", prompt: "", specialist: "", githubUrl: "", title: "", autoCreate: "" })
    );
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("handles deep-link create events by dispatching Redux actions", async () => {
    await expectSaga(handleDeepLinkCreate, {
      params: { repo: "/repo/intent" },
    })
      .put(requestHomePageInitializer({ applyPrefill: true }))
      .put(clearPendingDeepLinkAction())
      .run();

    expect(sessionStorage.getItem("workspace-prefill")).toBe(
      JSON.stringify({ repoPath: "/repo/intent", branch: "main", prompt: "", specialist: "", githubUrl: "", title: "", autoCreate: "" })
    );
  });

  it("replays a pending create action on startup when state has one", async () => {
    const stateWithPending = {
      deepLinks: {
        ...initialState,
        pendingAction: {
          type: "create" as const,
          params: { repo: "/repo/intent" },
        },
      },
    };

    await expectSaga(loadInitialPendingDeepLinkSaga)
      .withState(stateWithPending)
      .put(requestHomePageInitializer({ applyPrefill: true }))
      .put(clearPendingDeepLinkAction())
      .run();
  });

  it("does nothing on startup when no pending action", async () => {
    const stateEmpty = {
      deepLinks: initialState,
    };

    await expectSaga(loadInitialPendingDeepLinkSaga)
      .withState(stateEmpty)
      .not.put(requestHomePageInitializer({ applyPrefill: true }))
      .silentRun(0);
  });

  it("takes renderer deep-link create events from the window channel", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDeepLinkCreateSaga();
    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });
  });
});