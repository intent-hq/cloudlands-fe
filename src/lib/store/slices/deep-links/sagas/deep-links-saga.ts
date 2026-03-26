import type { DeepLinkAction } from "$features/deeplink/deep-link-handler";
import { deepLinkStore } from "$features/deeplink/deeplink.store.svelte";
import { workspaceStore } from "$features/workspace/workspace.store.svelte";
import { takeEveryFromWindowEvent } from "$lib/store/utils/ipc-channel";
import { END, eventChannel, type EventChannel } from "redux-saga";
import { call, fork, put, take } from "typed-redux-saga";
import { requestHomePageInitializer } from "../deep-links-slice";

const WORKSPACE_PREFILL_KEY = "workspace-prefill";

type LocationChange = {
  pathname: string;
  href: string;
};

type DeepLinkCreateEvent = {
  params: Record<string, string>;
};

function createLocationChannel(): EventChannel<LocationChange> {
  return eventChannel<LocationChange>((emitter) => {
    if (typeof window === "undefined") {
      emitter(END as any);
      return () => {};
    }

    const emitLocation = () => {
      emitter({
        pathname: window.location.pathname,
        href: window.location.href,
      });
    };

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = ((data, unused, url) => {
      originalPushState(data, unused, url);
      emitLocation();
    }) as History["pushState"];

    window.history.replaceState = ((data, unused, url) => {
      originalReplaceState(data, unused, url);
      emitLocation();
    }) as History["replaceState"];

    window.addEventListener("popstate", emitLocation);
    emitLocation();

    return () => {
      window.removeEventListener("popstate", emitLocation);
      window.history.pushState = originalPushState as History["pushState"];
      window.history.replaceState = originalReplaceState as History["replaceState"];
    };
  });
}

function writeWorkspacePrefill(params: Record<string, string>): void {
  sessionStorage.setItem(
    WORKSPACE_PREFILL_KEY,
    JSON.stringify({
      repoPath: params.repo || "",
      branch: params.branch || "main",
    })
  );
}

function parseCreateDeepLink(deepLinkParam: string): DeepLinkAction | null {
  try {
    const action = JSON.parse(decodeURIComponent(deepLinkParam)) as DeepLinkAction | null;
    return action?.type === "create" ? action : null;
  } catch {
    return null;
  }
}

function buildUrlWithoutSearchParam(href: string, paramName: string): string {
  const url = new URL(href);
  url.searchParams.delete(paramName);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

function replaceBrowserUrl(url: string): void {
  window.history.replaceState(window.history.state, "", url);
}

export function* handleLocationChange(location: LocationChange) {
  if (location.pathname !== "/") {
    return;
  }

  yield* call([workspaceStore, workspaceStore.close]);

  const url = new URL(location.href);
  const deepLinkParam = url.searchParams.get("deepLink");
  if (deepLinkParam) {
    const action = parseCreateDeepLink(deepLinkParam);
    if (action?.params) {
      yield* call(writeWorkspacePrefill, action.params);
      yield* put(requestHomePageInitializer({ applyPrefill: true }));
    }
    yield* call(replaceBrowserUrl, "/");
    return;
  }

  if (url.searchParams.has("create")) {
    yield* put(requestHomePageInitializer({ focus: true }));
    yield* call(replaceBrowserUrl, buildUrlWithoutSearchParam(location.href, "create"));
  }
}

export function* handleDeepLinkCreate(event: DeepLinkCreateEvent) {
  yield* call(writeWorkspacePrefill, event.params);
  yield* put(requestHomePageInitializer({ applyPrefill: true }));
  yield* call([deepLinkStore, deepLinkStore.clearPendingAction]);
}

export function* handleLegacyOpenCreateWorkspaceModal() {
  yield* put(requestHomePageInitializer({}));
}

export function* loadInitialPendingDeepLinkSaga() {
  const pendingAction = deepLinkStore.getPendingAction();
  if (pendingAction?.type === "create") {
    yield* call(handleDeepLinkCreate, { params: pendingAction.params });
  }
}

export function* watchLocationSaga() {
  const channel = createLocationChannel();

  try {
    while (true) {
      const location: LocationChange = yield* take(channel);
      yield* call(handleLocationChange, location);
    }
  } finally {
    channel.close();
  }
}

export function* watchDeepLinkCreateSaga() {
  yield* takeEveryFromWindowEvent<DeepLinkCreateEvent>("app:deep-link-create", function* (event) {
      yield* call(handleDeepLinkCreate, event);
    });
}

export function* watchLegacyOpenCreateWorkspaceModalSaga() {
  yield* takeEveryFromWindowEvent<Record<string, never>>(
    "open-create-workspace-modal",
    function* () {
      yield* call(handleLegacyOpenCreateWorkspaceModal);
    },
  );
}

export function* deepLinksSaga() {
  yield* call(loadInitialPendingDeepLinkSaga);
  yield* fork(watchLocationSaga);
  yield* fork(watchDeepLinkCreateSaga);
  yield* fork(watchLegacyOpenCreateWorkspaceModalSaga);
}