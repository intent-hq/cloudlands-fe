import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE seam: appClient.files.* are stubbed so no mutation reaches the daemon or
// disk. The service runs against the REAL configured store so optimistic
// dispatch and rollback are exercised end to end.
vi.mock("$lib/client", () => ({
  appClient: {
    files: {
      write: vi.fn(() => Promise.resolve({ success: true })),
      delete: vi.fn(() => Promise.resolve({ success: true })),
      mkdir: vi.fn(() => Promise.resolve({ success: true })),
      rename: vi.fn(() => Promise.resolve({ success: true })),
      read: vi.fn(() => Promise.resolve(null)),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadFileContentSucceeded } from "$store/renderer/slices/files/files-slice";
import {
  selectFileContent,
  selectFileContentEntry,
  selectFileError,
  selectFileIsDirty,
} from "$store/renderer/slices/files/files-selectors";
import {
  FILE_CONTENT_SAVE_DEBOUNCE_MS,
  createDirectory,
  createFile,
  deleteFile,
  flushFileContent,
  renameFile,
  writeFileContent,
} from "./files-write-service";

const filesApi = appClient.files as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-files-1";
const PATH = "src/a.ts";
const ABS = "/repo/src/a.ts";

function seed(content: string): void {
  appStore.dispatch(loadFileContentSucceeded(WS, PATH, ABS, content));
}

describe("filesWriteService (fake seam, real store)", () => {
  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.values(filesApi).forEach((fn) => fn.mockResolvedValue({ success: true } as never));
    filesApi.read.mockResolvedValue(null as never);
  });

  it("applies content optimistically and debounces the file.write", async () => {
    seed("orig");

    writeFileContent(WS, PATH, ABS, "edited");
    expect(selectFileContent.select(appStore.state, WS, PATH)).toBe("edited");
    expect(selectFileIsDirty.select(appStore.state, WS, PATH)).toBe(true);
    expect(filesApi.write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS + 1);
    expect(filesApi.write).toHaveBeenCalledTimes(1);
    expect(filesApi.write).toHaveBeenCalledWith(WS, PATH, "edited");
    expect(selectFileIsDirty.select(appStore.state, WS, PATH)).toBe(false);
  });

  it("coalesces rapid edits into a single debounced write", async () => {
    seed("orig");

    writeFileContent(WS, PATH, ABS, "a");
    writeFileContent(WS, PATH, ABS, "ab");
    writeFileContent(WS, PATH, ABS, "abc");
    await vi.advanceTimersByTimeAsync(FILE_CONTENT_SAVE_DEBOUNCE_MS + 1);

    expect(filesApi.write).toHaveBeenCalledTimes(1);
    expect(filesApi.write).toHaveBeenCalledWith(WS, PATH, "abc");
  });

  it("immediate write bypasses the debounce", async () => {
    seed("orig");

    writeFileContent(WS, PATH, ABS, "now", { immediate: true });
    await Promise.resolve();
    expect(filesApi.write).toHaveBeenCalledWith(WS, PATH, "now");
  });

  it("flushFileContent flushes a pending debounced write", async () => {
    seed("orig");

    writeFileContent(WS, PATH, ABS, "pending");
    expect(filesApi.write).not.toHaveBeenCalled();

    flushFileContent(WS, PATH);
    await Promise.resolve();
    expect(filesApi.write).toHaveBeenCalledWith(WS, PATH, "pending");
  });

  it("records an error and keeps the edit dirty when the write fails", async () => {
    seed("orig");
    filesApi.write.mockResolvedValueOnce({ success: false, error: "disk full" } as never);

    writeFileContent(WS, PATH, ABS, "edited", { immediate: true });
    await vi.advanceTimersByTimeAsync(1);

    expect(selectFileError.select(appStore.state, WS, PATH)).toBe("disk full");
    expect(selectFileIsDirty.select(appStore.state, WS, PATH)).toBe(true);
  });

  it("createFile forwards file.write and returns the seam result", async () => {
    expect(await createFile(WS, "src/new.ts", "x")).toEqual({ success: true });
    expect(filesApi.write).toHaveBeenCalledWith(WS, "src/new.ts", "x");
  });

  it("createDirectory forwards file.mkdir", async () => {
    expect(await createDirectory(WS, "src/dir")).toEqual({ success: true });
    expect(filesApi.mkdir).toHaveBeenCalledWith(WS, "src/dir");
  });

  it("deleteFile is optimistic and refetches the entry on failure", async () => {
    seed("orig");
    filesApi.delete.mockResolvedValueOnce({ success: false, error: "no" } as never);
    filesApi.read.mockResolvedValueOnce({
      path: PATH,
      localContent: "orig",
      isBinary: false,
      truncated: false,
    } as never);

    expect(await deleteFile(WS, PATH)).toEqual({ success: false, error: "no" });
    expect(filesApi.delete).toHaveBeenCalledWith(WS, PATH);
    expect(selectFileContentEntry.select(appStore.state, WS, PATH)).toBeDefined();
  });

  it("renameFile forwards file.rename and drops the stale cached entry on success", async () => {
    seed("orig");

    expect(await renameFile(WS, PATH, "src/b.ts")).toEqual({ success: true });
    expect(filesApi.rename).toHaveBeenCalledWith(WS, PATH, "src/b.ts");
    expect(selectFileContentEntry.select(appStore.state, WS, PATH)).toBeUndefined();
  });
});
