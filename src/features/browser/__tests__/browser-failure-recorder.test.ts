import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkRequest } from '../main/browser-capture-types';

const cdp = vi.hoisted(() => ({
  send: vi.fn(),
  listener: undefined as undefined | ((method: string, params: unknown) => void),
}));
vi.mock('../main/embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: {
    ensureAttached: vi.fn().mockResolvedValue(undefined),
    sendCdpCommand: cdp.send,
    onCdpMessage: vi.fn((_id, listener) => {
      cdp.listener = listener;
      return () => {
        cdp.listener = undefined;
      };
    }),
  },
}));
import { captureText, recordBrowserFailures } from '../main/browser-failure-recorder';

function failedRequest(id: string) {
  cdp.listener?.('Network.requestWillBeSent', {
    requestId: id,
    request: { method: 'GET', url: 'https://example.test/failure' },
  });
  cdp.listener?.('Network.responseReceived', {
    requestId: id,
    response: { status: 500, mimeType: 'text/plain' },
  });
  cdp.listener?.('Network.loadingFinished', { requestId: id, encodedDataLength: 20 });
}

describe('bounded browser failure recorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cdp.send
      .mockReset()
      .mockImplementation(async (_id, method) =>
        method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : {},
      );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    'Authorization: Bearer fixture-sensitive-bearer',
    'Authorization: Basic fixture-sensitive-basic',
    'Cookie: first=fixture-sensitive-one; second=fixture-sensitive-two',
    'Set-Cookie: first=fixture-sensitive-one; Path=/; second=fixture-sensitive-two',
    '{"Authorization":"Bearer fixture-sensitive-bearer","Cookie":"first=fixture-sensitive-one; second=fixture-sensitive-two"}',
  ])('redacts recognized full credential values: %s', (value) => {
    expect(captureText(value)).not.toContain('fixture-sensitive');
  });

  it.each(['Runtime.evaluate', 'Page.addScriptToEvaluateOnNewDocument'])(
    'bounds stalled setup %s and cleans late script installation',
    async (method) => {
      let resolveCommand!: (value: unknown) => void;
      cdp.send.mockImplementation(async (_id, command) => {
        if (command === method)
          return new Promise((resolve) => {
            resolveCommand ??= resolve;
          });
        return command === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : {};
      });
      let settled = false;
      const starting = recordBrowserFailures(
        101,
        () => {},
        () => {},
      ).then(
        () => {
          settled = true;
          return undefined;
        },
        (error: Error) => {
          settled = true;
          return error;
        },
      );
      await vi.advanceTimersByTimeAsync(6500);
      expect(settled).toBe(true);
      expect((await starting)?.message).toContain('timeout');
      expect(cdp.listener).toBeUndefined();
      resolveCommand({ identifier: 'late-script' });
      await vi.advanceTimersByTimeAsync(0);
      if (method === 'Page.addScriptToEvaluateOnNewDocument')
        expect(cdp.send).toHaveBeenCalledWith(101, 'Page.removeScriptToEvaluateOnNewDocument', {
          identifier: 'late-script',
        });
      else
        expect(cdp.send.mock.calls.filter((call) => call[1] === 'Runtime.evaluate')).toHaveLength(
          3,
        );
      await vi.advanceTimersByTimeAsync(1500);
    },
  );

  it('bounds stalled cleanup and stops retaining events before returning', async () => {
    const events: unknown[] = [];
    const capture = await recordBrowserFailures(
      102,
      (event) => events.push(event),
      () => {},
    );
    cdp.send.mockImplementation(async () => new Promise(() => {}));
    let settled = false;
    const cleanup = capture.cleanup().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(settled).toBe(true);
    await cleanup;
    expect(cdp.listener).toBeUndefined();
    expect(events).toEqual([]);
  });

  it('holds real body-read capacity after timeout, across intervals, and ignores late bodies', async () => {
    const releases: Array<(value: unknown) => void> = [];
    cdp.send.mockImplementation(async (_id, method) => {
      if (method === 'Network.getResponseBody')
        return new Promise((resolve) => releases.push(resolve));
      return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : {};
    });
    const events: NetworkRequest[] = [];
    const first = await recordBrowserFailures(
      103,
      () => {},
      (event) => events.push(event),
    );
    for (let i = 0; i < 4; i++) failedRequest(String(i));
    await vi.advanceTimersByTimeAsync(1100);
    for (let i = 4; i < 8; i++) failedRequest(String(i));
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(4);
    await first.cleanup();
    const retained = JSON.stringify(events);
    const second = await recordBrowserFailures(
      103,
      () => {},
      () => {},
    );
    failedRequest('next-interval');
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(4);
    for (const resolve of releases) resolve({ body: 'late private body', base64Encoded: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.stringify(events)).toBe(retained);
    await second.cleanup();
  });
});
