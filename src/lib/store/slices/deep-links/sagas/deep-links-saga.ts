import { autoUpdateClient } from "$features/auto-update/auto-update.client";
import type { UpdateChannel } from "$features/auto-update/types";
import {
  takeEveryFromElectronChannel,
  takeEveryFromWindowEvent,
} from "$lib/store/utils/ipc-channel";
import {
  END,
  eventChannel,
  type EventChannel,
} from "redux-saga";
import {
  call,
  fork,
  put,
  select,
  take,
} from "typed-redux-saga";
import {
  clearPendingDeepLinkAction,
  deepLinkError,
  deepLinkProcessingComplete,
  deepLinkReceived,
  requestHomePageInitializer,
} from "../deep-links-slice";
import type { DeepLinkActionPayload } from "../deep-links-types";
import { selectPendingDeepLinkAction } from "../deep-links-selectors";
import {
  clearActiveWorkspace,
  openWorkspaceRequested,
} from "$lib/store/slices/workspace/workspace-slice";
import { WorkspaceId } from "$shared/types/branded-ids";
import { Logger } from "$shared/logger";
import { dispatchWindowEvent } from "$lib/utils/window-events";

const logger = new Logger("DeepLinkSaga");

const WORKSPACE_PREFILL_KEY = "workspace-prefill";

type LocationChange = {
  pathname: string;
  href: string;
};

type DeepLinkCreateEvent = {
  params: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

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
      prompt: params.prompt || "",
      specialist: params.specialist || "",
      githubUrl: params.githubUrl || "",
      title: params.title || "",
      autoCreate: params.autoCreate || "",
    })
  );
}

function parseCreateDeepLink(
  deepLinkParam: string,
): DeepLinkActionPayload | null {
  try {
    const action = JSON.parse(
      decodeURIComponent(deepLinkParam),
    ) as DeepLinkActionPayload | null;
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

async function validateWorkspace(
  id: string,
): Promise<{ success: boolean; exists: boolean }> {
  return (window as any).electronAPI.invoke(
    "deep-link:validate-workspace",
    { id },
  );
}

async function showSuccessToast(message: string): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.success(message);
  } catch {
    // Toast not available - not critical
  }
}

async function showErrorToast(message: string): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.error(message);
  } catch {
    // Toast not available - not critical
  }
}

async function setAutoUpdateChannel(channel: string): Promise<void> {
  await autoUpdateClient.setChannel(channel as UpdateChannel);
}

async function checkForAutoUpdates(): Promise<void> {
  await autoUpdateClient.checkForUpdates();
}

// ---------------------------------------------------------------------------
// Deep link IPC handler sagas
// ---------------------------------------------------------------------------

export function* handleOpenWorkspace(params: Record<string, string>) {
  const { id } = params;

  if (!id) {
    yield* put(deepLinkError("Workspace ID is required"));
    return;
  }

  const result: { success: boolean; exists: boolean } = yield* call(
    validateWorkspace,
    id,
  );
  if (!result.success || !result.exists) {
    yield* put(deepLinkError(`Workspace ${id} not found`));
    return;
  }

  yield* put(openWorkspaceRequested(WorkspaceId(id)));
  yield* put(deepLinkProcessingComplete());
}

export function* handleCreateWorkspace(params: Record<string, string>) {
  yield* call(writeWorkspacePrefill, params);

  if (typeof window !== "undefined") {
    dispatchWindowEvent("app:deep-link-create", { params });
  }

  yield* put(deepLinkProcessingComplete());
}

export function* handleCloneRepository(params: Record<string, string>) {
  const { repo, title } = params;

  if (!repo) {
    yield* put(deepLinkError("Repository URL is required for clone action"));
    return;
  }

  yield* call(handleCreateWorkspace, {
    ...params,
    title: title || `Clone of ${repo.split("/").pop()?.replace(".git", "")}`,
  });
}

export function* handleSettings(params: Record<string, string>) {
  const { beta } = params;
  const enableBeta = beta === "true";
  const channel = enableBeta ? "beta" : "stable";

  try {
    yield* call(setAutoUpdateChannel, channel);
  } catch {
    yield* call(showErrorToast, "Failed to switch update channel");
    yield* put(deepLinkProcessingComplete());
    return;
  }

  if (enableBeta) {
    yield* call(showSuccessToast, "Beta updates enabled for this session");
  } else {
    yield* call(
      showSuccessToast,
      "Switched to stable update channel for this session",
    );
  }

  try {
    yield* call(checkForAutoUpdates);
  } catch {
    // Non-critical - channel was already switched
  }

  yield* put(deepLinkProcessingComplete());
}

export function* handleDeepLinkAction(action: DeepLinkActionPayload) {
  logger.debug("Received deep link action:", { action });

  yield* put(deepLinkReceived(action));

  try {
    switch (action.type) {
      case "open":
        yield* call(handleOpenWorkspace, action.params);
        break;
      case "create":
        yield* call(handleCreateWorkspace, action.params);
        break;
      case "clone":
        yield* call(handleCloneRepository, action.params);
        break;
      case "settings":
        yield* call(handleSettings, action.params);
        break;
      default:
        yield* put(
          deepLinkError(`Unknown action type: ${(action as any).type}`),
        );
    }
  } catch (error) {
    logger.error("Error handling deep link:", error as Error);
    yield* put(
      deepLinkError(
        error instanceof Error
          ? error.message
          : "Failed to handle deep link",
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Location / window event sagas (existing)
// ---------------------------------------------------------------------------

export function* handleLocationChange(location: LocationChange) {
  if (location.pathname !== "/") {
    return;
  }

  yield* put(clearActiveWorkspace());

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
    yield* call(
      replaceBrowserUrl,
      buildUrlWithoutSearchParam(location.href, "create"),
    );
  }
}

export function* handleDeepLinkCreate(event: DeepLinkCreateEvent) {
  yield* call(writeWorkspacePrefill, event.params);
  yield* put(requestHomePageInitializer({ applyPrefill: true }));
  yield* put(clearPendingDeepLinkAction());
}

export function* loadInitialPendingDeepLinkSaga() {
  const pendingAction: DeepLinkActionPayload | null = yield* select(
    selectPendingDeepLinkAction.select,
  );
  if (pendingAction?.type === "create") {
    yield* call(handleDeepLinkCreate, { params: pendingAction.params });
  }
}

// ---------------------------------------------------------------------------
// Watcher sagas
// ---------------------------------------------------------------------------

export function* watchDeepLinkIpcSaga() {
  yield* takeEveryFromElectronChannel<DeepLinkActionPayload>(
    "deep-link",
    function* (action) {
      yield* call(handleDeepLinkAction, action);
    },
  );
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
  yield* takeEveryFromWindowEvent<DeepLinkCreateEvent>(
    "app:deep-link-create",
    function* (event) {
      yield* call(handleDeepLinkCreate, event);
    },
  );
}

export function* deepLinksSaga() {
  yield* call(loadInitialPendingDeepLinkSaga);
  yield* fork(watchDeepLinkIpcSaga);
  yield* fork(watchLocationSaga);
  yield* fork(watchDeepLinkCreateSaga);
}