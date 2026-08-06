import { describe, expect, it } from "vitest";
import {
  closeReleaseNotesModal,
  initialState,
  releaseNotesReducer,
  setError,
  setInitialized,
  setLoading,
  showReleaseNotes,
  showReleaseNotesSuccess,
  showReleaseNotesUnavailable,
} from "./release-notes-slice";
import type { ReleaseNotes } from "./release-notes-types";

const NOTES: ReleaseNotes = {
  version: "2.1.0",
  notes: "## What changed",
  url: "https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.1.0",
};

describe("releaseNotesReducer", () => {
  it("returns the initial state", () => {
    expect(releaseNotesReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("opens the modal in a loading state on showReleaseNotes", () => {
    const state = releaseNotesReducer(
      { ...initialState, releaseNotes: NOTES, error: "boom" },
      showReleaseNotes(),
    );

    expect(state).toEqual({
      ...initialState,
      releaseNotes: null,
      showModal: true,
      loading: true,
      error: null,
    });
  });

  it("resolves the modal into its content on showReleaseNotesSuccess", () => {
    const state = releaseNotesReducer(
      releaseNotesReducer(initialState, showReleaseNotes()),
      showReleaseNotesSuccess(NOTES),
    );

    expect(state).toEqual({
      ...initialState,
      releaseNotes: NOTES,
      showModal: true,
      loading: false,
      error: null,
    });
  });

  it("keeps the modal open with no notes on showReleaseNotesUnavailable", () => {
    const state = releaseNotesReducer(
      releaseNotesReducer(initialState, showReleaseNotes()),
      showReleaseNotesUnavailable(),
    );

    expect(state.showModal).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.releaseNotes).toBeNull();
  });

  it("closes the modal without discarding the loaded notes", () => {
    const opened = releaseNotesReducer(initialState, showReleaseNotesSuccess(NOTES));
    const state = releaseNotesReducer(opened, closeReleaseNotesModal());

    expect(state.showModal).toBe(false);
    expect(state.releaseNotes).toEqual(NOTES);
  });

  it("tracks loading, error, and initialized flags", () => {
    expect(releaseNotesReducer(initialState, setLoading(true)).loading).toBe(true);
    expect(releaseNotesReducer(initialState, setError("nope")).error).toBe("nope");
    expect(releaseNotesReducer(initialState, setInitialized()).initialized).toBe(true);
  });
});
