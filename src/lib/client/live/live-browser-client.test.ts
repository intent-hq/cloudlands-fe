/**
 * Tests for LiveBrowserClient — localStorage-backed recent URLs.
 *
 * Covers read/write round-trip, MAX_RECENT_URLS cap, and corrupt/missing data handling.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// FAKE transport for the REV-2 tab-registry RPCs — no request reaches a daemon.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from './backend-transport';
import { LiveBrowserClient } from './live-browser-client';
import { MAX_RECENT_URLS } from '$store/renderer/slices/browser/browser-types';
import type { RecentUrl } from '$store/renderer/slices/browser/browser-types';
import { storageKey } from '$store/renderer/slices/browser/browser-storage-utils';
import { safeLocalStorage } from '$lib/utils/safe-storage';

/** Wire an in-memory Map to window.localStorage for tests. */
function installMemoryLocalStorage(): Map<string, string> {
  const mem = new Map<string, string>();
  vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => mem.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
    mem.set(key, String(value));
  });
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
  vi.mocked(window.localStorage.clear).mockImplementation(() => {
    mem.clear();
  });
  Object.defineProperty(window.localStorage, 'length', {
    get: () => mem.size,
    configurable: true,
  });
  return mem;
}

describe('LiveBrowserClient', () => {
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

  describe('recentUrls', () => {
    it('returns empty array when no data exists', async () => {
      const urls = await client.recentUrls('ws-1');
      expect(urls).toEqual([]);
    });

    it('returns stored URLs from localStorage', async () => {
      const stored: RecentUrl[] = [
        {
          url: 'https://example.com',
          title: 'Example',
          favicon: 'https://example.com/favicon.ico',
          lastVisited: '2026-01-01T00:00:00.000Z',
        },
      ];
      safeLocalStorage.setJSON(storageKey('ws-1'), stored);

      const urls = await client.recentUrls('ws-1');
      expect(urls).toEqual(stored);
    });

    it('caps returned URLs at MAX_RECENT_URLS', async () => {
      const stored: RecentUrl[] = Array.from({ length: MAX_RECENT_URLS + 5 }, (_, i) => ({
        url: `https://example.com/${i}`,
        lastVisited: new Date(Date.now() - i * 1000).toISOString(),
      }));
      safeLocalStorage.setJSON(storageKey('ws-1'), stored);

      const urls = await client.recentUrls('ws-1');
      expect(urls.length).toBe(MAX_RECENT_URLS);
      expect(urls[0].url).toBe('https://example.com/0');
      expect(urls[MAX_RECENT_URLS - 1].url).toBe(`https://example.com/${MAX_RECENT_URLS - 1}`);
    });

    it('filters out malformed entries', async () => {
      const stored = [
        { url: 'https://good.com', lastVisited: '2026-01-01T00:00:00.000Z' },
        { url: 123, lastVisited: '2026-01-01T00:00:00.000Z' }, // bad url
        { url: 'https://good2.com' }, // missing lastVisited
        { url: 'https://good3.com', lastVisited: '2026-01-01T00:00:00.000Z' },
      ];
      safeLocalStorage.setJSON(storageKey('ws-1'), stored);

      const urls = await client.recentUrls('ws-1');
      expect(urls).toEqual([
        { url: 'https://good.com', lastVisited: '2026-01-01T00:00:00.000Z' },
        { url: 'https://good3.com', lastVisited: '2026-01-01T00:00:00.000Z' },
      ]);
    });

    it('returns empty array for corrupt JSON', async () => {
      safeLocalStorage.setItem(storageKey('ws-1'), '{bad json');
      const urls = await client.recentUrls('ws-1');
      expect(urls).toEqual([]);
    });

    it('returns empty array for non-array data', async () => {
      safeLocalStorage.setJSON(storageKey('ws-1'), { not: 'an array' });
      const urls = await client.recentUrls('ws-1');
      expect(urls).toEqual([]);
    });

    it('isolates URLs by workspace ID', async () => {
      const urls1: RecentUrl[] = [
        { url: 'https://ws1.com', lastVisited: '2026-01-01T00:00:00.000Z' },
      ];
      const urls2: RecentUrl[] = [
        { url: 'https://ws2.com', lastVisited: '2026-01-01T00:00:00.000Z' },
      ];
      safeLocalStorage.setJSON(storageKey('ws-1'), urls1);
      safeLocalStorage.setJSON(storageKey('ws-2'), urls2);

      const result1 = await client.recentUrls('ws-1');
      const result2 = await client.recentUrls('ws-2');

      expect(result1).toEqual(urls1);
      expect(result2).toEqual(urls2);
    });
  });

  describe('subscribe', () => {
    it('emits once with empty array', () => {
      let emitted: RecentUrl[] | null = null;
      const unsubscribe = client.subscribe((urls) => {
        emitted = urls;
      });

      expect(emitted).toEqual([]);
      unsubscribe();
    });

    it('returns a no-op unsubscribe function', () => {
      const unsubscribe = client.subscribe(() => {});
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('round-trip persistence', () => {
    it('reads back URLs written by middleware/reducer', async () => {
      const urls: RecentUrl[] = [
        {
          url: 'https://roundtrip.com',
          title: 'Round Trip Test',
          favicon: 'https://roundtrip.com/favicon.ico',
          lastVisited: '2026-01-02T12:00:00.000Z',
        },
        {
          url: 'https://second.com',
          lastVisited: '2026-01-02T11:00:00.000Z',
        },
      ];
      safeLocalStorage.setJSON(storageKey('ws-test'), urls);

      const loaded = await client.recentUrls('ws-test');
      expect(loaded).toEqual(urls);
    });
  });
});

describe('LiveBrowserClient daemon tab registry (REV-2 PROTOCOL §5.17, fake transport)', () => {
  const mockedRequest = vi.mocked(backendRequest);
  const client = new LiveBrowserClient();

  /** PROTOCOL-shaped registry row as the daemon returns it. */
  const TAB = {
    tabId: 'tab-1',
    workspaceId: 'ws-1',
    hostClientId: 'cli-desk',
    url: 'https://example.com/',
    title: 'Example',
    visibility: 'visible',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:01.000Z',
  };

  afterEach(() => vi.clearAllMocks());

  it('listTabs sends { workspaceId } and unwraps the host-decorated listing', async () => {
    const listing = { ...TAB, hostConnected: true, hostName: 'Intent Desktop' };
    mockedRequest.mockResolvedValueOnce({ tabs: [listing] });

    expect(await client.listTabs('ws-1')).toEqual([listing]);
    expect(mockedRequest).toHaveBeenCalledWith('browser.listTabs', { workspaceId: 'ws-1' });
  });

  it('listTabs rejects rows missing hostConnected instead of healing them', async () => {
    mockedRequest.mockResolvedValueOnce({ tabs: [TAB] });
    await expect(client.listTabs('ws-1')).rejects.toThrow(
      'Invalid browser.listTabs response shape',
    );
  });

  it('upsertTab sends { workspaceId, tab } with the host-reported fields and returns the row', async () => {
    mockedRequest.mockResolvedValueOnce({ tab: TAB });
    const input = {
      tabId: 'tab-1',
      url: 'https://example.com/',
      title: 'Example',
      visibility: 'visible' as const,
      emulatedSize: { width: 1280, height: 800 },
    };

    expect(await client.upsertTab('ws-1', input)).toEqual(TAB);
    expect(mockedRequest).toHaveBeenCalledWith('browser.upsertTab', {
      workspaceId: 'ws-1',
      tab: input,
    });
  });

  it('removeTab sends { tabId } and requires the { ok: true } acknowledgement', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    expect(await client.removeTab('tab-1')).toEqual({ ok: true });
    expect(mockedRequest).toHaveBeenCalledWith('browser.removeTab', { tabId: 'tab-1' });

    for (const malformed of [{}, { ok: false }, null]) {
      mockedRequest.mockResolvedValueOnce(malformed);
      await expect(client.removeTab('tab-1')).rejects.toThrow(
        'Invalid browser.removeTab response shape',
      );
    }
  });

  it('syncTabs sends the full host tab set and surfaces the daemon drop list', async () => {
    mockedRequest.mockResolvedValueOnce({ drop: ['tab-stale'] });
    const tabs = [{ tabId: 'tab-1', workspaceId: 'ws-1', url: 'https://example.com/' }];

    expect(await client.syncTabs(tabs)).toEqual({ drop: ['tab-stale'] });
    expect(mockedRequest).toHaveBeenCalledWith('browser.syncTabs', { tabs });
  });

  it('navigateTab sends { tabId, url } and returns the routed navigate action envelope', async () => {
    // PROTOCOL §5.45: the daemon relays the `navigate` action's envelope verbatim.
    const envelope = {
      action: 'navigate',
      success: true,
      result: { url: 'https://example.com/next' },
    };
    mockedRequest.mockResolvedValueOnce(envelope);
    expect(await client.navigateTab('tab-1', 'https://example.com/next')).toEqual(envelope);
    expect(mockedRequest).toHaveBeenCalledWith('browser.navigateTab', {
      tabId: 'tab-1',
      url: 'https://example.com/next',
    });

    const failed = { action: 'navigate', success: false, error: 'tab not found' };
    mockedRequest.mockResolvedValueOnce(failed);
    expect(await client.navigateTab('tab-1', 'https://example.com/next')).toEqual(failed);

    for (const malformed of [{ ok: true }, { action: 'navigate' }, null]) {
      mockedRequest.mockResolvedValueOnce(malformed);
      await expect(client.navigateTab('tab-1', 'https://example.com/next')).rejects.toThrow(
        'Invalid browser.navigateTab response shape',
      );
    }
  });

  it('closeTab sends { tabId } and only adds force when the caller sets it', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    expect(await client.closeTab('tab-1')).toEqual({ ok: true });
    expect(mockedRequest).toHaveBeenLastCalledWith('browser.closeTab', { tabId: 'tab-1' });

    await client.closeTab('tab-1', { force: true });
    expect(mockedRequest).toHaveBeenLastCalledWith('browser.closeTab', {
      tabId: 'tab-1',
      force: true,
    });
  });

  it('closeTab requires the { ok: true } acknowledgement', async () => {
    for (const malformed of [{}, { ok: false }, null]) {
      mockedRequest.mockResolvedValueOnce(malformed);
      await expect(client.closeTab('tab-1')).rejects.toThrow(
        'Invalid browser.closeTab response shape',
      );
    }
  });
});
