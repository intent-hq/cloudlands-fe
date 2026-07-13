import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FileContentEntry } from "$store/renderer/slices/files/files-types";

// FAKE seam: appClient.files.read is stubbed so no daemon call happens. The
// service runs against the REAL configured store so the
// loadFileContentRequested middleware, read dedup, and slice reducer are
// exercised end to end. READ-ONLY: only `read` is stubbed (everything else
// throws if accidentally invoked).
vi.mock("$lib/client", () => ({
  appClient: {
    files: {
      read: vi.fn(() => Promise.resolve(null as FileContentEntry | null)),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadFileContentRequested } from "$store/renderer/slices/files/files-slice";
import {
  selectFileContent,
  selectFileError,
  selectFileContentEntry,
} from "$store/renderer/slices/files/files-selectors";
import { ensureFileContent } from "./files-read-service";

const filesApi = appClient.files as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-files-read-1";
const PATH = "src/a.ts";
const ABS = "/tmp/ws/src/a.ts";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEntry(overrides: Partial<FileContentEntry> = {}): FileContentEntry {
  return {
    path: PATH,
    absolutePath: ABS,
    originalContent: "hello",
    localContent: "hello",
    lastUpdated: 0,
    loading: false,
    saving: false,
    error: null,
    isBinary: false,
    truncated: false,
    ...overrides,
  };
}

describe("filesReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    filesApi.read.mockResolvedValue(null as never);
  });

  it("ensureFileContent fetches via the seam and converges the store on success", async () => {
    filesApi.read.mockResolvedValueOnce(makeEntry({ originalContent: "fetched" }) as never);

    await ensureFileContent(WS, PATH, ABS);

    expect(filesApi.read).toHaveBeenCalledWith(WS, PATH);
    expect(selectFileContent.select(appStore.state, WS, PATH)).toBe("fetched");
    const entry = selectFileContentEntry.select(appStore.state, WS, PATH);
    expect(entry?.loading).toBe(false);
    expect(entry?.error).toBeNull();
  });

  it("falls back to localContent when originalContent is null", async () => {
    filesApi.read.mockResolvedValueOnce(
      makeEntry({ originalContent: null, localContent: "from-local" }) as never,
    );

    await ensureFileContent(WS, PATH, ABS);

    expect(selectFileContent.select(appStore.state, WS, PATH)).toBe("from-local");
  });

  it("dispatches loadFileContentFailed when the seam returns null", async () => {
    filesApi.read.mockResolvedValueOnce(null as never);

    await ensureFileContent(WS, PATH, ABS);

    const entry = selectFileContentEntry.select(appStore.state, WS, PATH);
    expect(entry?.loading).toBe(false);
    expect(selectFileError.select(appStore.state, WS, PATH)).toBe("File not found");
  });

  it("dispatches loadFileContentFailed when the seam throws", async () => {
    filesApi.read.mockRejectedValueOnce(new Error("boom") as never);

    await ensureFileContent(WS, PATH, ABS);

    const entry = selectFileContentEntry.select(appStore.state, WS, PATH);
    expect(entry?.loading).toBe(false);
    expect(selectFileError.select(appStore.state, WS, PATH)).toBe("boom");
  });

  it("propagates isBinary and truncated flags from the entry", async () => {
    filesApi.read.mockResolvedValueOnce(
      makeEntry({ originalContent: "bin", isBinary: true, truncated: true }) as never,
    );

    await ensureFileContent(WS, PATH, ABS);

    const entry = selectFileContentEntry.select(appStore.state, WS, PATH);
    expect(entry?.isBinary).toBe(true);
    expect(entry?.truncated).toBe(true);
  });

  it("coalesces concurrent reads for the same (ws, path) into one fetch", async () => {
    filesApi.read.mockResolvedValue(makeEntry({ originalContent: "shared" }) as never);

    await Promise.all([
      ensureFileContent(WS, PATH, ABS),
      ensureFileContent(WS, PATH, ABS),
      ensureFileContent(WS, PATH, ABS),
    ]);

    expect(filesApi.read).toHaveBeenCalledTimes(1);
  });

  it("dispatching loadFileContentRequested triggers a read (middleware wiring)", async () => {
    filesApi.read.mockResolvedValueOnce(
      makeEntry({ originalContent: "via-action" }) as never,
    );

    appStore.dispatch(loadFileContentRequested(WS, PATH, ABS));
    await flush();

    expect(filesApi.read).toHaveBeenCalledWith(WS, PATH);
    expect(selectFileContent.select(appStore.state, WS, PATH)).toBe("via-action");
  });

  it("rapid loadFileContentRequested dispatches dedupe to a single fetch", async () => {
    filesApi.read.mockResolvedValue(makeEntry({ originalContent: "deduped" }) as never);

    appStore.dispatch(loadFileContentRequested(WS, PATH, ABS));
    appStore.dispatch(loadFileContentRequested(WS, PATH, ABS));
    appStore.dispatch(loadFileContentRequested(WS, PATH, ABS));
    await flush();

    expect(filesApi.read).toHaveBeenCalledTimes(1);
  });
});
