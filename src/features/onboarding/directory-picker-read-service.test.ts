import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seam: the live backend bridge is stubbed so dispatching
// `loadDirectoryRequested` exercises the read service against the REAL
// configured store (and its registered reducer + middleware) without any
// real `window.electronAPI` IPC round-trip. `onBackendNotification` is
// stubbed too because the configured store now installs the daemon-events
// bridge on first dispatched action (transitively via chat-send-service);
// without this export the bridge throws an unhandled "no export defined"
// error when this test triggers it.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { store as appStore } from "$store/renderer/store";
import {
  loadDirectoryRequested,
  navigateToPathRequested,
  resetDirectoryPicker,
  type DirectoryPickerListing,
} from "$store/renderer/slices/directory-picker/directory-picker-slice";

const backendRequestMock = vi.mocked(backendRequest);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const listing = (path: string): DirectoryPickerListing => ({
  path,
  parent: "/Users",
  home: "/Users/me",
  entries: [
    { name: "src", path: `${path}/src`, isDirectory: true, isGitRepo: false },
    { name: "repo", path: `${path}/repo`, isDirectory: true, isGitRepo: true },
  ],
});

describe("directoryPickerReadService (fake backend, real store)", () => {
  beforeAll(() => appStore.init());

  afterEach(() => {
    backendRequestMock.mockReset();
    appStore.dispatch(resetDirectoryPicker());
  });

  it("dispatches host.listDirectory with `{ path }` and stores the listing on success", async () => {
    // The settings-hydration middleware also fires `settings.list` lazily on
    // the first dispatched action; route mocks by method so that hydration
    // doesn't consume the picker's queued response.
    backendRequestMock.mockImplementation(((method: string) => {
      if (method === "host.listDirectory") {
        return Promise.resolve(listing("/Users/me/code"));
      }
      return Promise.resolve(undefined);
    }) as never);

    appStore.dispatch(loadDirectoryRequested("/Users/me/code"));

    // Loading flips immediately from the reducer.
    expect(appStore.state.directoryPicker.loading).toBe(true);
    expect(appStore.state.directoryPicker.error).toBeNull();
    expect(appStore.state.directoryPicker.requestedPath).toBe("/Users/me/code");

    await flush();

    // Assert the picker's own call via method-filtered calls instead of the
    // total spy count (settings.list noise also lives on the same mock).
    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === "host.listDirectory",
    );
    expect(hostListDirectoryCalls).toHaveLength(1);
    expect(backendRequestMock).toHaveBeenCalledWith("host.listDirectory", {
      path: "/Users/me/code",
    });

    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.listing?.path).toBe("/Users/me/code");
    expect(state.listing?.entries).toHaveLength(2);
  });

  it("treats an undefined path as the daemon-host home and passes `{}`", async () => {
    backendRequestMock.mockResolvedValueOnce(listing("/Users/me") as never);

    appStore.dispatch(loadDirectoryRequested());
    await flush();

    expect(backendRequestMock).toHaveBeenCalledWith("host.listDirectory", {});
    expect(appStore.state.directoryPicker.listing?.path).toBe("/Users/me");
  });

  it("dispatches the failure path and surfaces the error message", async () => {
    backendRequestMock.mockRejectedValueOnce(new Error("EACCES") as never);

    appStore.dispatch(loadDirectoryRequested("/forbidden"));
    await flush();

    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.error).toBe("EACCES");
    expect(state.listing).toBeNull();
  });

  it("falls back to home when the initial path is missing (ENOENT)", async () => {
    // First call for the missing initial path rejects with a not-found error;
    // second call (for home, `{}`) succeeds — the service must chain them.
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== "host.listDirectory") return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === "/gone") {
        return Promise.reject(
          new Error("failed to read /gone: No such file or directory (os error 2)"),
        );
      }
      if (path === undefined) {
        return Promise.resolve(listing("/Users/me"));
      }
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    appStore.dispatch(loadDirectoryRequested("/gone"));
    await flush();
    await flush();

    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === "host.listDirectory",
    );
    expect(hostListDirectoryCalls).toHaveLength(2);
    expect(hostListDirectoryCalls[0]?.[1]).toEqual({ path: "/gone" });
    expect(hostListDirectoryCalls[1]?.[1]).toEqual({});

    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.listing?.path).toBe("/Users/me");
    expect(state.requestedPath).toBeNull();
  });

  it("does not fall back when the home load itself is missing", async () => {
    // Guard against loops: a home-load failure must surface the error, not
    // re-dispatch `loadDirectoryRequested`.
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== "host.listDirectory") return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === undefined) {
        return Promise.reject(new Error("ENOENT: home missing"));
      }
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    appStore.dispatch(loadDirectoryRequested());
    await flush();
    await flush();

    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === "host.listDirectory",
    );
    expect(hostListDirectoryCalls).toHaveLength(1);
    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.error).toBe("ENOENT: home missing");
    expect(state.listing).toBeNull();
  });

  it("surfaces non-missing errors (e.g. permission) without falling back", async () => {
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== "host.listDirectory") return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === "/forbidden") {
        return Promise.reject(new Error("Permission denied (os error 13)"));
      }
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    appStore.dispatch(loadDirectoryRequested("/forbidden"));
    await flush();
    await flush();

    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === "host.listDirectory",
    );
    expect(hostListDirectoryCalls).toHaveLength(1);
    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.error).toBe("Permission denied (os error 13)");
    expect(state.listing).toBeNull();
  });

  it("navigates to a typed path and stores the listing on success", async () => {
    backendRequestMock.mockImplementation(((method: string) => {
      if (method === "host.listDirectory") {
        return Promise.resolve(listing("/Users/me/typed"));
      }
      return Promise.resolve(undefined);
    }) as never);

    appStore.dispatch(navigateToPathRequested("/Users/me/typed"));
    expect(appStore.state.directoryPicker.loading).toBe(true);
    await flush();

    expect(backendRequestMock).toHaveBeenCalledWith("host.listDirectory", {
      path: "/Users/me/typed",
    });
    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.pathError).toBeNull();
    expect(state.listing?.path).toBe("/Users/me/typed");
  });

  it("keeps the current listing and hints 'Path not found' for a missing typed path", async () => {
    // Seed a loaded listing first, then navigate to a nonexistent typed path.
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== "host.listDirectory") return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === "/Users/me") return Promise.resolve(listing("/Users/me"));
      return Promise.reject(
        new Error(`failed to read ${String(path)}: No such file or directory (os error 2)`),
      );
    }) as never);

    appStore.dispatch(loadDirectoryRequested("/Users/me"));
    await flush();
    expect(appStore.state.directoryPicker.listing?.path).toBe("/Users/me");

    appStore.dispatch(navigateToPathRequested("/nope"));
    await flush();
    await flush();

    // No home fallback for typed paths: exactly one extra listDirectory call.
    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === "host.listDirectory",
    );
    expect(hostListDirectoryCalls).toHaveLength(2);

    const state = appStore.state.directoryPicker;
    expect(state.loading).toBe(false);
    expect(state.pathError).toBe("Path not found");
    expect(state.error).toBeNull();
    // The pre-navigation listing survives so the picker stays where it was.
    expect(state.listing?.path).toBe("/Users/me");
  });

  it("surfaces non-missing typed-path errors verbatim as the hint", async () => {
    backendRequestMock.mockImplementation(((method: string) => {
      if (method === "host.listDirectory") {
        return Promise.reject(new Error("Permission denied (os error 13)"));
      }
      return Promise.resolve(undefined);
    }) as never);

    appStore.dispatch(navigateToPathRequested("/forbidden"));
    await flush();

    const state = appStore.state.directoryPicker;
    expect(state.pathError).toBe("Permission denied (os error 13)");
  });

  it("coalesces rapid same-path dispatches into a single fetch", async () => {
    backendRequestMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(listing("/x") as never), 5)),
    );

    appStore.dispatch(loadDirectoryRequested("/x"));
    appStore.dispatch(loadDirectoryRequested("/x"));
    appStore.dispatch(loadDirectoryRequested("/x"));

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(backendRequestMock).toHaveBeenCalledTimes(1);
    expect(appStore.state.directoryPicker.listing?.path).toBe("/x");
  });
});
