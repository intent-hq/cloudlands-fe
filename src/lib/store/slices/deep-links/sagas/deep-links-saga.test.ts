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
}));

const { eventChannelMock, workspaceStoreMock, deepLinkStoreMock } = vi.hoisted(() => ({
  eventChannelMock: vi.fn(),
  workspaceStoreMock: {
    close: vi.fn(),
  },
  deepLinkStoreMock: {
    clearPendingAction: vi.fn(),
    getPendingAction: vi.fn(),
  },
}));

vi.mock("$features/deeplink/deeplink.store.svelte", () => ({
  deepLinkStore: deepLinkStoreMock,
}));

vi.mock("$features/workspace/workspace.store.svelte", () => ({
  workspaceStore: workspaceStoreMock,
}));

vi.mock("redux-saga", async () => {
  const actual = await vi.importActual<typeof import("redux-saga")>("redux-saga");
  return {
    ...actual,
    eventChannel: eventChannelMock,
  };
});

import { requestHomePageInitializer } from "../deep-links-slice";
import {
  deepLinksSaga,
  handleDeepLinkCreate,
  handleLegacyOpenCreateWorkspaceModal,
  handleLocationChange,
  loadInitialPendingDeepLinkSaga,
  watchDeepLinkCreateSaga,
  watchLegacyOpenCreateWorkspaceModalSaga,
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
      .fork(watchLocationSaga)
      .next()
      .fork(watchDeepLinkCreateSaga)
      .next()
      .fork(watchLegacyOpenCreateWorkspaceModalSaga)
      .next()
      .isDone();
  });

  it("handles create=true on the home route", async () => {
    await expectSaga(handleLocationChange, {
      pathname: "/",
      href: "http://localhost/?create=true",
    })
      .call([workspaceStoreMock, workspaceStoreMock.close])
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
      .call([workspaceStoreMock, workspaceStoreMock.close])
      .put(requestHomePageInitializer({ applyPrefill: true }))
      .run();

    expect(sessionStorage.getItem("workspace-prefill")).toBe(
      JSON.stringify({ repoPath: "/repo/intent", branch: "develop" })
    );
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("handles deep-link create events from the renderer store", async () => {
    await expectSaga(handleDeepLinkCreate, {
      params: { repo: "/repo/intent" },
    })
      .put(requestHomePageInitializer({ applyPrefill: true }))
      .call([deepLinkStoreMock, deepLinkStoreMock.clearPendingAction])
      .run();

    expect(sessionStorage.getItem("workspace-prefill")).toBe(
      JSON.stringify({ repoPath: "/repo/intent", branch: "main" })
    );
  });

  it("handles the legacy open-create-workspace-modal event", async () => {
    await expectSaga(handleLegacyOpenCreateWorkspaceModal)
      .put(requestHomePageInitializer({}))
      .run();
  });

  it("replays a pending create action on startup", () => {
    deepLinkStoreMock.getPendingAction.mockReturnValue({
      type: "create",
      params: { repo: "/repo/intent" },
    });

    const iterator = loadInitialPendingDeepLinkSaga();
    expect(iterator.next()).toEqual({
      value: sagaEffects.call(handleDeepLinkCreate, { params: { repo: "/repo/intent" } }),
      done: false,
    });
  });

  it("takes renderer deep-link create events from the window channel", () => {
    const channel = createMockChannel();
    eventChannelMock.mockReturnValue(channel);

    const iterator = watchDeepLinkCreateSaga();
    expect(iterator.next()).toEqual({ value: sagaEffects.take(channel), done: false });
  });
});