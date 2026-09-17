/**
 * Unit tests for the renderer-rendered invite consent prompt
 * (src/main/invite-consent.ts): show → ack → response → dismiss over the
 * `invite-consent:*` channels, with every unavailable-renderer path resolving
 * the decision to null so the caller falls back to the native dialog.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import type {
  InviteConsentDismissPayload,
  InviteConsentShowPayload,
} from '../../shared/ipc/invite-consent';
import { resetInviteConsentStateForTests, showInviteConsent } from '../invite-consent';

const logLines: string[] = [];
vi.mock('../../shared/logger', () => ({
  Logger: class {
    debug(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    info(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    warn(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    error(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
  },
}));

const PAYLOAD: InviteConsentShowPayload = {
  requestId: 'req-1',
  mode: 'device-code',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  workspaceTitle: 'Shared workspace',
  hostLabel: '192.168.1.10',
  expiresInMs: 900_000,
};

function makeWindow() {
  const send = vi.fn();
  const goneListeners = new Map<string, (() => void)[]>();
  const webContents = {
    isDestroyed: () => false,
    send,
    once: vi.fn((event: string, listener: () => void) => {
      const existing = goneListeners.get(event) ?? [];
      existing.push(listener);
      goneListeners.set(event, existing);
    }),
    removeListener: vi.fn(),
  };
  const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
  const emitRendererGone = (event: string) => {
    for (const listener of goneListeners.get(event) ?? []) listener();
  };
  return { window, send, emitRendererGone };
}

async function getHandlers() {
  const { ipcMain } = await import('electron');
  const handle = vi.mocked(ipcMain.handle);
  const find = (channel: string) =>
    handle.mock.calls.filter(([c]) => c === channel).at(-1)?.[1] as (
      event: unknown,
      data: unknown,
    ) => Promise<unknown>;
  return { ack: find('invite-consent:ack'), response: find('invite-consent:response') };
}

function dismissesSent(send: ReturnType<typeof vi.fn>): InviteConsentDismissPayload[] {
  return send.mock.calls
    .filter(([channel]) => channel === 'invite-consent:dismiss')
    .map(([, payload]) => payload as InviteConsentDismissPayload);
}

beforeEach(() => {
  resetInviteConsentStateForTests();
  logLines.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showInviteConsent — renderer round-trip', () => {
  it('sends the show payload and resolves the decision after ack + open', async () => {
    const { window, send } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });

    expect(send).toHaveBeenCalledWith('invite-consent:show', PAYLOAD);
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });

    await expect(prompt.decision).resolves.toBe('open');
    expect(dismissesSent(send)).toEqual([]);
  });

  it('resolves cancel as the decision', async () => {
    const { window } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await expect(prompt.decision).resolves.toBe('cancel');
  });

  it('a cancel after open settles cancelledWhileWaiting, and dismiss carries the outcome once', async () => {
    const { window, send } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });
    await expect(prompt.decision).resolves.toBe('open');

    let cancelled = false;
    void prompt.cancelledWhileWaiting.then(() => (cancelled = true));
    await Promise.resolve();
    expect(cancelled).toBe(false);

    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await expect(prompt.cancelledWhileWaiting).resolves.toBeUndefined();

    prompt.dismiss('cancelled');
    prompt.dismiss('failed');
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId, outcome: 'cancelled' }]);
  });

  it('after dismiss joined, a late cancel is refused: logged with a bounded code, never a cancellation', async () => {
    const { window, send } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });
    await prompt.decision;
    prompt.dismiss('joined');

    let cancelled = false;
    void prompt.cancelledWhileWaiting.then(() => (cancelled = true));
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await Promise.resolve();
    expect(cancelled).toBe(false);
    expect(logLines.some((line) => line.includes('cancel-after-grant'))).toBe(true);
    // The join stands: no second dismiss, nothing reported back as cancelled.
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId, outcome: 'joined' }]);
    prompt.dismiss('failed');
    expect(dismissesSent(send)).toHaveLength(1);
  });

  it('after dismiss failed, a late cancel is ignored without the after-grant code', async () => {
    const { window } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });
    await prompt.decision;
    prompt.dismiss('failed');

    let cancelled = false;
    void prompt.cancelledWhileWaiting.then(() => (cancelled = true));
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await Promise.resolve();
    expect(cancelled).toBe(false);
    expect(logLines.some((line) => line.includes('cancel-after-grant'))).toBe(false);
  });

  it('ignores ack/response for a stale requestId and keeps waiting', async () => {
    const { window } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: 'stale' });
    await handlers.response({}, { requestId: 'stale', action: 'cancel' });
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });
    await expect(prompt.decision).resolves.toBe('open');
  });
});

describe('showInviteConsent — fallback to the native dialog', () => {
  it('treats a valid response as an implicit ack when the ack invoke was lost', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(prompt.decision).resolves.toBe('open');
    expect(dismissesSent(send)).toEqual([]);
  });

  it('resolves null and dismisses when the renderer never acks', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(prompt.decision).resolves.toBeNull();
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId, outcome: 'cancelled' }]);
    // The caller's own dismiss is a no-op once the request was abandoned.
    prompt.dismiss('joined');
    expect(dismissesSent(send)).toHaveLength(1);
  });

  it('resolves null without sending when no window exists', async () => {
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => null });
    await expect(prompt.decision).resolves.toBeNull();
    prompt.dismiss('joined');
  });

  it('resolves null when webContents.send throws', async () => {
    const { window, send } = makeWindow();
    send.mockImplementation(() => {
      throw new Error('render frame disposed');
    });
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    await expect(prompt.decision).resolves.toBeNull();
  });

  it.each([
    ['an Error', (marker: string) => new Error(`render frame disposed ${marker}`)],
    ['a non-Error value', (marker: string) => `disposed ${marker}`],
  ])(
    'keeps the text of %s thrown by webContents.send out of the log line',
    async (_name, makeThrown) => {
      const marker = 'untrusted-send-failure-marker';
      const { window, send } = makeWindow();
      send.mockImplementation(() => {
        throw makeThrown(marker);
      });
      const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
      await expect(prompt.decision).resolves.toBeNull();

      expect(logLines.some((line) => line.includes('renderer-send-failed'))).toBe(true);
      expect(logLines.some((line) => line.includes(marker))).toBe(false);
    },
  );

  it('resolves null when the renderer dies before acking', async () => {
    const { window, emitRendererGone } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    emitRendererGone('destroyed');
    await expect(prompt.decision).resolves.toBeNull();
  });

  it('resolves null when the renderer navigates away after acking but before answering', async () => {
    const { window, send, emitRendererGone } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    emitRendererGone('did-navigate');
    await expect(prompt.decision).resolves.toBeNull();
    prompt.dismiss('failed');
    expect(dismissesSent(send)).toEqual([]);
  });

  it('a renderer crash after open silences the request without settling the wait', async () => {
    const { window, send, emitRendererGone } = makeWindow();
    const prompt = showInviteConsent(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'open' });
    await expect(prompt.decision).resolves.toBe('open');

    let cancelled = false;
    void prompt.cancelledWhileWaiting.then(() => (cancelled = true));
    emitRendererGone('render-process-gone');
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await Promise.resolve();
    expect(cancelled).toBe(false);
    prompt.dismiss('joined');
    expect(dismissesSent(send)).toEqual([]);
  });
});
