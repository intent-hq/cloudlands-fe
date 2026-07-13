import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE transport: the WSS seam is replaced by the scripted MockBackendTransport
// so no request reaches a real daemon. The REAL LiveWorkspacesClient and the
// REAL configured store are exercised end to end: a daemon `workspace:updated`
// events.event drives the subscribe refetch, and replaceWorkspaceList converges
// the store to the refetched list.
vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../../test/mocks/backend-transport.mock");
  return mod.mockBackendTransportModule;
});

// The subscription module reads `appClient` off the seam entry point; narrow it
// to a real LiveWorkspacesClient (backed by the mocked transport above) so the
// rest of the LiveAppClient surface stays out of the test.
vi.mock("$lib/client", async () => {
  const { LiveWorkspacesClient } = await import("$lib/client/live/live-workspaces-client");
  return { appClient: { workspaces: new LiveWorkspacesClient() } };
});

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from "../../test/mocks/backend-transport.mock";
import { store as appStore } from "$store/renderer/store";
import { setActiveWorkspaceId } from "$store/renderer/slices/workspace/workspace-slice";
import {
  selectActiveWorkspaceId,
  selectWorkspaceHasLoaded,
  selectWorkspaceItems,
} from "$store/renderer/slices/workspace/workspace-selectors";
import { startWorkspaceListSubscription } from "./workspace-list-subscription";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const listCalls = (backend: MockBackendHandle) =>
  backend.requests.filter((r) => r.method === "workspace.list").length;

/** Minimal PROTOCOL §5.1-shaped wire workspace as `workspace.list` returns it. */
function wireWorkspace(title: string) {
  return {
    id: WS_ID,
    title,
    branch: "intent/demo",
    status: "Active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("workspace list subscription (mock backend, real store)", () => {
  let backend: MockBackendHandle;
  let stop: (() => void) | undefined;

  beforeAll(() => appStore.init());
  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    resetMockBackend();
  });

  it("sends workspace.list on the wire and seeds the store from the initial snapshot", async () => {
    backend.onRequest("workspace.list", () => ({ workspaces: [wireWorkspace("Original")] }));

    stop = startWorkspaceListSubscription();
    await flush();

    expect(backend.requests).toContainEqual({ method: "workspace.list", params: undefined });
    expect(selectWorkspaceItems.select(appStore.state).map((w) => w.title)).toContain("Original");
    expect(selectWorkspaceHasLoaded.select(appStore.state)).toBe(true);
  });

  it("a workspace:updated events.event refetches and lands the renamed list in the store", async () => {
    let title = "Original";
    backend.onRequest("workspace.list", () => ({ workspaces: [wireWorkspace(title)] }));

    stop = startWorkspaceListSubscription();
    await flush();
    appStore.dispatch(setActiveWorkspaceId(WS_ID));

    title = "Renamed";
    backend.pushEvent({
      type: "workspace:updated",
      data: { workspaceId: WS_ID },
      workspaceId: WS_ID,
    });
    await flush();

    const items = selectWorkspaceItems.select(appStore.state);
    expect(items.find((w) => w.id === WS_ID)?.title).toBe("Renamed");
    // Only the list is replaced — the refetch never clobbers the selection.
    expect(selectActiveWorkspaceId.select(appStore.state)).toBe(WS_ID);
  });

  it("stops refetching after the unsubscribe is called", async () => {
    backend.onRequest("workspace.list", () => ({ workspaces: [wireWorkspace("Original")] }));

    stop = startWorkspaceListSubscription();
    await flush();
    const callsBeforeDispose = listCalls(backend);

    stop();
    stop = undefined;
    backend.pushEvent({ type: "workspace:updated", data: { workspaceId: WS_ID } });
    await flush();

    expect(listCalls(backend)).toBe(callsBeforeDispose);
  });
});
