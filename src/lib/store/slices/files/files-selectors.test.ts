import {
  describe,
  expect,
  it,
} from "vitest";
import { createCollection } from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { FileContentEntry, FilesState } from "./files-types";
import {
  filesReducer,
  loadFileContentSucceeded,
  updateFileContent,
} from "./files-slice";
import {
  selectAllFileContentEntries,
  selectFileContent,
  selectFileContentEntry,
  selectFileError,
  selectFileIsBinary,
  selectFileIsDirty,
  selectFileLastUpdated,
  selectFileLoading,
  selectFileSaving,
  selectFileTruncated,
  selectFilesWorkspaceState,
  selectOriginalFileContent,
} from "./files-selectors";

const WS_ID = "ws-1";
const PATH = "src/app.ts";
const ABS_PATH = "/repo/src/app.ts";

function fileEntry(overrides: Partial<FileContentEntry> = {}): FileContentEntry {
  return {
    path: PATH,
    absolutePath: "/repo/src/app.ts",
    originalContent: "original",
    localContent: "edited",
    lastUpdated: 7,
    loading: true,
    saving: true,
    error: "boom",
    isBinary: true,
    truncated: true,
    ...overrides,
  };
}

function stateWithFiles(entries: FileContentEntry[] = [fileEntry()]) {
  const filesState: FilesState = {
    byWorkspaceId: {
      [WS_ID]: {
        files: createCollection<FileContentEntry, "path">("path", entries),
      },
    },
  };
  return { files: filesState } as any;
}

describe("files selectors", () => {
  it("returns an empty workspace state for unknown workspaces", () => {
    const workspaceState = selectFilesWorkspaceState.select({ files: { byWorkspaceId: {} } } as any, WS_ID);

    expect(workspaceState.files.ids).toEqual([]);
  });

  it("selects all file entries and a specific entry", () => {
    const state = stateWithFiles([fileEntry(), fileEntry({ path: "README.md" })]);

    expect(selectAllFileContentEntries.select(state, WS_ID).map((entry) => entry.path)).toEqual([
      PATH,
      "README.md",
    ]);
    expect(selectFileContentEntry.select(state, WS_ID, PATH)?.absolutePath).toBe("/repo/src/app.ts");
  });

  it("selects file content, flags, and errors", () => {
    const state = stateWithFiles();

    expect(selectFileContent.select(state, WS_ID, PATH)).toBe("edited");
    expect(selectOriginalFileContent.select(state, WS_ID, PATH)).toBe("original");
    expect(selectFileLastUpdated.select(state, WS_ID, PATH)).toBe(7);
    expect(selectFileLoading.select(state, WS_ID, PATH)).toBe(true);
    expect(selectFileSaving.select(state, WS_ID, PATH)).toBe(true);
    expect(selectFileError.select(state, WS_ID, PATH)).toBe("boom");
    expect(selectFileIsBinary.select(state, WS_ID, PATH)).toBe(true);
    expect(selectFileTruncated.select(state, WS_ID, PATH)).toBe(true);
    expect(selectFileIsDirty.select(state, WS_ID, PATH)).toBe(true);
  });

  it("returns original content for clean files", () => {
    const state = stateWithFiles([fileEntry({ originalContent: "clean", localContent: "clean" })]);

    expect(selectOriginalFileContent.select(state, WS_ID, PATH)).toBe("clean");
  });

  it("returns original content when original content is set", () => {
    const state = stateWithFiles([fileEntry({ localContent: "edited", originalContent: "original" })]);

    expect(selectOriginalFileContent.select(state, WS_ID, PATH)).toBe("original");
  });

  it("tracks dirty state through edit and revert", () => {
    const loadedFilesState = filesReducer(
      undefined,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, "original", false),
    );
    const editedFilesState = filesReducer(loadedFilesState, updateFileContent(WS_ID, PATH, "edited"));
    const revertedFilesState = filesReducer(editedFilesState, updateFileContent(WS_ID, PATH, "original"));

    expect(selectFileIsDirty.select({ files: loadedFilesState } as any, WS_ID, PATH)).toBe(false);
    expect(selectFileIsDirty.select({ files: editedFilesState } as any, WS_ID, PATH)).toBe(true);
    expect(selectFileIsDirty.select({ files: revertedFilesState } as any, WS_ID, PATH)).toBe(false);
  });

  it("returns defaults for missing paths", () => {
    const state = stateWithFiles();

    expect(selectFileContentEntry.select(state, WS_ID, "missing.ts")).toBeUndefined();
    expect(selectFileContent.select(state, WS_ID, "missing.ts")).toBeNull();
    expect(selectFileLastUpdated.select(state, WS_ID, "missing.ts")).toBe(0);
    expect(selectFileLoading.select(state, WS_ID, "missing.ts")).toBe(false);
    expect(selectFileSaving.select(state, WS_ID, "missing.ts")).toBe(false);
    expect(selectFileError.select(state, WS_ID, "missing.ts")).toBeNull();
    expect(selectFileIsBinary.select(state, WS_ID, "missing.ts")).toBe(false);
    expect(selectFileTruncated.select(state, WS_ID, "missing.ts")).toBe(false);
    expect(selectFileIsDirty.select(state, WS_ID, "missing.ts")).toBe(false);
  });
});