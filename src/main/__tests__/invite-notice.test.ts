/**
 * Unit tests for the renderer-rendered invite notice (src/main/invite-notice.ts):
 * show → ack → response over the `invite-notice:*` channels, with every
 * unavailable-renderer path resolving false so the caller falls back to the
 * native dialog.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import type {
  InviteNoticeDismissPayload,
  InviteNoticeShowPayload,
} from '../../shared/ipc/invite-notice';
import { resetInviteNoticeStateForTests, showInviteNotice } from '../invite-notice';

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

const PAYLOAD: InviteNoticeShowPayload = {
  requestId: 'req-1',
  kind: 'failed',
  reason: 'expired',
  workspaceTitle: 'Shared workspace',
  hostLabel: '192.168.1.10',
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
  return { ack: find('invite-notice:ack'), response: find('invite-notice:response') };
}

function dismissesSent(send: ReturnType<typeof vi.fn>): InviteNoticeDismissPayload[] {
  return send.mock.calls
    .filter(([channel]) => channel === 'invite-notice:dismiss')
    .map(([, payload]) => payload as InviteNoticeDismissPayload);
}

beforeEach(() => {
  resetInviteNoticeStateForTests();
  logLines.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showInviteNotice — renderer round-trip', () => {
  it('sends the show payload synchronously and resolves true after ack + response', async () => {
    const { window, send } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });

    expect(send).toHaveBeenCalledWith('invite-notice:show', PAYLOAD);
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId });

    await expect(acknowledged).resolves.toBe(true);
    expect(dismissesSent(send)).toEqual([]);
  });

  it('ignores ack/response for a stale requestId and keeps waiting', async () => {
    const { window } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: 'stale' });
    await handlers.response({}, { requestId: 'stale' });

    let settled = false;
    void acknowledged.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId });
    await expect(acknowledged).resolves.toBe(true);
  });

  it('a later show supersedes the previous request: only the new id is answered', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const first = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    const second = showInviteNotice(
      { ...PAYLOAD, requestId: 'req-2' },
      { getParentWindow: () => window },
    );
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: 'req-1' });
    await handlers.response({}, { requestId: 'req-1' });
    let firstSettled = false;
    void first.then(() => (firstSettled = true));
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    await handlers.ack({}, { requestId: 'req-2' });
    await handlers.response({}, { requestId: 'req-2' });
    await expect(second).resolves.toBe(true);
    // The superseded request falls back on its own timeout without touching the new one.
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(first).resolves.toBe(false);
    expect(dismissesSent(send)).toEqual([{ requestId: 'req-1' }]);
  });
});

describe('showInviteNotice — fallback to the native dialog', () => {
  it('treats a valid response as an implicit ack when the ack invoke was lost', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.response({}, { requestId: PAYLOAD.requestId });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(acknowledged).resolves.toBe(true);
    expect(dismissesSent(send)).toEqual([]);
  });

  it('resolves false and dismisses when the renderer never acks', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(acknowledged).resolves.toBe(false);
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId }]);
  });

  it('a late response after the ack timeout is ignored', async () => {
    vi.useFakeTimers();
    const { window } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(acknowledged).resolves.toBe(false);
    const handlers = await getHandlers();
    await expect(handlers.response({}, { requestId: PAYLOAD.requestId })).resolves.toBeDefined();
  });

  it('resolves false without sending when no window exists', async () => {
    await expect(showInviteNotice(PAYLOAD, { getParentWindow: () => null })).resolves.toBe(false);
  });

  it('resolves false when webContents.send throws', async () => {
    const { window, send } = makeWindow();
    send.mockImplementation(() => {
      throw new Error('render frame disposed');
    });
    await expect(showInviteNotice(PAYLOAD, { getParentWindow: () => window })).resolves.toBe(false);
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
      await expect(showInviteNotice(PAYLOAD, { getParentWindow: () => window })).resolves.toBe(
        false,
      );

      expect(logLines.some((line) => line.includes('renderer-send-failed'))).toBe(true);
      expect(logLines.some((line) => line.includes(marker))).toBe(false);
    },
  );

  it('resolves false when the renderer dies before acking', async () => {
    const { window, emitRendererGone } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    emitRendererGone('destroyed');
    await expect(acknowledged).resolves.toBe(false);
  });

  it('resolves false when the renderer navigates away after acking but before answering', async () => {
    const { window, send, emitRendererGone } = makeWindow();
    const acknowledged = showInviteNotice(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    emitRendererGone('did-navigate');
    await expect(acknowledged).resolves.toBe(false);
    expect(dismissesSent(send)).toEqual([]);
  });
});
