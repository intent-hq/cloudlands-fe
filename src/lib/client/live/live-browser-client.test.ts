/**
 * Tests for LiveBrowserClient — localStorage-backed recent URLs.
 *
 * Covers read/write round-trip, MAX_RECENT_URLS cap, and corrupt/missing data handling.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { LiveBrowserClient } from "./live-browser-client";
import { BROWSER_STORAGE_KEY_PREFIX, MAX_RECENT_URLS } from "$store/renderer/slices/browser/browser-types";
import type { RecentUrl } from "$store/renderer/slices/browser/browser-types";
import { safeLocalStorage } from "$lib/utils/safe-storage";

function storageKey(workspaceId: string): string {
  return `${BROWSER_STORAGE_KEY_PREFIX}${workspaceId}`;
}

/** Wire an in-memory Map to window.localStorage for tests. */
function installMemoryLocalStorage(): Map<string, string> {
  const mem = new Map<string, string>();
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (key: string) => mem.get(key) ?? null,
  );
  vi.mocked(window.localStorage.setItem).mockImplementation(
    (key: string, value: string) => {
      mem.set(key, String(value));
    },
  );
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
  vi.mocked(window.localStorage.clear).mockImplementation(() => {
    mem.clear();
  });
  Object.defineProperty(window.localStorage, "length", {
    get: () => mem.size,
  });
  return mem;
}

describe("LiveBrowserClient", () => {
  let client: LiveBrowserClient;
  let mem: Map<string, string>;

  beforeAll(() => {
    mem = installMemoryLocalStorage();
  });

  beforeEach(() => {
    client = new LiveBrowserClient();
    mem.clear();
  });

  afterEach(() => {
    mem.clear();
  });

  describe("recentUrls", () => {
    it("returns empty array when no data exists", async () => {
      const urls = await client.recentUrls("ws-1");
      expect(urls).toEqual([]);
    });

    it("returns stored URLs from localStorage", async () => {
      const stored: RecentUrl[] = [
        {
          url: "https://example.com",
          title: "Example",
          favicon: "https://example.com/favicon.ico",
          lastVisited: "2026-01-01T00:00:00.000Z",
        },
      ];
      safeLocalStorage.setJSON(storageKey("ws-1"), stored);

      const urls = await client.recentUrls("ws-1");
      expect(urls).toEqual(stored);
    });

    it("caps returned URLs at MAX_RECENT_URLS", async () => {
      const stored: RecentUrl[] = Array.from({ length: MAX_RECENT_URLS + 5 }, (_, i) => ({
        url: `https://example.com/${i}`,
        lastVisited: new Date(Date.now() - i * 1000).toISOString(),
      }));
      safeLocalStorage.setJSON(storageKey("ws-1"), stored);

      const urls = await client.recentUrls("ws-1");
      expect(urls.length).toBe(MAX_RECENT_URLS);
      expect(urls[0].url).toBe("https://example.com/0");
      expect(urls[MAX_RECENT_URLS - 1].url).toBe(`https://example.com/${MAX_RECENT_URLS - 1}`);
    });

    it("filters out malformed entries", async () => {
      const stored = [
        { url: "https://good.com", lastVisited: "2026-01-01T00:00:00.000Z" },
        { url: 123, lastVisited: "2026-01-01T00:00:00.000Z" }, // bad url
        { url: "https://good2.com" }, // missing lastVisited
        { url: "https://good3.com", lastVisited: "2026-01-01T00:00:00.000Z" },
      ];
      safeLocalStorage.setJSON(storageKey("ws-1"), stored);

      const urls = await client.recentUrls("ws-1");
      expect(urls).toEqual([
        { url: "https://good.com", lastVisited: "2026-01-01T00:00:00.000Z" },
        { url: "https://good3.com", lastVisited: "2026-01-01T00:00:00.000Z" },
      ]);
    });

    it("returns empty array for corrupt JSON", async () => {
      safeLocalStorage.setItem(storageKey("ws-1"), "{bad json");
      const urls = await client.recentUrls("ws-1");
      expect(urls).toEqual([]);
    });

    it("returns empty array for non-array data", async () => {
      safeLocalStorage.setJSON(storageKey("ws-1"), { not: "an array" });
      const urls = await client.recentUrls("ws-1");
      expect(urls).toEqual([]);
    });

    it("isolates URLs by workspace ID", async () => {
      const urls1: RecentUrl[] = [
        { url: "https://ws1.com", lastVisited: "2026-01-01T00:00:00.000Z" },
      ];
      const urls2: RecentUrl[] = [
        { url: "https://ws2.com", lastVisited: "2026-01-01T00:00:00.000Z" },
      ];
      safeLocalStorage.setJSON(storageKey("ws-1"), urls1);
      safeLocalStorage.setJSON(storageKey("ws-2"), urls2);

      const result1 = await client.recentUrls("ws-1");
      const result2 = await client.recentUrls("ws-2");

      expect(result1).toEqual(urls1);
      expect(result2).toEqual(urls2);
    });
  });

  describe("subscribe", () => {
    it("emits once with empty array", () => {
      let emitted: RecentUrl[] | null = null;
      const unsubscribe = client.subscribe((urls) => {
        emitted = urls;
      });

      expect(emitted).toEqual([]);
      unsubscribe();
    });

    it("returns a no-op unsubscribe function", () => {
      const unsubscribe = client.subscribe(() => {});
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("round-trip persistence", () => {
    it("reads back URLs written by middleware/reducer", async () => {
      const urls: RecentUrl[] = [
        {
          url: "https://roundtrip.com",
          title: "Round Trip Test",
          favicon: "https://roundtrip.com/favicon.ico",
          lastVisited: "2026-01-02T12:00:00.000Z",
        },
        {
          url: "https://second.com",
          lastVisited: "2026-01-02T11:00:00.000Z",
        },
      ];
      safeLocalStorage.setJSON(storageKey("ws-test"), urls);

      const loaded = await client.recentUrls("ws-test");
      expect(loaded).toEqual(urls);
    });
  });
});
