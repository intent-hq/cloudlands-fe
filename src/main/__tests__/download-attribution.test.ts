/**
 * Download Attribution Tests
 *
 * Uses vi.doMock + vi.resetModules to override the global test-setup mocks
 * for electron and electron-store, since the setup file mocks `electron`
 * without `screen` which our module requires.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterAll,
} from 'vitest';

// Save originals so we can restore after all tests
const originalGetSystemVersion = (process as any).getSystemVersion;
const originalFetch = global.fetch;

// Mock process.getSystemVersion (Electron-specific API)
(process as any).getSystemVersion = () => '14.3.1';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

afterAll(() => {
  // Restore globals to prevent leaking into other test files
  if (originalGetSystemVersion) {
    (process as any).getSystemVersion = originalGetSystemVersion;
  } else {
    delete (process as any).getSystemVersion;
  }
  global.fetch = originalFetch;
});

describe('claimDownloadAttribution', () => {
  let storeData: Record<string, unknown>;
  let claimDownloadAttribution: () => Promise<void>;

  beforeEach(async () => {
    storeData = {};
    mockFetch.mockReset();
    vi.resetModules();

    // Override test-setup's electron mock to include `screen` and `session`
    vi.doMock('electron', () => ({
      screen: {
        getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }),
      },
      app: {
        getLocale: () => 'en-US',
        getPath: () => '/tmp/test',
        getName: () => 'test-app',
        getVersion: () => '1.0.0',
      },
      session: {
        defaultSession: {
          getUserAgent: () =>
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) intent/0.1.58 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36',
        },
      },
      ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
      BrowserWindow: { getAllWindows: () => [] },
    }));

    // Override test-setup's electron-store mock with controllable store
    vi.doMock('electron-store', () => ({
      default: class MockElectronStore {
        has(key: string) {
          return key in storeData;
        }
        get(key: string) {
          return storeData[key];
        }
        set(key: string, value: unknown) {
          storeData[key] = value;
        }
        delete(key: string) {
          delete storeData[key];
        }
        clear() {
          for (const k of Object.keys(storeData)) delete storeData[k];
        }
      },
    }));

    vi.doMock('../../shared/logger', () => ({
      Logger: class {
        debug() {}
        info() {}
        warn() {}
        error() {}
      },
    }));

    const mod = await import('../download-attribution');
    claimDownloadAttribution = mod.claimDownloadAttribution;
  });

  it('should skip if attribution already claimed', async () => {
    storeData['downloadAttribution'] = { ajs_aid: 'existing', eventTracked: true };
    await claimDownloadAttribution();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should store attribution data on successful match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        matched: true,
        confidence: 'high',
        ajs_aid: 'test-ajs-aid-123',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'launch',
        utm_content: null,
        utm_term: null,
        download_location: '/download',
      }),
    });

    await claimDownloadAttribution();

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fingerprint).toEqual({
      screen: '1920x1080',
      cores: expect.any(Number),
      timezone: expect.any(String),
      locale: 'en-US',
      os_version: '10.15.7',
    });

    expect(storeData['downloadAttribution']).toEqual({
      ajs_aid: 'test-ajs-aid-123',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'launch',
      utm_content: null,
      utm_term: null,
      confidence: 'high',
      download_location: '/download',
      eventTracked: false,
    });
  });

  it('should store terminal marker on no_match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: false, reason: 'no_match' }),
    });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toEqual({
      ajs_aid: null,
      eventTracked: true,
    });
  });

  it('should store terminal marker on missing_fingerprint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: false, reason: 'missing_fingerprint' }),
    });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toEqual({
      ajs_aid: null,
      eventTracked: true,
    });
  });

  it('should NOT persist on rate_limited (retry next launch)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: false, reason: 'rate_limited' }),
    });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toBeUndefined();
  });

  it('should NOT persist on 5xx response (retry next launch)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toBeUndefined();
  });

  it('should persist terminal marker on 4xx response (no retry)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toEqual({
      ajs_aid: null,
      eventTracked: true,
    });
  });

  it('should NOT persist on 429 rate limit (retry next launch)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toBeUndefined();
  });

  it('should NOT persist on network error (retry next launch)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toBeUndefined();
  });

  it('should NOT include memory in fingerprint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: false, reason: 'no_match' }),
    });
    await claimDownloadAttribution();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fingerprint.memory).toBeUndefined();
  });

  it('should parse os_version from UA string (not process.getSystemVersion)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: false, reason: 'no_match' }),
    });
    await claimDownloadAttribution();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // UA contains "Mac OS X 10_15_7" → parsed as "10.15.7"
    expect(body.fingerprint.os_version).toBe('10.15.7');
  });

  it('should handle matched response with null ajs_aid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: true, confidence: 'low', ajs_aid: null }),
    });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toEqual(
      expect.objectContaining({ ajs_aid: null, eventTracked: false }),
    );
  });

  it('should set eventTracked to false on successful match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: true, ajs_aid: 'some-id' }),
    });
    await claimDownloadAttribution();
    expect(storeData['downloadAttribution']).toEqual(
      expect.objectContaining({ eventTracked: false }),
    );
  });

  it('should send POST with correct Content-Type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ matched: false, reason: 'no_match' }),
    });
    await claimDownloadAttribution();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
});
