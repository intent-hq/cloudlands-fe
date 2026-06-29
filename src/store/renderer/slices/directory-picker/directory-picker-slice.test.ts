import { describe, expect, it } from "vitest";
import {
  directoryListingFailed,
  directoryListingLoaded,
  directoryPickerReducer,
  initialState,
  loadDirectoryRequested,
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
    };

    expect(directoryPickerReducer(populated, resetDirectoryPicker())).toEqual(
      initialState,
    );
  });
});
