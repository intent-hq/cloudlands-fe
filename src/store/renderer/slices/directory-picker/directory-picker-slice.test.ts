import { describe, expect, it } from "vitest";
import {
  clearPathNavigationError,
  directoryListingFailed,
  directoryListingLoaded,
  directoryPickerReducer,
  initialState,
  loadDirectoryRequested,
  navigateToPathRequested,
  pathNavigationFailed,
  resetDirectoryPicker,
  type DirectoryPickerListing,
} from "./directory-picker-slice";

const listing = (path: string): DirectoryPickerListing => ({
  path,
  parent: "/Users",
  home: "/Users/me",
  entries: [
    { name: "src", path: `${path}/src`, isDirectory: true, isGitRepo: false },
  ],
});

describe("directoryPickerReducer", () => {
  it("returns the initial state", () => {
    expect(directoryPickerReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("flips to loading and records the requested path on loadDirectoryRequested", () => {
    const next = directoryPickerReducer(
      initialState,
      loadDirectoryRequested("/Users/me/code"),
    );

    expect(next).toEqual({
      listing: null,
      loading: true,
      error: null,
      requestedPath: "/Users/me/code",
      pathError: null,
    });
  });

  it("treats an undefined path as the daemon-host home (requestedPath = null)", () => {
    const next = directoryPickerReducer(initialState, loadDirectoryRequested());

    expect(next.loading).toBe(true);
    expect(next.requestedPath).toBeNull();
  });

  it("clears a stale error when starting a new load", () => {
    const previous = {
      ...initialState,
      error: "stale",
      loading: false,
      requestedPath: "/old",
    };

    const next = directoryPickerReducer(
      previous,
      loadDirectoryRequested("/new"),
    );

    expect(next.error).toBeNull();
    expect(next.loading).toBe(true);
    expect(next.requestedPath).toBe("/new");
  });

  it("applies a successful listing that matches the requested path", () => {
    const loading = directoryPickerReducer(
      initialState,
      loadDirectoryRequested("/Users/me/code"),
    );

    const next = directoryPickerReducer(
      loading,
      directoryListingLoaded("/Users/me/code", listing("/Users/me/code")),
    );

    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.listing?.path).toBe("/Users/me/code");
    expect(next.listing?.entries).toHaveLength(1);
  });

  it("discards a stale success whose requestedPath does not match", () => {
    const loading = directoryPickerReducer(
      initialState,
      loadDirectoryRequested("/Users/me/new"),
    );

    const next = directoryPickerReducer(
      loading,
      directoryListingLoaded("/Users/me/old", listing("/Users/me/old")),
    );

    // Loading state is preserved; stale listing is not applied.
    expect(next.loading).toBe(true);
    expect(next.listing).toBeNull();
    expect(next.requestedPath).toBe("/Users/me/new");
  });

  it("records an error for the matching request and clears the listing", () => {
    const loading = directoryPickerReducer(
      initialState,
      loadDirectoryRequested("/forbidden"),
    );

    const next = directoryPickerReducer(
      loading,
      directoryListingFailed("/forbidden", "EACCES"),
    );

    expect(next.loading).toBe(false);
    expect(next.error).toBe("EACCES");
    expect(next.listing).toBeNull();
  });

  it("ignores a stale failure whose requestedPath does not match", () => {
    const loading = directoryPickerReducer(
      initialState,
      loadDirectoryRequested("/Users/me/new"),
    );

    const next = directoryPickerReducer(
      loading,
      directoryListingFailed("/Users/me/old", "boom"),
    );

    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
  });

  it("resets back to the initial state on resetDirectoryPicker", () => {
    const populated = {
      listing: listing("/some/path"),
      loading: false,
      error: null,
      requestedPath: "/some/path",
      pathError: null,
    };

    expect(directoryPickerReducer(populated, resetDirectoryPicker())).toEqual(
      initialState,
    );
  });

  describe("typed-path navigation", () => {
    const populated = {
      ...initialState,
      listing: listing("/Users/me"),
      requestedPath: "/Users/me",
    };

    it("flips to loading and clears a stale hint on navigateToPathRequested", () => {
      const next = directoryPickerReducer(
        { ...populated, pathError: "stale hint" },
        navigateToPathRequested("/typed/path"),
      );

      expect(next.loading).toBe(true);
      expect(next.pathError).toBeNull();
      expect(next.requestedPath).toBe("/typed/path");
      // The current listing stays visible while the navigation is in flight.
      expect(next.listing?.path).toBe("/Users/me");
    });

    it("records the hint and keeps the listing on pathNavigationFailed", () => {
      const loading = directoryPickerReducer(
        populated,
        navigateToPathRequested("/typed/missing"),
      );

      const next = directoryPickerReducer(
        loading,
        pathNavigationFailed("/typed/missing", "Path not found"),
      );

      expect(next.loading).toBe(false);
      expect(next.pathError).toBe("Path not found");
      expect(next.listing?.path).toBe("/Users/me");
      expect(next.error).toBeNull();
    });

    it("ignores a stale pathNavigationFailed whose requestedPath does not match", () => {
      const loading = directoryPickerReducer(
        populated,
        navigateToPathRequested("/typed/new"),
      );

      const next = directoryPickerReducer(
        loading,
        pathNavigationFailed("/typed/old", "boom"),
      );

      expect(next.loading).toBe(true);
      expect(next.pathError).toBeNull();
    });

    it("clears the hint when a matching listing loads", () => {
      const failed = {
        ...populated,
        requestedPath: "/typed/path",
        pathError: "Path not found",
      };

      const next = directoryPickerReducer(
        failed,
        directoryListingLoaded("/typed/path", listing("/typed/path")),
      );

      expect(next.pathError).toBeNull();
      expect(next.listing?.path).toBe("/typed/path");
    });

    it("clears the hint on clearPathNavigationError", () => {
      const next = directoryPickerReducer(
        { ...populated, pathError: "Path not found" },
        clearPathNavigationError(),
      );

      expect(next.pathError).toBeNull();
      expect(next.listing?.path).toBe("/Users/me");
    });
  });
});
